import * as THREE from 'three/webgpu';
import {
  Fn,
  Loop,
  If,
  cameraPosition,
  dot,
  exp,
  float,
  length,
  max,
  min,
  normalize,
  positionWorld,
  sqrt,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';

export interface AtmosphereParams {
  /** top of the atmosphere above the surface, km */
  topKm: number;
  /** Rayleigh scattering coefficients, km⁻¹ */
  betaR: [number, number, number];
  /** Rayleigh scale height, km */
  hR: number;
  /** Mie scattering coefficient, km⁻¹ */
  betaM: number;
  /** Mie scale height, km */
  hM: number;
  /** Mie anisotropy (Henyey-Greenstein g) */
  g: number;
  /** sun intensity multiplier */
  intensity: number;
}

const VIEW_SAMPLES = 16;
const LIGHT_SAMPLES = 6;

/**
 * Raymarched single-scattering atmosphere (Nishita-style), implemented in
 * TSL so it compiles to both WebGPU and the WebGL2 fallback.
 *
 * Rendered on the back faces of a sphere at the atmosphere's top radius,
 * additively blended. All distances in km, in render (camera-relative
 * world) space — safe in f32 because the mesh only draws near the focus.
 */
export class Atmosphere {
  readonly mesh: THREE.Mesh;
  /** render-space planet center (the anchor's world position) */
  readonly uCenter = uniform(new THREE.Vector3());
  /** unit vector from the planet toward the sun, render axes */
  readonly uSunDir = uniform(new THREE.Vector3(1, 0, 0));

  constructor(radiusKm: number, params: AtmosphereParams) {
    const atmR = radiusKm + params.topKm;
    const uPlanetR = float(radiusKm);
    const uAtmR = float(atmR);
    const betaR = vec3(...params.betaR);
    const betaM = vec3(params.betaM, params.betaM, params.betaM);
    const hR = float(params.hR);
    const hM = float(params.hM);
    const g = float(params.g);
    const intensity = float(params.intensity);
    const center = this.uCenter;
    const sunDir = this.uSunDir;

    const scatter = Fn(() => {
      const ro = cameraPosition.sub(center).toVar();
      const rd = normalize(positionWorld.sub(cameraPosition)).toVar();

      // ray / atmosphere-sphere intersection
      const b = dot(rd, ro).toVar();
      const c = dot(ro, ro).sub(uAtmR.mul(uAtmR)).toVar();
      const disc = b.mul(b).sub(c).toVar();
      const result = vec3(0).toVar();

      If(disc.greaterThan(0), () => {
        const sq = sqrt(disc);
        const t0 = max(b.negate().sub(sq), 0).toVar();
        const t1 = b.negate().add(sq).toVar();

        // clip against the planet itself
        const cp = dot(ro, ro).sub(uPlanetR.mul(uPlanetR));
        const discP = b.mul(b).sub(cp);
        If(discP.greaterThan(0), () => {
          const tp = b.negate().sub(sqrt(discP));
          If(tp.greaterThan(0), () => {
            t1.assign(min(t1, tp));
          });
        });

        const segment = t1.sub(t0).div(VIEW_SAMPLES).toVar();
        const mu = dot(rd, sunDir);
        const phaseR = float(3 / (16 * Math.PI)).mul(mu.mul(mu).add(1));
        const g2 = g.mul(g);
        const phaseM = float(3 / (8 * Math.PI))
          .mul(float(1).sub(g2).mul(mu.mul(mu).add(1)))
          .div(g2.add(2).mul(g2.add(1).sub(g.mul(mu).mul(2)).pow(1.5)));

        const sumR = vec3(0).toVar();
        const sumM = vec3(0).toVar();
        const odR = float(0).toVar();
        const odM = float(0).toVar();
        const t = t0.add(segment.mul(0.5)).toVar();

        Loop(VIEW_SAMPLES, () => {
          const p = ro.add(rd.mul(t)).toVar();
          const h = length(p).sub(uPlanetR).max(0).toVar();
          const dR = exp(h.negate().div(hR)).mul(segment).toVar();
          const dM = exp(h.negate().div(hM)).mul(segment).toVar();
          odR.addAssign(dR);
          odM.addAssign(dM);

          // optical depth along the light ray to the top of the atmosphere
          const bl = dot(sunDir, p).toVar();
          const cl = dot(p, p).sub(uAtmR.mul(uAtmR));
          const tl = bl.negate().add(sqrt(max(bl.mul(bl).sub(cl), 0))).toVar();
          const lseg = tl.div(LIGHT_SAMPLES).toVar();
          const odlR = float(0).toVar();
          const odlM = float(0).toVar();
          const tl0 = lseg.mul(0.5).toVar();
          Loop(LIGHT_SAMPLES, () => {
            const pl = p.add(sunDir.mul(tl0));
            const hl = length(pl).sub(uPlanetR).max(0);
            odlR.addAssign(exp(hl.negate().div(hR)).mul(lseg));
            odlM.addAssign(exp(hl.negate().div(hM)).mul(lseg));
            tl0.addAssign(lseg);
          });

          const tau = betaR
            .mul(odR.add(odlR))
            .add(betaM.mul(float(1.1)).mul(odM.add(odlM)));
          const attn = exp(tau.negate());
          sumR.addAssign(attn.mul(dR));
          sumM.addAssign(attn.mul(dM));
          t.addAssign(segment);
        });

        result.assign(
          sumR.mul(betaR).mul(phaseR).add(sumM.mul(betaM).mul(phaseM)).mul(intensity),
        );
      });

      return vec4(result, 1);
    });

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = scatter();
    material.side = THREE.BackSide;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(atmR, 64, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }
}
