/**
 * Jitter check: park the camera 5 km above the Moon with time paused and
 * compare consecutive frames — a byte-identical screenshot means no f32
 * wobble at surface scale.
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

await page.evaluate(() => {
  const se = window.__se;
  se.clock.paused = true;
  se.select(se.system.byId.get('moon'));
  se.rig.park(1737.4 + 5); // 5 km above the surface
});
await page.waitForTimeout(3000);
const a = await page.screenshot({ path: `${outDir}/vj-a.png` });
await page.waitForTimeout(1500);
const b = await page.screenshot({ path: `${outDir}/vj-b.png` });
console.log('identical frames:', a.equals(b));
const alt = await page.evaluate(() => window.__se.rig.surfaceDistance);
console.log('altitude km:', alt.toFixed(3));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
