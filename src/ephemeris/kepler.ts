import { Vec3d } from '../core/math/vec3d';

const DEG = Math.PI / 180;

/**
 * Solve Kepler's equation M = E - e·sin(E) for the eccentric anomaly E
 * (elliptic case, e < 1) with Newton–Raphson iteration.
 */
export function solveKepler(M: number, e: number): number {
  // normalize M to [-π, π] for fast convergence
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  else if (M < -Math.PI) M += 2 * Math.PI;

  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Classical orbital elements at some instant.
 * Angles in RADIANS, semi-major axis in km.
 */
export interface OrbitalElements {
  a: number; // semi-major axis, km
  e: number; // eccentricity
  i: number; // inclination
  Omega: number; // longitude of ascending node
  omega: number; // argument of periapsis
  M: number; // mean anomaly
}

/**
 * Position in the parent-centric ecliptic frame (km).
 * Axes: x toward vernal equinox, z toward north ecliptic pole
 * (right-handed; the renderer maps this to its own Y-up frame).
 */
export function elementsToPosition(el: OrbitalElements, out = new Vec3d()): Vec3d {
  const { a, e, i, Omega, omega } = el;
  const E = solveKepler(el.M, e);

  // position in the orbital plane (periapsis on +x)
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cO = Math.cos(Omega);
  const sO = Math.sin(Omega);
  const co = Math.cos(omega);
  const so = Math.sin(omega);
  const ci = Math.cos(i);
  const si = Math.sin(i);

  const x = (cO * co - sO * so * ci) * xp + (-cO * so - sO * co * ci) * yp;
  const y = (sO * co + cO * so * ci) * xp + (-sO * so + cO * co * ci) * yp;
  const z = si * so * xp + si * co * yp;
  return out.set(x, y, z);
}

/**
 * JPL "Approximate Positions of the Planets" element set:
 * value at J2000 + linear rate per Julian century. a in km (converted from
 * AU by the loader), angles in degrees. L is mean longitude, varpi the
 * longitude of perihelion.
 */
export interface JplApproxElements {
  a: [number, number];
  e: [number, number];
  i: [number, number];
  L: [number, number];
  varpi: [number, number];
  Omega: [number, number];
}

/** Evaluate a JPL element set at T Julian centuries from J2000. */
export function jplElementsAt(el: JplApproxElements, T: number): OrbitalElements {
  const a = el.a[0] + el.a[1] * T;
  const e = el.e[0] + el.e[1] * T;
  const i = (el.i[0] + el.i[1] * T) * DEG;
  const L = (el.L[0] + el.L[1] * T) * DEG;
  const varpi = (el.varpi[0] + el.varpi[1] * T) * DEG;
  const Omega = (el.Omega[0] + el.Omega[1] * T) * DEG;
  return { a, e, i, Omega, omega: varpi - Omega, M: L - varpi };
}
