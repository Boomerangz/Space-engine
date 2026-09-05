import { describe, expect, it } from 'vitest';
import { buildChunk, CHUNK_RES } from './chunk-builder';
import type { TerrainParams } from './heightfield';

const terrain: TerrainParams = { amplitudeKm: 16, seed: 101, ridged: 0.3 };
const R = 1737.4;

const N = CHUNK_RES + 3;

function worldPos(
  r: ReturnType<typeof buildChunk>,
  i: number,
  j: number,
): [number, number, number] {
  const vi = (j + 1) * N + (i + 1);
  return [
    r.anchor[0] + r.positions[vi * 3],
    r.anchor[1] + r.positions[vi * 3 + 1],
    r.anchor[2] + r.positions[vi * 3 + 2],
  ];
}

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('chunk edge continuity', () => {
  it('same-level neighbors share edge vertices exactly', () => {
    const A = buildChunk({ reqId: 1, radiusKm: R, terrain, node: { face: 0, level: 2, ix: 1, iy: 1 } });
    const B = buildChunk({ reqId: 2, radiusKm: R, terrain, node: { face: 0, level: 2, ix: 2, iy: 1 } });
    for (let j = 0; j <= CHUNK_RES; j++) {
      // anchors differ, so f32 rounding allows centimeter-scale error
      expect(dist(worldPos(A, CHUNK_RES, j), worldPos(B, 0, j))).toBeLessThan(1e-3);
    }
  });

  it('cross-face neighbors share edge vertices', () => {
    // face 0 (+X) at u=-1 borders face 4 (+Z) at u=+1 along the same cube edge
    const A = buildChunk({ reqId: 1, radiusKm: R, terrain, node: { face: 0, level: 1, ix: 0, iy: 0 } });
    const B = buildChunk({ reqId: 2, radiusKm: R, terrain, node: { face: 4, level: 1, ix: 1, iy: 0 } });
    for (let j = 0; j <= CHUNK_RES; j++) {
      // anchors differ, so f32 rounding allows centimeter-scale error
      expect(dist(worldPos(A, 0, j), worldPos(B, CHUNK_RES, j))).toBeLessThan(1e-3);
    }
  });

  it('coarse-fine boundary mismatch stays under the skirt depth', () => {
    for (const level of [2, 5, 8]) {
      const coarse = buildChunk({ reqId: 1, radiusKm: R, terrain, node: { face: 0, level, ix: 0, iy: 0 } });
      const fine = buildChunk({
        reqId: 2,
        radiusKm: R,
        terrain,
        node: { face: 0, level: level + 1, ix: 0, iy: 0 },
      });
      let maxErr = 0;
      // fine child's edge: every 2nd vertex coincides with the coarse grid
      for (let j = 0; j <= CHUNK_RES; j += 2) {
        maxErr = Math.max(maxErr, dist(worldPos(fine, 0, j), worldPos(coarse, 0, j / 2)));
      }
      // heights are one global function now — only f32 rounding remains
      expect(maxErr).toBeLessThan(1e-3);
    }
  });
});
