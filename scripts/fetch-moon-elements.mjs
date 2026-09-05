/**
 * Dev-time script: pull osculating orbital elements for the major moons from
 * the JPL Horizons API at the J2000 epoch and write them into
 * src/data/solar-system.json. Run manually when the dataset needs refreshing;
 * the app itself never touches the network for ephemerides.
 *
 * Usage: node scripts/fetch-moon-elements.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MOONS = [
  { id: 'moon', command: '301', center: '500@399' },
  { id: 'io', command: '501', center: '500@599' },
  { id: 'europa', command: '502', center: '500@599' },
  { id: 'ganymede', command: '503', center: '500@599' },
  { id: 'callisto', command: '504', center: '500@599' },
  { id: 'titan', command: '606', center: '500@699' },
  { id: 'triton', command: '801', center: '500@899' },
];

/** Horizons ELEMENTS output is `KEY= value` pairs; grab one by name. */
function field(text, key) {
  const m = new RegExp(`\\b${key}\\s*=\\s*(-?[\\d.]+E?[+-]?\\d*)`).exec(text);
  if (!m) throw new Error(`field ${key} not found`);
  return Number(m[1]);
}

async function fetchElements({ command, center }) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'ELEMENTS'",
    CENTER: `'${center}'`,
    // ecliptic of J2000 is the Horizons default reference plane for ELEMENTS
    START_TIME: "'2000-01-01 12:00'",
    STOP_TIME: "'2000-01-02'",
    STEP_SIZE: "'2 d'",
  });
  const res = await fetch(`https://ssd.jpl.nasa.gov/api/horizons.api?${params}`);
  const text = await res.text();
  const block = /\$\$SOE([\s\S]*?)\$\$EOE/.exec(text);
  if (!block) throw new Error(`no ephemeris block:\n${text.slice(0, 400)}`);
  const b = block[1];
  return {
    aKm: field(b, 'A'),
    e: field(b, 'EC'),
    iDeg: field(b, 'IN'),
    OmegaDeg: field(b, 'OM'),
    omegaDeg: field(b, 'W'),
    periodDays: field(b, 'PR') / 86400,
    M0Deg: field(b, 'MA'),
  };
}

const round = (v, n) => Number(v.toFixed(n));

const dry = process.argv.includes('--dry');
const path = new URL('../src/data/solar-system.json', import.meta.url);
const data = JSON.parse(readFileSync(path, 'utf8'));

for (const moon of MOONS) {
  const el = await fetchElements(moon);
  const body = data.bodies.find((b) => b.id === moon.id);
  if (!body) throw new Error(`body ${moon.id} missing from dataset`);
  body.orbit = {
    kind: 'simple',
    aKm: round(el.aKm, 1),
    e: round(el.e, 6),
    iDeg: round(el.iDeg, 4),
    OmegaDeg: round(el.OmegaDeg, 4),
    omegaDeg: round(el.omegaDeg, 4),
    periodDays: round(el.periodDays, 6),
    M0Deg: round(el.M0Deg, 4),
  };
  console.log(moon.id, JSON.stringify(body.orbit));
  await new Promise((r) => setTimeout(r, 1500)); // be polite to the API
}

if (!dry) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log('\nwrote src/data/solar-system.json');
}
