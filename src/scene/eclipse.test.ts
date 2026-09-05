import { describe, expect, it } from 'vitest';
import { discOverlap, sunVisibility } from './eclipse';
import { SolarSystem } from '../ephemeris/bodies';
import type { SystemDef } from '../ephemeris/types';
import systemJson from '../data/solar-system.json';
import { JD_J2000 } from '../core/time/simclock';

const system = SolarSystem.fromDef(systemJson as SystemDef);

describe('discOverlap', () => {
  it('handles the degenerate cases', () => {
    expect(discOverlap(1, 1, 3)).toBe(0); // far apart
    expect(discOverlap(1, 2, 0.5)).toBe(1); // fully swallowed
    expect(discOverlap(2, 1, 0)).toBeCloseTo(0.25, 6); // small disc centred
  });

  it('is half-covered when equal discs sit one radius apart', () => {
    // two unit circles at distance 1 overlap on ~39% of one disc's area
    expect(discOverlap(1, 1, 1)).toBeGreaterThan(0.3);
    expect(discOverlap(1, 1, 1)).toBeLessThan(0.45);
  });
});

describe('eclipses', () => {
  it('sees a full Sun from Earth on an ordinary day', () => {
    system.update(JD_J2000 + 5);
    const earth = system.byId.get('earth')!;
    expect(sunVisibility(system, earth.worldPosition, earth)).toBeCloseTo(1, 6);
  });

  it('finds a total lunar eclipse in January 2000', () => {
    // the real total lunar eclipse was 2000-01-21 04:44 UTC; unperturbed
    // Kepler propagation puts it within a day of that
    const moon = system.byId.get('moon')!;
    let deepest = 1;
    let atJd = 0;
    for (let jd = 2451563; jd < 2451567; jd += 0.01) {
      system.update(jd);
      const v = sunVisibility(system, moon.worldPosition, moon);
      if (v < deepest) {
        deepest = v;
        atJd = jd;
      }
    }
    expect(deepest).toBeLessThan(0.01); // totality
    expect(Math.abs(atJd - 2451564.7)).toBeLessThan(1); // within a day
  });

  it('finds a solar eclipse when the Moon crosses the Sun', () => {
    const earth = system.byId.get('earth')!;
    let deepest = 1;
    for (let jd = 2451750; jd < 2451760; jd += 0.005) {
      system.update(jd);
      deepest = Math.min(deepest, sunVisibility(system, earth.worldPosition, earth));
    }
    expect(deepest).toBeLessThan(0.9); // the Moon takes a visible bite
  });
});
