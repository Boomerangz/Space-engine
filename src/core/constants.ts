/**
 * Physical constants. World units on the CPU side are kilometers,
 * stored in f64 (native JS numbers).
 */
export const AU_KM = 149_597_870.7;
export const SUN_RADIUS_KM = 695_700;
export const EARTH_RADIUS_KM = 6_371;

/** Gravitational parameter of the Sun, km^3/s^2 (used by the Kepler solver). */
export const GM_SUN = 1.327_124_400_18e11;

export const SECONDS_PER_DAY = 86_400;
