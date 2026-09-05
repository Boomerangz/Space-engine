/**
 * M2 verification: fly-through Sun → Earth → Moon → Pluto via UI, check the
 * altitude readout, then zoom the Moon in tight to eyeball jitter.
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

for (const name of ['Sun', 'Moon', 'Pluto']) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${outDir}/v2-${name.toLowerCase()}.png` });
}

// zoom into the Moon: wheel-in hard, screenshot twice to compare stability
await page.getByRole('button', { name: 'Moon', exact: true }).click();
await page.waitForTimeout(9000);
await page.mouse.move(640, 560); // over the canvas, clear of body labels
for (let i = 0; i < 25; i++) {
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(120);
}
await page.waitForTimeout(2000);
await page.screenshot({ path: `${outDir}/v2-moon-close-a.png` });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/v2-moon-close-b.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
