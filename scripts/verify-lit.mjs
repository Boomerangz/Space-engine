/**
 * Park above the subsolar point of a body (fully lit terrain) at several
 * altitudes and screenshot.
 */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/?webgl';
const outDir = process.argv[3] ?? '.';
const body = process.argv[4] ?? 'moon';
const radius = Number(process.argv[5] ?? 1737.4);

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

await page.evaluate((id) => {
  const se = window.__se;
  se.clock.paused = true;
  se.select(se.system.byId.get(id));
}, body);

for (const altKm of [300, 30, 3]) {
  await page.evaluate(
    ([id, r, alt]) => {
      const se = window.__se;
      const b = se.system.byId.get(id);
      const sun = se.system.byId.get('sun');
      const ex = sun.worldPosition.x - b.worldPosition.x;
      const ey = sun.worldPosition.y - b.worldPosition.y;
      const ez = sun.worldPosition.z - b.worldPosition.z;
      // ecliptic -> render axes: (x, z, -y)
      const len = Math.hypot(ex, ey, ez);
      const d = { x: ex / len, y: ez / len, z: -ey / len };
      se.rig.spawnAt({ x: d.x * (r + alt), y: d.y * (r + alt), z: d.z * (r + alt) });
      se.rig.park(r + alt);
    },
    [body, radius, altKm],
  );
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${outDir}/vl-${body}-${altKm}km.png` });
}

console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 5) : 'none');
await browser.close();
