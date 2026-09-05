import * as THREE from 'three/webgpu';
import type { Body, SolarSystem } from '../ephemeris/bodies';
import { Vec3d } from '../core/math/vec3d';
import { eclToRender } from '../scene/system-view';

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpD = new Vec3d();

/** Render-frame vector → ecliptic frame (inverse of eclToRender). */
function renderToEcl(v: THREE.Vector3, out: Vec3d): Vec3d {
  return out.set(v.x, -v.z, v.y);
}

/**
 * Camera controller with SpaceEngine-like semantics.
 *
 * State lives in f64: `offset` is the camera position relative to the focus
 * body in render axes (JS numbers are doubles, so THREE.Vector3 is fine as
 * storage — precision is only lost on GPU upload, which always sees small
 * camera-relative values because the render world is origin-rebased to the
 * focus body).
 *
 * Modes:
 *  - orbit: trackball around the focus body, wheel zooms exponentially
 *  - fly:   WASD + drag look free flight; speed scales with the distance
 *           to the nearest body surface (wheel adjusts a multiplier)
 */
export class CameraRig {
  mode: 'orbit' | 'fly' = 'orbit';
  focus: Body;
  readonly offset = new THREE.Vector3();
  private readonly orientation = new THREE.Quaternion();
  private flyTarget = 0; // >0: glide toward this distance from focus
  private speedFactor = 1;
  private readonly keys = new Set<string>();
  private dragging = false;

  /** Distance from the camera to the nearest body surface, km. */
  surfaceDistance = Infinity;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly system: SolarSystem,
    focus: Body,
    dom: HTMLElement,
  ) {
    this.focus = focus;
    this.attach(dom);
  }

  /** Camera world position (ecliptic, km, f64). */
  worldPosition(out = new Vec3d()): Vec3d {
    renderToEcl(this.offset, out);
    return out.add(this.focus.worldPosition);
  }

  setDistance(d: number): void {
    this.offset.setLength(d);
  }

  /** Set the orbit distance and cancel any glide-in (used by tests). */
  park(d: number): void {
    this.flyTarget = 0;
    this.offset.setLength(d);
  }

  distance(): number {
    return this.offset.length();
  }

  /** Place the camera at an offset from the focus body, looking at it. */
  spawnAt(offset: THREE.Vector3): void {
    this.offset.copy(offset);
    this.lookAtFocus();
  }

  /** Switch focus, preserving the camera's true world position, then glide in. */
  flyTo(body: Body): void {
    if (body === this.focus) {
      this.flyTarget = body.def.radiusKm * 4;
      return;
    }
    eclToRender(Vec3d.subVectors(this.focus.worldPosition, body.worldPosition, tmpD), tmpV);
    this.offset.add(tmpV);
    this.focus = body;
    this.mode = 'orbit';
    this.flyTarget = body.def.radiusKm * 4;
    this.lookAtFocus();
  }

  private attach(dom: HTMLElement): void {
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 0) {
        this.dragging = true;
        dom.setPointerCapture(e.pointerId);
      }
    });
    dom.addEventListener('pointerup', () => (this.dragging = false));
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.movementX * 0.004;
      const dy = e.movementY * 0.004;
      if (this.mode === 'orbit') this.orbitRotate(dx, dy);
      else this.flyLook(dx, dy);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = Math.exp(-Math.sign(e.deltaY) * 0.18);
        if (this.mode === 'orbit') {
          this.flyTarget = 0;
          const minD = this.focus.def.radiusKm * 1.02;
          this.offset.setLength(Math.max(this.distance() * (1 / k), minD));
        } else {
          this.speedFactor = THREE.MathUtils.clamp(this.speedFactor * k, 0.01, 100);
        }
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat) this.toggleMode();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  toggleMode(): void {
    this.mode = this.mode === 'orbit' ? 'fly' : 'orbit';
    if (this.mode === 'orbit') this.lookAtFocus();
    this.flyTarget = 0;
  }

  private orbitRotate(dx: number, dy: number): void {
    // trackball: rotate the offset about camera-up (yaw) and camera-right (pitch)
    const up = tmpV.set(0, 1, 0).applyQuaternion(this.orientation).clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.orientation);
    tmpQ.setFromAxisAngle(up, dx);
    this.offset.applyQuaternion(tmpQ);
    tmpQ.setFromAxisAngle(right, dy);
    this.offset.applyQuaternion(tmpQ);
    this.lookAtFocus();
  }

  private flyLook(dx: number, dy: number): void {
    const yaw = tmpQ.setFromAxisAngle(tmpV.set(0, 1, 0), -dx);
    this.orientation.multiply(yaw);
    const pitch = tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), -dy);
    this.orientation.multiply(pitch);
    this.orientation.normalize();
  }

  private lookAtFocus(): void {
    // aim the camera at the focus body (origin of the render world)
    const m = new THREE.Matrix4().lookAt(
      this.offset,
      new THREE.Vector3(0, 0, 0),
      tmpV.set(0, 1, 0).applyQuaternion(this.orientation),
    );
    this.orientation.setFromRotationMatrix(m);
  }

  update(dt: number): void {
    this.updateSurfaceDistance();

    if (this.mode === 'fly') {
      // exponential speed: proportional to the distance from the nearest surface
      const speed = Math.max(this.surfaceDistance, 0.005) * 1.2 * this.speedFactor;
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.z -= 1;
      if (this.keys.has('KeyS')) move.z += 1;
      if (this.keys.has('KeyA')) move.x -= 1;
      if (this.keys.has('KeyD')) move.x += 1;
      if (this.keys.has('KeyR') || this.keys.has('Space')) move.y += 1;
      if (this.keys.has('KeyV') || this.keys.has('ShiftLeft')) move.y -= 1;
      if (this.keys.has('KeyQ')) this.roll(dt * 1.5);
      if (this.keys.has('KeyE')) this.roll(-dt * 1.5);
      if (move.lengthSq() > 0) {
        move.normalize().applyQuaternion(this.orientation).multiplyScalar(speed * dt);
        this.offset.add(move);
      }
    } else if (this.flyTarget > 0) {
      const d = this.distance();
      const nd = THREE.MathUtils.damp(d, this.flyTarget, 4, dt);
      this.offset.setLength(nd);
      if (Math.abs(nd - this.flyTarget) < this.flyTarget * 0.02) this.flyTarget = 0;
    }

    this.camera.position.copy(this.offset);
    this.camera.quaternion.copy(this.orientation);

    // dynamic near plane keeps depth precision from planetary to surface scales
    const near = THREE.MathUtils.clamp(this.surfaceDistance * 0.25, 0.0005, 1e5);
    if (Math.abs(near - this.camera.near) / near > 0.5) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  private roll(angle: number): void {
    tmpQ.setFromAxisAngle(tmpV.set(0, 0, 1), angle);
    this.orientation.multiply(tmpQ).normalize();
  }

  private updateSurfaceDistance(): void {
    const camWorld = this.worldPosition(tmpD);
    let best = Infinity;
    for (const body of this.system.bodies) {
      const d = camWorld.distanceTo(body.worldPosition) - body.def.radiusKm;
      if (d < best) best = d;
    }
    this.surfaceDistance = best;
  }
}
