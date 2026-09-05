/**
 * Checks the WebGPU compute terrain path against the CPU reference:
 * builds the same chunks both ways and compares vertex data, then times both.
 * Requires a WebGPU-capable browser; reports honestly when unavailable.
 */
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:5173/';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);

const result = await page.evaluate(async () => {
  const adapter = navigator.gpu && (await navigator.gpu.requestAdapter());
  if (!adapter) return { skipped: 'no WebGPU adapter in this browser' };

  const { buildChunk } = await import('/src/terrain/chunk-builder.ts');
  const { GpuChunkGenerator } = await import('/src/terrain/generator/gpu.ts');
  const gpu = await GpuChunkGenerator.create(window.__se.engine.renderer);
  if (!gpu) return { skipped: 'renderer is not on the WebGPU backend' };

  const terrain = { amplitudeKm: 16, seed: 101, ridged: 0.3 };
  const radiusKm = 1737.4;
  const nodes = [
    { face: 0, level: 0, ix: 0, iy: 0 },
    { face: 2, level: 4, ix: 5, iy: 9 },
    { face: 5, level: 9, ix: 300, iy: 120 },
  ];

  let maxPos = 0;
  let maxNrm = 0;
  for (const node of nodes) {
    const cpu = buildChunk({ reqId: 0, radiusKm, terrain, node });
    const g = await gpu.build({ radiusKm, terrain, node });
    for (let i = 0; i < cpu.positions.length; i++) {
      maxPos = Math.max(maxPos, Math.abs(cpu.positions[i] - g.positions[i]));
      maxNrm = Math.max(maxNrm, Math.abs(cpu.normals[i] - g.normals[i]));
    }
  }

  // timing: 24 chunks each way
  const timed = [];
  // deep chunks: full octave count, the workload that actually matters
  for (let k = 0; k < 24; k++) timed.push({ face: k % 6, level: 11, ix: 10 + k, iy: 20 });
  const t0 = performance.now();
  for (const node of timed) buildChunk({ reqId: 0, radiusKm, terrain, node });
  const cpuMs = performance.now() - t0;
  // warm up the pipeline first: the first build pays shader compilation
  await gpu.build({ radiusKm, terrain, node: timed[0] });
  const t1 = performance.now();
  await Promise.all(timed.map((node) => gpu.build({ radiusKm, terrain, node })));
  const gpuMs = performance.now() - t1;

  return {
    backend: window.__se.view.terrainBackend,
    maxPositionDiffKm: maxPos,
    maxNormalDiff: maxNrm,
    cpuMsFor24Chunks: Math.round(cpuMs),
    gpuMsFor24Chunks: Math.round(gpuMs),
  };
});

console.log(JSON.stringify(result, null, 2));
console.log(logs.filter((l) => !l.includes('[vite]')).join('\n'));
await browser.close();
