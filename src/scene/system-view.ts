import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Body, SolarSystem } from '../ephemeris/bodies';
import { elementsToPosition } from '../ephemeris/kepler';
import { Vec3d } from '../core/math/vec3d';
import { PlanetTerrain } from '../terrain/planet-terrain';
import { TerrainWorkerPool } from '../terrain/pool';
import { Heightfield } from '../terrain/heightfield';
import { Atmosphere } from '../atmosphere/scattering';
import type { CameraRig } from '../camera/rig';

/**
 * Ecliptic f64 frame (z = north ecliptic pole) → render frame (y-up), f32.
 * Positions handed to the GPU are always relative to the focus body, which
 * keeps f32 precision where the camera is.
 */
export function eclToRender(v: Vec3d, out: THREE.Vector3): THREE.Vector3 {
  return out.set(v.x, v.z, -v.y);
}

const tmp = new Vec3d();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ORBIT_COLORS: Record<string, number> = {
  planet: 0x3b6ea8,
  dwarf: 0x63586e,
  moon: 0x4a7a62,
};

class BodyView {
  /** Carries the body's render-space position and rotation. */
  readonly anchor = new THREE.Group();
  readonly sphere: THREE.Mesh;
  readonly labelEl: HTMLDivElement;
  clouds: THREE.Mesh | null = null;
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
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(def.radiusKm, 96, 48), material);
    this.anchor.add(this.sphere);
    this.tiltQ.setFromAxisAngle(X_AXIS, THREE.MathUtils.degToRad(def.axialTiltDeg ?? 0));

    this.labelEl = document.createElement('div');
    this.labelEl.className = `body-label body-label-${def.type}`;
    this.labelEl.textContent = def.name;
    this.labelEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      onSelect(body);
    });
    this.anchor.add(new CSS2DObject(this.labelEl));
  }

  /** Material used both by the far sphere and by terrain chunks. */
  get surfaceMaterial(): THREE.Material {
    return this.sphere.material as THREE.Material;
  }

  async loadTexture(loader: THREE.TextureLoader): Promise<void> {
    const def = this.body.def;
    const mat = this.sphere.material as THREE.MeshStandardMaterial;
    if (def.texture) {
      try {
        const tex = await loader.loadAsync(`/textures/${def.texture}`);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = THREE.RepeatWrapping; // terrain UVs unwrap across the seam
        if ('map' in mat) {
          mat.map = tex;
          mat.color.set('#ffffff');
          mat.needsUpdate = true;
        }
      } catch {
        // keep the fallback color; texture is optional
      }
    }
    if (def.cloudTexture) {
      try {
        const tex = await loader.loadAsync(`/textures/${def.cloudTexture}`);
        tex.anisotropy = 4;
        tex.wrapS = THREE.RepeatWrapping;
        // the NASA cloud map is white-on-black: use it as the alpha channel
        const cloudMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          alphaMap: tex,
          transparent: true,
          depthWrite: false,
          roughness: 1,
          metalness: 0,
        });
        this.clouds = new THREE.Mesh(
          new THREE.SphereGeometry(def.radiusKm + 8, 96, 48),
          cloudMat,
        );
        this.clouds.renderOrder = 1;
        this.anchor.add(this.clouds);
      } catch {
        // optional
      }
    }
    if (def.nightTexture && 'emissiveMap' in mat) {
      try {
        const tex = await loader.loadAsync(`/textures/${def.nightTexture}`);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        mat.emissiveMap = tex;
        mat.emissive.set('#ffffff');
        mat.emissiveIntensity = 0.35;
        mat.needsUpdate = true;
      } catch {
        // optional
      }
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
    eclToRender(tmp, this.anchor.position);

    tmpQ.setFromAxisAngle(Y_AXIS, this.body.spin);
    this.anchor.quaternion.copy(this.tiltQ).multiply(tmpQ);

    // clouds drift slowly westward relative to the ground
    if (this.clouds) this.clouds.rotation.y = this.body.spin * 0.02;

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
  private readonly terrains = new Map<string, PlanetTerrain>();
  private readonly heightfields = new Map<string, Heightfield>();
  private readonly atmospheres = new Map<string, Atmosphere>();
  private readonly pool = new TerrainWorkerPool();
  /** Fraction of the Sun's disc visible from the focus body, 1 = no eclipse. */
  eclipseFactor = 1;
  private readonly sunBaseIntensity = 3.2;

  constructor(
    readonly system: SolarSystem,
    jd: number,
    onSelect: (b: Body) => void,
  ) {
    for (const body of system.bodies) {
      const view = new BodyView(body, onSelect);
      view.buildOrbitLine(jd);
      this.views.set(body.def.id, view);
      this.group.add(view.anchor);
      if (view.orbitLine) this.group.add(view.orbitLine);
      this.addRing(body, view);
      if (body.def.atmosphere) {
        const atmo = new Atmosphere(body.def.radiusKm, body.def.atmosphere);
        view.anchor.add(atmo.mesh);
        this.atmospheres.set(body.def.id, atmo);
      }
      if (body.def.type === 'star') this.addStarGlow(view);
    }

    this.sunLight = new THREE.PointLight(0xffffff, this.sunBaseIntensity, 0, 0);
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
      new THREE.TextureLoader()
        .loadAsync(`/textures/${ring.texture}`)
        .then((tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          mat.map = tex;
          mat.color.set('#ffffff');
          mat.needsUpdate = true;
        })
        .catch(() => undefined);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // into the body's equatorial plane
    view.anchor.add(mesh);
  }

  async loadTextures(): Promise<void> {
    const loader = new THREE.TextureLoader();
    await Promise.all([...this.views.values()].map((v) => v.loadTexture(loader)));
  }

  private addStarGlow(view: BodyView): void {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,240,220,0.85)');
    grad.addColorStop(0.25, 'rgba(255,220,180,0.28)');
    grad.addColorStop(0.6, 'rgba(255,200,150,0.07)');
    grad.addColorStop(1, 'rgba(255,190,140,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(mat);
    const r = view.body.def.radiusKm;
    sprite.scale.set(r * 9, r * 9, 1);
    view.anchor.add(sprite);
  }

  /** Recompute render transforms with the focus body at the origin. */
  sync(focus: Body): void {
    const focusWorld = focus.worldPosition;
    for (const view of this.views.values()) view.sync(focusWorld);
    const sun = this.system.byId.get('sun')!;
    Vec3d.subVectors(sun.worldPosition, focusWorld, tmp);
    eclToRender(tmp, this.sunLight.position);

    // eclipse dimming, evaluated at the focus body (what the camera sees lit)
    this.eclipseFactor = this.sunVisibility(focus.worldPosition, focus);
    this.sunLight.intensity = this.sunBaseIntensity * (0.02 + 0.98 * this.eclipseFactor);

    for (const [id, atmo] of this.atmospheres) {
      const anchor = this.views.get(id)!.anchor;
      atmo.uCenter.value.copy(anchor.position);
      atmo.uSunDir.value.copy(this.sunLight.position).sub(anchor.position).normalize();
    }
  }

  /**
   * Drive the LOD terrain of the focused body. `cameraOffset` is the camera
   * position relative to the focus body's center in render axes (rig.offset).
   */
  updateTerrain(focus: Body, cameraOffset: THREE.Vector3): void {
    for (const [id, terrain] of this.terrains) {
      if (id !== focus.def.id) {
        terrain.group.visible = false;
        this.views.get(id)!.sphere.visible = true;
      }
    }
    if (!focus.def.terrain) return;
    const view = this.views.get(focus.def.id)!;
    const active = cameraOffset.length() < focus.def.radiusKm * 8;

    let terrain = this.terrains.get(focus.def.id);
    if (!terrain) {
      if (!active) return;
      terrain = new PlanetTerrain(focus, view.surfaceMaterial, this.pool);
      view.anchor.add(terrain.group);
      this.terrains.set(focus.def.id, terrain);
    }

    // camera in the planet's rotating local frame
    tmpQ.copy(view.anchor.quaternion).invert();
    tmpV.copy(cameraOffset).applyQuaternion(tmpQ);
    terrain.update(tmpV);

    const show = active && terrain.ready;
    terrain.group.visible = show;
    view.sphere.visible = !show;
  }

  /**
   * Fraction of the Sun's disc still visible from `point` (ecliptic km),
   * accounting for every other body that may be in the way. 1 = full Sun,
   * 0 = totality. This is what darkens the Moon during a lunar eclipse and
   * dims the ground under the Moon's shadow during a solar one.
   */
  private sunVisibility(point: Vec3d, ignore: Body | null): number {
    const sun = this.system.byId.get('sun')!;
    Vec3d.subVectors(sun.worldPosition, point, tmp);
    const sunDist = tmp.length();
    if (sunDist === 0) return 1;
    const sunAngular = Math.asin(Math.min(sun.def.radiusKm / sunDist, 1));
    const toSun = tmp.clone().multiplyScalar(1 / sunDist);

    let visible = 1;
    for (const body of this.system.bodies) {
      if (body === sun || body === ignore) continue;
      Vec3d.subVectors(body.worldPosition, point, tmp);
      const dist = tmp.length();
      if (dist === 0 || dist >= sunDist) continue; // behind the Sun, or self
      const bodyAngular = Math.asin(Math.min(body.def.radiusKm / dist, 1));
      const sep = Math.acos(Math.min(Math.max(tmp.dot(toSun) / dist, -1), 1));
      visible *= 1 - discOverlap(sunAngular, bodyAngular, sep);
      if (visible <= 0) return 0;
    }
    return visible;
  }

  /**
   * How bright the sky is where the camera sits: 0 in space or at night,
   * 1 under a high Sun inside an atmosphere. Used to fade the starfield.
   */
  skyBrightness(rig: CameraRig): number {
    const def = rig.focus.def;
    const atmosphere = def.atmosphere;
    if (!atmosphere) return 0;
    const altitude = rig.offset.length() - def.radiusKm;
    if (altitude > atmosphere.topKm) return 0;
    // thickest at the surface, gone at the top of the atmosphere
    const density = 1 - Math.min(Math.max(altitude / atmosphere.topKm, 0), 1);

    const view = this.views.get(def.id)!;
    tmpV.copy(this.sunLight.position).sub(view.anchor.position).normalize();
    const up = tmpV2.copy(rig.offset).normalize();
    const sunElevation = tmpV.dot(up); // 1 = zenith, <0 = below the horizon
    // twilight fades out over roughly 18 deg below the horizon
    const daylight = Math.min(Math.max((sunElevation + 0.31) / 0.4, 0), 1);
    return density * daylight * this.eclipseFactor;
  }

  /**
   * Keep the camera above the terrain of the focused body and report the
   * true altitude (drives the exponential fly speed). Uses the same
   * heightfield the mesh workers use, so the clamp matches the geometry.
   */
  applyTerrainClamp(focus: Body, rig: CameraRig): void {
    const def = focus.def;
    if (!def.terrain) {
      rig.terrainAltitude = Infinity;
      return;
    }
    const view = this.views.get(def.id)!;
    let hf = this.heightfields.get(def.id);
    if (!hf) {
      hf = new Heightfield(def.terrain, def.radiusKm);
      this.heightfields.set(def.id, hf);
    }
    tmpQ.copy(view.anchor.quaternion).invert();
    tmpV.copy(rig.offset).applyQuaternion(tmpQ).normalize();
    const h = hf.heightAt(tmpV.x, tmpV.y, tmpV.z, 0.005);
    const surfaceR = def.radiusKm + h;
    const minR = surfaceR + 0.004; // hold ~4 m above the ground
    if (rig.offset.length() < minR) rig.offset.setLength(minR);
    rig.terrainAltitude = rig.offset.length() - surfaceR;
    rig.surfaceDistance = Math.min(rig.surfaceDistance, rig.terrainAltitude);
  }
}

/**
 * Fraction of a disc of angular radius `r1` covered by one of radius `r2`
 * whose centre is `sep` away (all radians). Standard circle-circle overlap.
 */
function discOverlap(r1: number, r2: number, sep: number): number {
  if (sep >= r1 + r2) return 0; // no contact
  if (sep <= r2 - r1) return 1; // fully covered
  if (sep <= r1 - r2) return (r2 * r2) / (r1 * r1); // occulter fully inside
  const d = sep;
  const a1 = Math.acos(Math.min(Math.max((d * d + r1 * r1 - r2 * r2) / (2 * d * r1), -1), 1));
  const a2 = Math.acos(Math.min(Math.max((d * d + r2 * r2 - r1 * r1) / (2 * d * r2), -1), 1));
  const area =
    r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return Math.min(area / (Math.PI * r1 * r1), 1);
}
