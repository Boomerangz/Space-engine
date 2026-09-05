/**
 * M5 spot checks: Saturn rings, Sun glow, Earth night lights.
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
await page.waitForTimeout(4000);

const park = async (id, distKm, antisolar = false) => {
  await page.evaluate(
    ([id, distKm, antisolar]) => {
      const se = window.__se;
      se.clock.paused = true;
      se.select(se.system.byId.get(id));
      const b = se.system.byId.get(id);
      const sun = se.system.byId.get('sun');
      let ex = sun.worldPosition.x - b.worldPosition.x;
      let ey = sun.worldPosition.y - b.worldPosition.y;
      let ez = sun.worldPosition.z - b.worldPosition.z;
      const len = Math.hypot(ex, ey, ez) || 1;
      const s = (antisolar ? -1 : 1) / len;
      const d = { x: ex * s, y: ez * s, z: -ey * s };
      // tilt the view a bit off-axis
      const up = 0.35;
      const n = Math.hypot(d.x, d.y + up, d.z);
      se.rig.spawnAt({
        x: (d.x / n) * distKm,
        y: ((d.y + up) / n) * distKm,
        z: (d.z / n) * distKm,
      });
      se.rig.park(distKm);
    },
    [id, distKm, antisolar],
  );
  await page.waitForTimeout(6000);
};

await park('saturn', 300000);
await page.screenshot({ path: `${outDir}/v5-saturn.png` });

await park('sun', 4e6);
await page.screenshot({ path: `${outDir}/v5-sun.png` });

await park('earth', 30000, true);
await page.screenshot({ path: `${outDir}/v5-earth-night.png` });

console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 5) : 'none');
await browser.close();
