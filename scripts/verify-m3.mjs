/**
 * M3 verification: descend toward the Moon in steps, screenshotting the
 * LOD terrain at each altitude.
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

for (const altKm of [radius * 2, 300, 30, 3]) {
  await page.evaluate(
    ([r, alt]) => window.__se.rig.park(r + alt),
    [radius, altKm],
  );
  await page.waitForTimeout(9000); // let chunks build
  const label = altKm >= 1000 ? `${Math.round(altKm / 1000)}kkm` : `${altKm}km`;
  await page.screenshot({ path: `${outDir}/v3-${body}-${label}.png` });
}

console.log('errors:', errors.length ? [...new Set(errors)].slice(0, 5) : 'none');
await browser.close();
