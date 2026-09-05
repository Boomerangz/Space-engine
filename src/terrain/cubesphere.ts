/**
 * Cube-sphere addressing: 6 faces, each a quadtree over face-space
 * (u, v) ∈ [-1, 1]². Directions come from normalizing the cube point.
 */

export const FACES = 6;

/** face → unit direction for face-space (u, v). */
export function faceDir(
  face: number,
  u: number,
  v: number,
  out: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  let x: number, y: number, z: number;
  switch (face) {
    case 0: x = 1; y = v; z = -u; break; // +X
    case 1: x = -1; y = v; z = u; break; // -X
    case 2: x = u; y = 1; z = -v; break; // +Y
    case 3: x = u; y = -1; z = v; break; // -Y
    case 4: x = u; y = v; z = 1; break; // +Z
    default: x = -u; y = v; z = -1; break; // -Z
  }
  const inv = 1 / Math.sqrt(x * x + y * y + z * z);
  out.x = x * inv;
  out.y = y * inv;
  out.z = z * inv;
  return out;
}

export interface NodeId {
  face: number;
  level: number;
  ix: number;
  iy: number;
}

export function nodeKey(n: NodeId): string {
  return `${n.face}:${n.level}:${n.ix}:${n.iy}`;
}

/** Face-space rect covered by a node. */
export function nodeRect(n: NodeId): { u0: number; v0: number; size: number } {
  const size = 2 / (1 << n.level);
  return { u0: -1 + n.ix * size, v0: -1 + n.iy * size, size };
}

export function nodeChildren(n: NodeId): NodeId[] {
  const { face, level, ix, iy } = n;
  return [
    { face, level: level + 1, ix: ix * 2, iy: iy * 2 },
    { face, level: level + 1, ix: ix * 2 + 1, iy: iy * 2 },
    { face, level: level + 1, ix: ix * 2, iy: iy * 2 + 1 },
    { face, level: level + 1, ix: ix * 2 + 1, iy: iy * 2 + 1 },
  ];
}

/** Approximate chunk edge length on the sphere, km. */
export function nodeArcKm(n: NodeId, radiusKm: number): number {
  // a face spans a quarter of the circumference (π/2 · R)
  return ((Math.PI / 2) * radiusKm) / (1 << n.level);
}
