import { describe, expect, it } from 'vitest';
import { solveKepler } from './kepler';
import { SolarSystem } from './bodies';
import type { SystemDef } from './types';
import systemJson from '../data/solar-system.json';
import { AU_KM } from '../core/constants';
import { JD_J2000 } from '../core/time/simclock';

const system = SolarSystem.fromDef(systemJson as SystemDef);

describe('solveKepler', () => {
  it('satisfies Kepler equation across eccentricities', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.97]) {
      for (let k = 0; k < 20; k++) {
        const M = (k / 20) * 2 * Math.PI - Math.PI;
        const E = solveKepler(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 9);
      }
    }
  });
});

describe('planet positions', () => {
  it('Earth is ~1 AU from the Sun near the ecliptic plane', () => {
    system.update(JD_J2000);
    const earth = system.byId.get('earth')!;
    const r = earth.worldPosition.length();
    expect(r / AU_KM).toBeGreaterThan(0.97);
    expect(r / AU_KM).toBeLessThan(1.03);
    expect(Math.abs(earth.worldPosition.z) / r).toBeLessThan(0.001);
  });

  it('Earth heliocentric longitude at J2000 is ~100°', () => {
    system.update(JD_J2000);
    const p = system.byId.get('earth')!.worldPosition;
    const lonDeg = (Math.atan2(p.y, p.x) * 180) / Math.PI;
    // Sun's geocentric longitude on 2000-01-01.5 was ~280.4°; +180° heliocentric
    expect(((lonDeg % 360) + 360) % 360).toBeGreaterThan(99);
    expect(((lonDeg % 360) + 360) % 360).toBeLessThan(102);
  });

  it('Earth returns to the same spot after one sidereal year', () => {
    const earth = system.byId.get('earth')!;
    system.update(JD_J2000);
    const p0 = earth.worldPosition.clone().normalize();
    system.update(JD_J2000 + 365.25636);
    const p1 = earth.worldPosition.clone().normalize();
    expect(p0.dot(p1)).toBeGreaterThan(0.9999);
  });

  it('Mars stays within its perihelion/aphelion range', () => {
    const mars = system.byId.get('mars')!;
    for (let d = 0; d < 800; d += 40) {
      system.update(JD_J2000 + d);
      const r = mars.worldPosition.length() / AU_KM;
      expect(r).toBeGreaterThan(1.35);
      expect(r).toBeLessThan(1.68);
    }
  });

  it('Moon orbits Earth at 356k-407k km', () => {
    const moon = system.byId.get('moon')!;
    for (let d = 0; d < 30; d += 2) {
      system.update(JD_J2000 + d);
      const r = moon.localPosition.length();
      expect(r).toBeGreaterThan(356000);
      expect(r).toBeLessThan(407000);
    }
  });

  it('moons follow their parent planet', () => {
    system.update(JD_J2000 + 123.4);
    const jupiter = system.byId.get('jupiter')!;
    const io = system.byId.get('io')!;
    expect(io.worldPosition.distanceTo(jupiter.worldPosition)).toBeLessThan(500000);
  });
});
