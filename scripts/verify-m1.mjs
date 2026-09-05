/**
 * M1 verification: load the app, screenshot Earth, click through to Saturn,
 * speed up time, screenshot again.
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
await page.screenshot({ path: `${outDir}/v-earth.png` });

await page.getByRole('button', { name: 'Saturn', exact: true }).click();
await page.waitForTimeout(6000); // glide in
await page.screenshot({ path: `${outDir}/v-saturn.png` });

// crank time warp: 6 clicks = ×1M
for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '▶▶' }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/v-warp.png` });

console.log('errors:', errors.length ? errors : 'none');
await browser.close();
