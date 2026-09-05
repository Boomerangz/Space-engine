/**
 * Chunk mesh construction (pure math, runs inside the worker).
 */
import { Heightfield, type TerrainParams } from './heightfield';
import { faceDir, nodeArcKm, nodeRect, type NodeId } from './cubesphere';

export const CHUNK_RES = 32; // quads per edge

export interface ChunkRequest {
  reqId: number;
  radiusKm: number;
  terrain: TerrainParams;
  node: NodeId;
}

export interface ChunkResult {
  reqId: number;
  node: NodeId;
  /** anchor point (chunk origin) in planet-local km */
  anchor: [number, number, number];
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
}

const heightfields = new Map<string, Heightfield>();

function getHeightfield(radiusKm: number, terrain: TerrainParams): Heightfield {
  const key = `${terrain.seed}:${radiusKm}:${terrain.amplitudeKm}`;
  let hf = heightfields.get(key);
  if (!hf) {
    hf = new Heightfield(terrain, radiusKm);
    heightfields.set(key, hf);
  }
  return hf;
}

const d = { x: 0, y: 0, z: 0 };

export function buildChunk(req: ChunkRequest): ChunkResult {
  const { node, radiusKm } = req;
  const hf = getHeightfield(radiusKm, req.terrain);
  const { u0, v0, size } = nodeRect(node);
  const arc = nodeArcKm(node, radiusKm);
  const step = size / CHUNK_RES;
  // IMPORTANT: the octave cap must NOT depend on the LOD level — heights
  // must be one global function or chunk borders crack. 5 m wavelength
  // floor ≈ the deepest level's vertex spacing.
  const minWavelength = 0.005;
  // skirts only need to mask f32 rounding and T-junction chords now
  const skirtDepth = arc * 0.02 + 0.05;

  const N = CHUNK_RES + 3; // vertices per edge including the skirt ring
  const count = N * N;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  // anchor: chunk-center surface point at h=0 (planet-local km)
  faceDir(node.face, u0 + size / 2, v0 + size / 2, d);
  const anchor: [number, number, number] = [d.x * radiusKm, d.y * radiusKm, d.z * radiusKm];
  const centerU = Math.atan2(d.z, -d.x) / (2 * Math.PI);

  // heights on a grid with one extra row/column on each side, so edge
  // normals get real central differences (no shading seams between chunks)
  const HN = CHUNK_RES + 3;
  const H = new Float32Array(HN * HN);
  for (let j = -1; j <= CHUNK_RES + 1; j++) {
    for (let i = -1; i <= CHUNK_RES + 1; i++) {
      faceDir(node.face, u0 + i * step, v0 + j * step, d);
      H[(j + 1) * HN + (i + 1)] = hf.heightAt(d.x, d.y, d.z, minWavelength);
    }
  }

  const hAt = (i: number, j: number): number => {
    const ci = Math.min(Math.max(i, -1), CHUNK_RES + 1);
    const cj = Math.min(Math.max(j, -1), CHUNK_RES + 1);
    return H[(cj + 1) * HN + (ci + 1)];
  };

  const spacing = arc / CHUNK_RES; // approx vertex spacing, km

  for (let j = -1; j <= CHUNK_RES + 1; j++) {
    for (let i = -1; i <= CHUNK_RES + 1; i++) {
      const vi = (j + 1) * N + (i + 1);
      const isSkirt = i < 0 || j < 0 || i > CHUNK_RES || j > CHUNK_RES;
      const ci = Math.min(Math.max(i, 0), CHUNK_RES);
      const cj = Math.min(Math.max(j, 0), CHUNK_RES);

      faceDir(node.face, u0 + ci * step, v0 + cj * step, d);
      const h = hAt(ci, cj);
      let r = radiusKm + h;
      if (isSkirt) r -= skirtDepth;

      positions[vi * 3] = d.x * r - anchor[0];
      positions[vi * 3 + 1] = d.y * r - anchor[1];
      positions[vi * 3 + 2] = d.z * r - anchor[2];

      // normal from height gradient in the tangent frame
      const dhdu = (hAt(ci + 1, cj) - hAt(ci - 1, cj)) / (2 * spacing);
      const dhdv = (hAt(ci, cj + 1) - hAt(ci, cj - 1)) / (2 * spacing);
      // tangent basis from numeric derivatives of the face direction
      const du = { x: 0, y: 0, z: 0 };
      const dv = { x: 0, y: 0, z: 0 };
      faceDir(node.face, u0 + ci * step + step, v0 + cj * step, du);
      faceDir(node.face, u0 + ci * step, v0 + cj * step + step, dv);
      let tux = du.x - d.x, tuy = du.y - d.y, tuz = du.z - d.z;
      let tvx = dv.x - d.x, tvy = dv.y - d.y, tvz = dv.z - d.z;
      const tul = Math.hypot(tux, tuy, tuz) || 1;
      const tvl = Math.hypot(tvx, tvy, tvz) || 1;
      tux /= tul; tuy /= tul; tuz /= tul;
      tvx /= tvl; tvy /= tvl; tvz /= tvl;
      let nx = d.x - tux * dhdu - tvx * dhdv;
      let ny = d.y - tuy * dhdu - tvy * dhdv;
      let nz = d.z - tuz * dhdu - tvz * dhdv;
      const nl = Math.hypot(nx, ny, nz) || 1;
      normals[vi * 3] = nx / nl;
      normals[vi * 3 + 1] = ny / nl;
      normals[vi * 3 + 2] = nz / nl;

      // equirect UV matching three's SphereGeometry mapping, seam-unwrapped
      let u = Math.atan2(d.z, -d.x) / (2 * Math.PI);
      if (u - centerU > 0.5) u -= 1;
      else if (u - centerU < -0.5) u += 1;
      const v = 1 - Math.acos(Math.min(Math.max(d.y, -1), 1)) / Math.PI;
      uvs[vi * 2] = u;
      uvs[vi * 2 + 1] = v;
    }
  }

  return { reqId: req.reqId, node, anchor, positions, normals, uvs };
}

/** Shared triangle indices for an N×N vertex grid (same for all chunks). */
export function buildIndices(): Uint32Array {
  const N = CHUNK_RES + 3;
  const indices = new Uint32Array((N - 1) * (N - 1) * 6);
  let o = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const e = c + 1;
      // CCW from outside: face tangents satisfy du×dv = outward normal
      indices[o++] = a;
      indices[o++] = b;
      indices[o++] = c;
      indices[o++] = b;
      indices[o++] = e;
      indices[o++] = c;
    }
  }
  return indices;
}
