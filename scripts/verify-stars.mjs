import { chromium } from 'playwright-core';
const [base, outDir] = [process.argv[2], process.argv[3]];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on('console', m => m.type()==='error' && errors.push(m.text())); page.on('pageerror', e => errors.push(e.message));
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(5000);

// deep space: full star field
await page.evaluate(() => { const se = window.__se; se.clock.paused = true; se.select(se.system.byId.get('earth')); se.rig.park(6371 * 40); });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${outDir}/stars-space.png` });
console.log('space skyBrightness', await page.evaluate(() => window.__se.view.skyBrightness(window.__se.rig)));

// stand on Earth's night side: stars visible
await page.evaluate(() => {
  const se = window.__se, b = se.system.byId.get('earth'), sun = se.system.byId.get('sun');
  const ex = sun.worldPosition.x-b.worldPosition.x, ey = sun.worldPosition.y-b.worldPosition.y, ez = sun.worldPosition.z-b.worldPosition.z;
  const L = Math.hypot(ex,ey,ez), s = -1/L; const d = {x:ex*s, y:ez*s, z:-ey*s};
  const r = 6371 + 2;
  se.rig.spawnAt({x:d.x*r, y:d.y*r, z:d.z*r}); se.rig.park(r);
});
await page.waitForTimeout(4000);
await page.keyboard.press('KeyF');
await page.mouse.move(640, 620); await page.mouse.down();
for (let i=0;i<16;i++){ await page.mouse.move(640, 620-i*24); await page.waitForTimeout(50); }
await page.mouse.up(); await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/stars-night.png` });

// day side: stars must be gone
await page.evaluate(() => {
  const se = window.__se, b = se.system.byId.get('earth'), sun = se.system.byId.get('sun');
  const ex = sun.worldPosition.x-b.worldPosition.x, ey = sun.worldPosition.y-b.worldPosition.y, ez = sun.worldPosition.z-b.worldPosition.z;
  const L = Math.hypot(ex,ey,ez), s = 1/L; const d = {x:ex*s, y:ez*s, z:-ey*s};
  const r = 6371 + 2;
  se.rig.spawnAt({x:d.x*r, y:d.y*r, z:d.z*r}); se.rig.park(r);
});
await page.waitForTimeout(4000);
await page.mouse.move(640, 620); await page.mouse.down();
for (let i=0;i<16;i++){ await page.mouse.move(640, 620-i*24); await page.waitForTimeout(50); }
await page.mouse.up(); await page.waitForTimeout(4000);
await page.screenshot({ path: `${outDir}/stars-day.png` });
console.log('errors:', errors.length ? [...new Set(errors)].slice(0,4) : 'none');
await browser.close();
