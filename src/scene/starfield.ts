import * as THREE from 'three/webgpu';

/** Obliquity of the ecliptic at J2000, radians. */
const OBLIQUITY = (23.4392911 * Math.PI) / 180;
/** Distance the star shell is drawn at, km — beyond every planet. */
const SHELL_KM = 5e10;

interface StarCatalog {
  epoch: string;
  /** [raDeg, decDeg, Vmag, B-V] sorted brightest first. */
  stars: [number, number, number, number][];
}

/**
 * B-V colour index → approximate blackbody temperature (Ballesteros' formula),
 * then to a normalized RGB tint. Blue-white O/B stars vs orange-red K/M ones.
 */
function bvToColor(bv: number, out: THREE.Color): THREE.Color {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  // Tanner Helland's blackbody approximation, in hundreds of kelvin
  const k = Math.min(Math.max(t, 1500), 40000) / 100;
  let r: number, g: number, b: number;
  if (k <= 66) {
    r = 255;
    g = 99.47 * Math.log(k) - 161.12;
    b = k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(k - 60, -0.1332);
    g = 288.12 * Math.pow(k - 60, -0.0755);
    b = 255;
  }
  const clamp = (v: number) => Math.min(Math.max(v, 0), 255) / 255;
  // lift toward white so faint stars don't read as saturated blobs
  return out.setRGB(clamp(r) * 0.4 + 0.6, clamp(g) * 0.4 + 0.6, clamp(b) * 0.4 + 0.6);
}

/**
 * Real night sky from the Yale Bright Star Catalog.
 *
 * Stars live on a fixed shell in the render frame (they never move with the
 * origin rebasing — at these distances parallax is nil). Brightness follows
 * the magnitude scale, colour follows B-V, and the whole field fades out when
 * the camera is inside a sunlit atmosphere.
 */
export class Starfield {
  readonly group = new THREE.Group();
  private readonly materials: THREE.PointsMaterial[] = [];
  private readonly baseOpacity: number[] = [];
  starCount = 0;

  private constructor(catalog: StarCatalog) {
    // two layers: bright stars drawn larger, the rest as fine points
    const bright = catalog.stars.filter((s) => s[2] < 3.2);
    const faint = catalog.stars.filter((s) => s[2] >= 3.2);
    this.addLayer(bright, 3.2, 1.0);
    this.addLayer(faint, 1.7, 0.85);
    this.starCount = catalog.stars.length;
    this.group.frustumCulled = false;
  }

  static async load(url = '/data/stars.json'): Promise<Starfield> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`star catalog ${url}: HTTP ${res.status}`);
    return new Starfield((await res.json()) as StarCatalog);
  }

  private addLayer(
    stars: [number, number, number, number][],
    size: number,
    opacity: number,
  ): void {
    const n = stars.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const color = new THREE.Color();
    const DEG = Math.PI / 180;

    for (let i = 0; i < n; i++) {
      const [raDeg, decDeg, mag, bv] = stars[i];
      const ra = raDeg * DEG;
      const dec = decDeg * DEG;
      // equatorial unit vector
      const xe = Math.cos(dec) * Math.cos(ra);
      const ye = Math.cos(dec) * Math.sin(ra);
      const ze = Math.sin(dec);
      // → ecliptic frame (rotate about x by the obliquity)
      const x = xe;
      const y = ye * Math.cos(OBLIQUITY) + ze * Math.sin(OBLIQUITY);
      const z = -ye * Math.sin(OBLIQUITY) + ze * Math.cos(OBLIQUITY);
      // → render axes, matching eclToRender in system-view.ts
      positions[i * 3] = x * SHELL_KM;
      positions[i * 3 + 1] = z * SHELL_KM;
      positions[i * 3 + 2] = -y * SHELL_KM;

      // magnitude → linear brightness, compressed so mag 6 stars stay visible
      const brightness = Math.min(Math.pow(10, (1.6 - mag) / 4.5), 1.6);
      bvToColor(bv, color);
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = -1; // behind everything else
    this.group.add(points);
    this.materials.push(mat);
    this.baseOpacity.push(opacity);
  }

  /**
   * Fade the field by how bright the sky is (0 = space, 1 = full daylight).
   */
  setSkyBrightness(skyBrightness: number): void {
    const visible = Math.min(Math.max(1 - skyBrightness * 1.4, 0), 1);
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].opacity = this.baseOpacity[i] * visible;
    }
    this.group.visible = visible > 0.01;
  }
}
