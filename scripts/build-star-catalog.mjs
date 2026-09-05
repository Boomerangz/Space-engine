/**
 * Dev-time script: convert the Yale Bright Star Catalog (BSC5, ASCII) into a
 * compact JSON the app ships in public/data/stars.json.
 *
 * Usage: node scripts/build-star-catalog.mjs <path/to/bsc5.dat>
 *
 * BSC5 fixed-column layout (1-indexed, per the catalog's ReadMe):
 *   76-77 RAh   78-79 RAm   80-83 RAs   (J2000)
 *   84    DE-   85-86 DEd   87-88 DEm   89-90 DEs
 *   103-107 Vmag            110-114 B-V
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/build-star-catalog.mjs <bsc5.dat>');
  process.exit(1);
}

const col = (line, from, to) => line.slice(from - 1, to);
const stars = [];

for (const line of readFileSync(src, 'latin1').split('\n')) {
  if (line.length < 107) continue;
  const rah = Number(col(line, 76, 77));
  const ram = Number(col(line, 78, 79));
  const ras = Number(col(line, 80, 83));
  const sign = col(line, 84, 84) === '-' ? -1 : 1;
  const ded = Number(col(line, 85, 86));
  const dem = Number(col(line, 87, 88));
  const des = Number(col(line, 89, 90));
  const mag = Number(col(line, 103, 107));
  const bvRaw = col(line, 110, 114).trim();
  // novae and other entries without astrometry leave these blank
  if (!Number.isFinite(rah) || !Number.isFinite(ded) || !Number.isFinite(mag)) continue;

  const raDeg = (rah + ram / 60 + ras / 3600) * 15;
  const decDeg = sign * (ded + dem / 60 + des / 3600);
  const bv = Number.isFinite(Number(bvRaw)) && bvRaw !== '' ? Number(bvRaw) : 0;
  stars.push([
    Number(raDeg.toFixed(4)),
    Number(decDeg.toFixed(4)),
    Number(mag.toFixed(2)),
    Number(bv.toFixed(2)),
  ]);
}

stars.sort((a, b) => a[2] - b[2]); // brightest first
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
const out = new URL('../public/data/stars.json', import.meta.url);
writeFileSync(out, JSON.stringify({ epoch: 'J2000', stars }));
console.log(`${stars.length} stars, brightest mag ${stars[0][2]}, faintest ${stars.at(-1)[2]}`);
console.log('first 3:', JSON.stringify(stars.slice(0, 3)));
