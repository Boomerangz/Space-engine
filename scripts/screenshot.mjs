/**
 * Dev verification: open the running dev server in headless Chromium and
 * save a screenshot. Usage: node scripts/screenshot.mjs [url] [outfile] [waitMs]
 */
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'screenshot.png';
const waitMs = Number(process.argv[4] ?? 4000);

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
console.log(`saved ${out}`);
console.log('--- console ---');
for (const l of logs) console.log(l);
await browser.close();
