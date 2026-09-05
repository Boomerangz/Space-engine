import * as THREE from 'three/webgpu';
import { Fn, If, float, positionLocal, texture, uniform, vec2, vec3 } from 'three/tsl';

/**
 * Mutual shadowing between a ringed planet and its rings, evaluated in the
 * body's local (equatorial) frame where the ring plane is y = 0.
 *
 * `sunDir` is the direction toward the Sun expressed in that same local
 * frame — SystemView rotates the world-space sun direction into it each
 * frame, so the shadows track the real geometry as the planet orbits.
 */
export class RingShadow {
  /** Direction to the Sun in the planet's local frame. */
  readonly uSunDir = uniform(new THREE.Vector3(1, 0, 0));

  constructor(
    private readonly radiusKm: number,
    private readonly innerKm: number,
    private readonly outerKm: number,
  ) {}

  /**
   * Shadow term for the planet's surface: 1 in full light, lower where the
   * ring plane blocks the Sun. `ringAlpha` is the ring's opacity texture,
   * sampled at the radius where the sunward ray crosses the ring plane.
   */
  planetShadowNode(ringAlpha: THREE.Texture | null) {
    const inner = float(this.innerKm);
    const outer = float(this.outerKm);
    const sunDir = this.uSunDir;

    return Fn(() => {
      const p = positionLocal.toVar();
      const shade = float(1).toVar();
      // travel toward the Sun; the ring plane is crossed when y reaches 0
      const t = p.y.negate().div(sunDir.y).toVar();
      If(t.greaterThan(0), () => {
        const hit = p.add(sunDir.mul(t)).toVar();
        const r = hit.xz.length().toVar();
        If(r.greaterThan(inner).and(r.lessThan(outer)), () => {
          const u = r.sub(inner).div(outer.sub(inner));
          const density = ringAlpha
            ? texture(ringAlpha, vec2(u, 0.5)).a
            : float(0.8);
          shade.assign(float(1).sub(density.mul(0.85)));
        });
      });
      return vec3(shade, shade, shade);
    })();
  }

  /**
   * Shadow term for the ring surface: darkened where the planet's disc
   * blocks the Sun (a cylinder test along the sunward ray).
   */
  ringShadowNode() {
    const R = float(this.radiusKm);
    const sunDir = this.uSunDir;

    return Fn(() => {
      const p = positionLocal.toVar();
      const shade = float(1).toVar();
      // distance from the planet centre to the sunward ray from this point
      const along = p.dot(sunDir).negate().toVar();
      If(along.greaterThan(0), () => {
        const closest = p.add(sunDir.mul(along));
        If(closest.length().lessThan(R), () => {
          shade.assign(float(0.12));
        });
      });
      return vec3(shade, shade, shade);
    })();
  }
}
