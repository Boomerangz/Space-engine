import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Body, SolarSystem } from '../ephemeris/bodies';
import { elementsToPosition } from '../ephemeris/kepler';
import { Vec3d } from '../core/math/vec3d';

/**
 * Ecliptic f64 frame (z = north ecliptic pole) → render frame (y-up), f32.
 * Positions handed to the GPU are always relative to the focus body, which
 * keeps f32 precision where the camera is (origin rebasing; M2 generalizes
 * this to fully camera-relative rendering).
 */
export function eclToRender(v: Vec3d, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v.x, v.z, -v.y);
}

const tmp = new Vec3d();
const tmpQ = new THREE.Quaternion();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ORBIT_COLORS: Record<string, number> = {
  planet: 0x3b6ea8,
  dwarf: 0x63586e,
  moon: 0x4a7a62,
};

class BodyView {
  readonly mesh: THREE.Mesh;
  readonly label: CSS2DObject;
  readonly labelEl: HTMLDivElement;
  orbitLine: THREE.Line | null = null;
  private readonly tiltQ = new THREE.Quaternion();

  constructor(
    readonly body: Body,
    onSelect: (b: Body) => void,
  ) {
    const def = body.def;
    let material: THREE.Material;
    if (def.emissiveHdr) {
      const mat = new THREE.MeshBasicMaterial();
      mat.color.setRGB(...def.emissiveHdr);
      material = mat;
    } else {
      material = new THREE.MeshStandardMaterial({
        color: def.color ?? '#888888',
        roughness: 0.95,
        metalness: 0,
      });
    }
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(def.radiusKm, 96, 48), material);
    this.tiltQ.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(def.axialTiltDeg ?? 0));

    this.labelEl = document.createElement('div');
    this.labelEl.className = `body-label body-label-${def.type}`;
    this.labelEl.textContent = def.name;
    this.labelEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onSelect(body);
    });
    this.label = new CSS2DObject(this.labelEl);
    this.mesh.add(this.label);
  }

  async loadTexture(loader: THREE.TextureLoader): Promise<void> {
    const file = this.body.def.texture;
    if (!file) return;
    try {
      const tex = await loader.loadAsync(`/textures/${file}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const mat = this.mesh.material as THREE.MeshStandardMaterial;
      if ('map' in mat) {
        mat.map = tex;
        mat.color.set('#ffffff');
        mat.needsUpdate = true;
      }
    } catch {
      // keep the fallback color; texture is optional
    }
  }

  /** Build the orbit ellipse polyline in the parent frame. */
  buildOrbitLine(jd: number): void {
    const el = this.body.elementsAt(jd);
    if (!el) return;
    const N = 256;
    const positions = new Float32Array((N + 1) * 3);
    const v = new THREE.Vector3();
    for (let k = 0; k <= N; k++) {
      elementsToPosition({ ...el, M: (k / N) * 2 * Math.PI }, tmp);
      eclToRender(tmp, v);
      positions[k * 3] = v.x;
      positions[k * 3 + 1] = v.y;
      positions[k * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const color = ORBIT_COLORS[this.body.def.type] ?? 0x444444;
    this.orbitLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
    );
    this.orbitLine.frustumCulled = false;
  }

  /** Update render-space transform relative to the focus body. */
  sync(focusWorld: Vec3d): void {
    Vec3d.subVectors(this.body.worldPosition, focusWorld, tmp);
    eclToRender(tmp, this.mesh.position);

    tmpQ.setFromAxisAngle(Y_AXIS, this.body.spin);
    this.mesh.quaternion.copy(this.tiltQ).multiply(tmpQ);

    if (this.orbitLine) {
      const parent = this.body.parent!;
      Vec3d.subVectors(parent.worldPosition, focusWorld, tmp);
      eclToRender(tmp, this.orbitLine.position);
    }
  }
}

export class SystemView {
  readonly group = new THREE.Group();
  readonly views = new Map<string, BodyView>();
  private readonly sunLight: THREE.PointLight;

  constructor(
    readonly system: SolarSystem,
    jd: number,
    onSelect: (b: Body) => void,
  ) {
    for (const body of system.bodies) {
      const view = new BodyView(body, onSelect);
      view.buildOrbitLine(jd);
      this.views.set(body.def.id, view);
      this.group.add(view.mesh);
      if (view.orbitLine) this.group.add(view.orbitLine);
      this.addRing(body, view);
    }

    this.sunLight = new THREE.PointLight(0xffffff, 3.2, 0, 0);
    this.group.add(this.sunLight);
    this.group.add(new THREE.AmbientLight(0xffffff, 0.03));
  }

  private addRing(body: Body, view: BodyView): void {
    const ring = body.def.ring;
    if (!ring) return;
    const geo = new THREE.RingGeometry(ring.innerKm, ring.outerKm, 256, 1);
    // remap UVs so u runs radially (ring textures are radial strips)
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v3 = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v3.fromBufferAttribute(pos, i);
      const u = (v3.length() - ring.innerKm) / (ring.outerKm - ring.innerKm);
      uv.setXY(i, u, 0.5);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xbfae8f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      roughness: 1,
    });
    if (ring.texture) {
      new THREE.TextureLoader().loadAsync(`/textures/${ring.texture}`).then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.map = tex;
        mat.color.set('#ffffff');
        mat.needsUpdate = true;
      }).catch(() => undefined);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // into the body's equatorial plane
    view.mesh.add(mesh);
  }

  async loadTextures(): Promise<void> {
    const loader = new THREE.TextureLoader();
    await Promise.all([...this.views.values()].map((v) => v.loadTexture(loader)));
  }

  /** Recompute render transforms with the focus body at the origin. */
  sync(focus: Body): void {
    const focusWorld = focus.worldPosition;
    for (const view of this.views.values()) view.sync(focusWorld);
    const sun = this.system.byId.get('sun')!;
    Vec3d.subVectors(sun.worldPosition, focusWorld, tmp);
    eclToRender(tmp, this.sunLight.position);
  }
}
