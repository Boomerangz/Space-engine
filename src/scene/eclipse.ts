import type { SolarSystem, Body } from '../ephemeris/bodies';
import { Vec3d } from '../core/math/vec3d';

const tmp = new Vec3d();
const tmpSun = new Vec3d();

/**
 * Fraction of a disc of angular radius `r1` covered by one of radius `r2`
 * whose centre is `sep` away (all radians). Standard circle-circle overlap.
 */
export function discOverlap(r1: number, r2: number, sep: number): number {
  if (sep >= r1 + r2) return 0; // no contact
  if (sep <= r2 - r1) return 1; // fully covered
  if (sep <= r1 - r2) return (r2 * r2) / (r1 * r1); // occulter fully inside
  const a1 = Math.acos(
    Math.min(Math.max((sep * sep + r1 * r1 - r2 * r2) / (2 * sep * r1), -1), 1),
  );
  const a2 = Math.acos(
    Math.min(Math.max((sep * sep + r2 * r2 - r1 * r1) / (2 * sep * r2), -1), 1),
  );
  const area = r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
  return Math.min(area / (Math.PI * r1 * r1), 1);
}

/**
 * Fraction of the Sun's disc still visible from `point` (ecliptic km),
 * accounting for every other body that may be in the way. 1 = full Sun,
 * 0 = totality. This darkens the Moon during a lunar eclipse and dims the
 * ground under the Moon's shadow during a solar one.
 */
export function sunVisibility(
  system: SolarSystem,
  point: Vec3d,
  ignore: Body | null,
): number {
  const sun = system.byId.get('sun')!;
  Vec3d.subVectors(sun.worldPosition, point, tmpSun);
  const sunDist = tmpSun.length();
  if (sunDist === 0) return 1;
  const sunAngular = Math.asin(Math.min(sun.def.radiusKm / sunDist, 1));

  let visible = 1;
  for (const body of system.bodies) {
    if (body === sun || body === ignore) continue;
    Vec3d.subVectors(body.worldPosition, point, tmp);
    const dist = tmp.length();
    if (dist === 0 || dist >= sunDist) continue; // behind the Sun, or self
    const bodyAngular = Math.asin(Math.min(body.def.radiusKm / dist, 1));
    const cos = Math.min(Math.max(tmp.dot(tmpSun) / (dist * sunDist), -1), 1);
    visible *= 1 - discOverlap(sunAngular, bodyAngular, Math.acos(cos));
    if (visible <= 0) return 0;
  }
  return visible;
}
