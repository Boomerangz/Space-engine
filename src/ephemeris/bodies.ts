import { Vec3d } from '../core/math/vec3d';
import { AU_KM } from '../core/constants';
import { JD_J2000 } from '../core/time/simclock';
import {
  elementsToPosition,
  jplElementsAt,
  type OrbitalElements,
} from './kepler';
import type { BodyDef, SystemDef } from './types';

const DEG = Math.PI / 180;
const DAYS_PER_CENTURY = 36525;

/**
 * Runtime body: definition + f64 state (positions in km, ecliptic frame).
 */
export class Body {
  parent: Body | null = null;
  readonly children: Body[] = [];
  /** Position relative to the parent body, km. */
  readonly localPosition = new Vec3d();
  /** Heliocentric position, km. */
  readonly worldPosition = new Vec3d();
  /** Rotation angle about the body's spin axis, radians. */
  spin = 0;

  constructor(readonly def: BodyDef) {}

  /** Orbital elements at the given Julian Date (null for the root). */
  elementsAt(jd: number): OrbitalElements | null {
    const orbit = this.def.orbit;
    if (!orbit) return null;
    if (orbit.kind === 'jpl') {
      const T = (jd - JD_J2000) / DAYS_PER_CENTURY;
      const el = jplElementsAt(orbit.elements, T);
      el.a *= AU_KM;
      return el;
    }
    const n = (2 * Math.PI) / orbit.periodDays; // rad/day, sign carries retrograde
    return {
      a: orbit.aKm,
      e: orbit.e,
      i: orbit.iDeg * DEG,
      Omega: orbit.OmegaDeg * DEG,
      omega: orbit.omegaDeg * DEG,
      M: orbit.M0Deg * DEG + n * (jd - JD_J2000),
    };
  }

  /** Recompute local/world position and spin (parents must update first). */
  update(jd: number): void {
    const el = this.elementsAt(jd);
    if (el) {
      elementsToPosition(el, this.localPosition);
    } else {
      this.localPosition.set(0, 0, 0);
    }
    this.worldPosition.copy(this.localPosition);
    if (this.parent) this.worldPosition.add(this.parent.worldPosition);

    const period = this.def.rotationPeriodH;
    if (period) {
      const hours = (jd - JD_J2000) * 24;
      this.spin = ((hours / period) % 1) * 2 * Math.PI;
    }
  }
}

export class SolarSystem {
  readonly bodies: Body[] = [];
  readonly byId = new Map<string, Body>();

  static fromDef(def: SystemDef): SolarSystem {
    const system = new SolarSystem();
    for (const bodyDef of def.bodies) {
      const body = new Body(bodyDef);
      system.bodies.push(body);
      system.byId.set(bodyDef.id, body);
    }
    for (const body of system.bodies) {
      if (body.def.parent) {
        const parent = system.byId.get(body.def.parent);
        if (!parent) throw new Error(`Unknown parent '${body.def.parent}' for '${body.def.id}'`);
        body.parent = parent;
        parent.children.push(body);
      }
    }
    // definition order puts parents before children, but sort defensively
    system.bodies.sort((a, b) => depth(a) - depth(b));
    return system;
  }

  update(jd: number): void {
    for (const body of this.bodies) body.update(jd);
  }
}

function depth(b: Body): number {
  let d = 0;
  for (let p = b.parent; p; p = p.parent) d++;
  return d;
}
