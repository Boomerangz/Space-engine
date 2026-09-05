/**
 * Procedural height function shared by the mesh-building worker and the
 * main thread (the camera's terrain clamp must see the same surface).
 *
 * Deterministic 3D simplex noise (Gustavson-style) + fBm with a frequency
 * cap so deeper LOD levels can add octaves without changing coarse shape.
 */

export interface TerrainParams {
  /** Peak-to-peak relief amplitude, km. */
  amplitudeKm: number;
  seed: number;
  /** Base feature wavelength as a fraction of planet radius (default 0.7). */
  baseScale?: number;
  /** Ridged-multifractal blend 0..1 (mountainousness, default 0.35). */
  ridged?: number;
  /**
   * Small-scale roughness multiplier (default 1). The detail spectrum uses
   * a higher persistence than the base fBm, so slopes grow toward meter
   * scales instead of staying self-similar — this is what makes the ground
   * look rocky when standing on it.
   */
  detail?: number;
}

const GRAD = new Float32Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1,
  1, 0, 1, -1, 0, -1, -1,
]);

export class Simplex3 {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // xorshift-based deterministic shuffle
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      const j = s % (i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** 3D simplex noise in [-1, 1]. */
  noise(x: number, y: number, z: number): number {
    const F3 = 1 / 3;
    const G3 = 1 / 6;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
      else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
    } else {
      if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
      else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
      else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;
    let n = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) {
      const g = (this.perm[ii + this.perm[jj + this.perm[kk]]] % 12) * 3;
      t0 *= t0;
      n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0);
    }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) {
      const g = (this.perm[ii + i1 + this.perm[jj + j1 + this.perm[kk + k1]]] % 12) * 3;
      t1 *= t1;
      n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1);
    }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) {
      const g = (this.perm[ii + i2 + this.perm[jj + j2 + this.perm[kk + k2]]] % 12) * 3;
      t2 *= t2;
      n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2);
    }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) {
      const g = (this.perm[ii + 1 + this.perm[jj + 1 + this.perm[kk + 1]]] % 12) * 3;
      t3 *= t3;
      n += t3 * t3 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3);
    }
    return 32 * n;
  }
}

export class Heightfield {
  private readonly noise: Simplex3;
  private readonly detailNoise: Simplex3;
  private readonly amplitude: number;
  private readonly baseFreq: number;
  private readonly ridged: number;
  private readonly detail: number;

  constructor(
    params: TerrainParams,
    readonly radiusKm: number,
  ) {
    this.noise = new Simplex3(params.seed);
    this.detailNoise = new Simplex3(params.seed * 7919 + 13);
    this.amplitude = params.amplitudeKm;
    this.baseFreq = 1 / (params.baseScale ?? 0.7);
    this.ridged = params.ridged ?? 0.35;
    this.detail = params.detail ?? 1;
  }

  /**
   * Height above the reference sphere (km) at a unit direction.
   * `minWavelengthKm` caps octave count: octaves finer than that are
   * skipped, so coarse LODs stay cheap and consistent with fine ones.
   */
  heightAt(dx: number, dy: number, dz: number, minWavelengthKm: number): number {
    let sum = 0;
    let ridgedSum = 0;
    let freq = this.baseFreq;
    let amp = 1;
    // wavelength of an octave on the surface ≈ radius / freq.
    // The last octave fades in smoothly so adjacent LOD levels (whose caps
    // differ by 2×) disagree only by a partially faded octave — cracks stay
    // well under the skirt depth.
    for (let o = 0; o < 26; o++) {
      const wavelength = this.radiusKm / freq;
      const fade = Math.min(Math.max(wavelength / minWavelengthKm - 1, 0), 1);
      if (fade === 0) break;
      const n = this.noise.noise(dx * freq, dy * freq, dz * freq);
      const w = amp * fade;
      sum += n * w;
      const r = 1 - Math.abs(n);
      ridgedSum += (r * r * 2 - 1) * w;
      freq *= 2.02; // slightly off 2 to avoid axis-aligned artifacts
      amp *= 0.5;
    }
    // fixed normalization keeps the surface identical across octave caps
    const h = sum * (1 - this.ridged) + ridgedSum * this.ridged;

    // detail spectrum: ~30 km wavelength down to the cap, persistence 0.68
    // (steeper small-scale slopes). Same global cap → still one function.
    let detailSum = 0;
    let dFreq = this.radiusKm / 30;
    let dAmp = this.amplitude * 0.02 * this.detail;
    for (let o = 0; o < 16; o++) {
      const wavelength = this.radiusKm / dFreq;
      const fade = Math.min(Math.max(wavelength / minWavelengthKm - 1, 0), 1);
      if (fade === 0) break;
      detailSum += this.detailNoise.noise(dx * dFreq, dy * dFreq, dz * dFreq) * dAmp * fade;
      dFreq *= 2.03;
      dAmp *= 0.68;
    }

    return h * this.amplitude * 0.25 + detailSum;
  }

  /**
   * Albedo variation for close-range surface texture (regolith patches,
   * tonal breakup) — multiplies the base texture color, centered on 0.
   */
  albedoVariation(dx: number, dy: number, dz: number): number {
    const f1 = this.radiusKm / 0.8; // ~800 m patches
    const f2 = this.radiusKm / 0.06; // ~60 m speckle
    return (
      this.detailNoise.noise(dx * f1, dy * f1, dz * f1) * 0.06 +
      this.detailNoise.noise(dx * f2 + 31.7, dy * f2, dz * f2) * 0.05
    );
  }
}
