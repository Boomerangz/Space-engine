/**
 * M4 verification: land on the Moon near the subsolar point, switch to fly
 * mode, pitch up to the horizon, fly forward, and confirm the terrain clamp
 * keeps the camera above ground.
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

// land at the subsolar point, 15 m up (the clamp will hold ≥4 m)
await page.evaluate(() => {
  const se = window.__se;
  se.clock.paused = true;
  se.select(se.system.byId.get('moon'));
  const b = se.system.byId.get('moon');
  const sun = se.system.byId.get('sun');
  const ex = sun.worldPosition.x - b.worldPosition.x;
  const ey = sun.worldPosition.y - b.worldPosition.y;
  const ez = sun.worldPosition.z - b.worldPosition.z;
  const len = Math.hypot(ex, ey, ez);
  const d = { x: ex / len, y: ez / len, z: -ey / len };
  const r = 1737.4 + 0.015;
  se.rig.spawnAt({ x: d.x * r, y: d.y * r, z: d.z * r });
  se.rig.park(r);
});
await page.waitForTimeout(12000); // deep chunks build
await page.screenshot({ path: `${outDir}/v4-down.png` });

// F → fly mode, then drag upward: pitch from nadir to the horizon (~90°)
await page.keyboard.press('KeyF');
await page.mouse.move(640, 620);
await page.mouse.down();
for (let i = 0; i < 16; i++) {
  await page.mouse.move(640, 620 - i * 24);
  await page.waitForTimeout(60);
}
await page.mouse.up();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${outDir}/v4-horizon.png` });

// fly forward for a while; the clamp must keep us above ground
await page.keyboard.down('KeyW');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyW');
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/v4-flight.png` });

const state = await page.evaluate(() => {
  const se = window.__se;
  return {
    mode: se.rig.mode,
    terrainAltitudeKm: se.rig.terrainAltitude,
    surfaceDistanceKm: se.rig.surfaceDistance,
  };
});
console.log(JSON.stringify(state, null, 2));
console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 5) : 'none');
await browser.close();
