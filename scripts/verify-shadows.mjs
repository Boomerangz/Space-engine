/**
 * Shadow checks: the Moon during a total lunar eclipse, and Saturn viewed
 * from the side so the ring/planet shadows fall across the visible face.
 */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/?webgl';
const outDir = process.argv[3] ?? '.';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

/** Park at `distKm` from a body, offset `side` (0 = sunward, 1 = 90 deg off). */
const park = async (id, distKm, side, jd) => {
  await page.evaluate(
    ([id, distKm, side, jd]) => {
      const se = window.__se;
      se.clock.paused = true;
      if (jd) se.clock.jd = jd;
      se.select(se.system.byId.get(id));
      se.system.update(se.clock.jd);
      const b = se.system.byId.get(id);
      const sun = se.system.byId.get('sun');
      const e = [
        sun.worldPosition.x - b.worldPosition.x,
        sun.worldPosition.y - b.worldPosition.y,
        sun.worldPosition.z - b.worldPosition.z,
      ];
      const L = Math.hypot(...e);
      // ecliptic -> render axes
      const s = { x: e[0] / L, y: e[2] / L, z: -e[1] / L };
      // rotate `side` of the way toward a perpendicular direction
      const perp = { x: -s.z, y: s.y * 0.3, z: s.x };
      const pl = Math.hypot(perp.x, perp.y, perp.z);
      const d = {
        x: s.x * (1 - side) + (perp.x / pl) * side,
        y: s.y * (1 - side) + (perp.y / pl) * side + 0.3,
        z: s.z * (1 - side) + (perp.z / pl) * side,
      };
      const n = Math.hypot(d.x, d.y, d.z);
      se.rig.spawnAt({ x: (d.x / n) * distKm, y: (d.y / n) * distKm, z: (d.z / n) * distKm });
      se.rig.park(distKm);
    },
    [id, distKm, side, jd],
  );
  await page.waitForTimeout(6000);
};

// total lunar eclipse, 2000-01-20 (JD 2451564.12 in this propagation)
await park('moon', 12000, 0, 2451564.12);
const eclipse = await page.evaluate(() => window.__se.view.eclipseFactor);
await page.screenshot({ path: `${outDir}/v-eclipse-moon.png` });
console.log('lunar eclipse sun visibility:', eclipse.toFixed(4));

// same Moon, a week later: fully lit for comparison
await park('moon', 12000, 0, 2451571);
console.log('one week later:', (await page.evaluate(() => window.__se.view.eclipseFactor)).toFixed(4));
await page.screenshot({ path: `${outDir}/v-eclipse-none.png` });

// Saturn from the side: ring shadow band on the disc, planet shadow on rings
await park('saturn', 260000, 0.85);
await page.screenshot({ path: `${outDir}/v-saturn-shadows.png` });

console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 4) : 'none');
await browser.close();
