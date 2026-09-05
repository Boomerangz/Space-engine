import type { JplApproxElements } from './kepler';
import type { TerrainParams } from '../terrain/heightfield';
import type { AtmosphereParams } from '../atmosphere/scattering';

export type BodyType = 'star' | 'planet' | 'dwarf' | 'moon';

/**
 * Heliocentric orbit from the JPL "Approximate Positions of the Planets"
 * table (a in AU + rate per Julian century; angles in degrees).
 */
export interface JplOrbit {
  kind: 'jpl';
  elements: JplApproxElements;
}

/**
 * Simple fixed-element orbit (used for moons, parent-centric).
 * Angles in degrees, a in km. M0 is the mean anomaly at J2000.
 */
export interface SimpleOrbit {
  kind: 'simple';
  aKm: number;
  e: number;
  iDeg: number;
  OmegaDeg: number;
  omegaDeg: number;
  periodDays: number; // negative = retrograde
  M0Deg: number;
}

export interface BodyDef {
  id: string;
  name: string;
  type: BodyType;
  parent: string | null;
  radiusKm: number;
  axialTiltDeg?: number;
  /** Sidereal rotation period in hours; negative = retrograde. */
  rotationPeriodH?: number;
  texture?: string;
  /** Fallback albedo color when no texture is available. */
  color?: string;
  /** HDR emissive color (stars). */
  emissiveHdr?: [number, number, number];
  orbit?: JplOrbit | SimpleOrbit;
  ring?: { innerKm: number; outerKm: number; texture?: string };
  /** Procedural relief for solid bodies; absent for stars/gas giants. */
  terrain?: TerrainParams;
  atmosphere?: AtmosphereParams;
  /** Emissive night-side texture (city lights). */
  nightTexture?: string;
  /** White-on-black cloud map, used as an alpha mask on a shell above the surface. */
  cloudTexture?: string;
}

export interface SystemDef {
  bodies: BodyDef[];
}
