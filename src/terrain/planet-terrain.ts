import * as THREE from 'three/webgpu';
import type { Body } from '../ephemeris/bodies';
import type { TerrainWorkerPool } from './pool';
import { buildIndices, CHUNK_RES } from './chunk-builder';
import { faceDir, nodeArcKm, nodeChildren, nodeKey, nodeRect, type NodeId } from './cubesphere';

const SPLIT_K = 3; // split when the camera is closer than K × chunk arc
const MAX_INFLIGHT = 14;
const CACHE_CAP = 900;

const dir = { x: 0, y: 0, z: 0 };
const tmp = new THREE.Vector3();

interface ChunkState {
  mesh: THREE.Mesh | null;
  building: boolean;
  lastUsed: number;
}

let sharedIndices: THREE.BufferAttribute | null = null;
function indices(): THREE.BufferAttribute {
  if (!sharedIndices) sharedIndices = new THREE.BufferAttribute(buildIndices(), 1);
  return sharedIndices;
}

/**
 * Quadtree LOD terrain for one planet. `group` lives in the planet's
 * rotating local frame (child of the body anchor); chunk meshes carry
 * planet-local anchors so vertex data stays small and f32-safe.
 */
export class PlanetTerrain {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, ChunkState>();
  private readonly maxLevel: number;
  private frame = 0;

  constructor(
    private readonly body: Body,
    private readonly material: THREE.Material,
    private readonly pool: TerrainWorkerPool,
  ) {
    const radius = body.def.radiusKm;
    // deepest level ≈ 1 m vertex spacing
    this.maxLevel = Math.ceil(Math.log2(((Math.PI / 2) * radius) / (CHUNK_RES * 0.001)));
    for (let face = 0; face < 6; face++) {
      this.request({ face, level: 0, ix: 0, iy: 0 });
    }
  }

  /** True once all six root chunks are built (safe to hide the impostor sphere). */
  get ready(): boolean {
    for (let face = 0; face < 6; face++) {
      if (!this.chunks.get(nodeKey({ face, level: 0, ix: 0, iy: 0 }))?.mesh) return false;
    }
    return true;
  }

  /** cameraLocal: camera position in the planet's rotating local frame, km. */
  update(cameraLocal: THREE.Vector3): void {
    this.frame++;
    const visible = new Set<string>();
    for (let face = 0; face < 6; face++) {
      this.visit({ face, level: 0, ix: 0, iy: 0 }, cameraLocal, visible);
    }
    for (const [key, state] of this.chunks) {
      if (state.mesh) state.mesh.visible = visible.has(key);
    }
    this.evict();
  }

  private visit(node: NodeId, cameraLocal: THREE.Vector3, visible: Set<string>): void {
    const key = nodeKey(node);
    const state = this.chunks.get(key);
    if (!state?.mesh) {
      this.request(node);
      return; // parent (or nothing, for roots) covers this area meanwhile
    }
    state.lastUsed = this.frame;

    const arc = nodeArcKm(node, this.body.def.radiusKm);
    const { u0, v0, size } = nodeRect(node);
    faceDir(node.face, u0 + size / 2, v0 + size / 2, dir);
    tmp.set(dir.x, dir.y, dir.z).multiplyScalar(this.body.def.radiusKm);
    const d = cameraLocal.distanceTo(tmp);

    if (d < arc * SPLIT_K && node.level < this.maxLevel) {
      const children = nodeChildren(node);
      const childStates = children.map((c) => this.chunks.get(nodeKey(c)));
      if (childStates.every((s) => s?.mesh)) {
        for (const child of children) this.visit(child, cameraLocal, visible);
        return;
      }
      // order child requests near-first so the pool builds what matters
      children
        .map((c) => {
          const r = nodeRect(c);
          faceDir(c.face, r.u0 + r.size / 2, r.v0 + r.size / 2, dir);
          tmp.set(dir.x, dir.y, dir.z).multiplyScalar(this.body.def.radiusKm);
          return { c, dist: cameraLocal.distanceTo(tmp) };
        })
        .sort((a, b) => a.dist - b.dist)
        .forEach(({ c }) => this.request(c));
    }
    visible.add(key);
  }

  private request(node: NodeId): void {
    const key = nodeKey(node);
    const existing = this.chunks.get(key);
    if (existing) return;
    if (this.pool.inFlight >= MAX_INFLIGHT) return;
    const state: ChunkState = { mesh: null, building: true, lastUsed: this.frame };
    this.chunks.set(key, state);
    const terrain = this.body.def.terrain!;
    void this.pool
      .build({ radiusKm: this.body.def.radiusKm, terrain, node })
      .then((result) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(result.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(result.uvs, 2));
        geo.setIndex(indices());
        const arc = nodeArcKm(node, this.body.def.radiusKm);
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), arc * 1.5);
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.position.set(result.anchor[0], result.anchor[1], result.anchor[2]);
        mesh.visible = false;
        state.mesh = mesh;
        state.building = false;
        this.group.add(mesh);
      });
  }

  private evict(): void {
    if (this.chunks.size <= CACHE_CAP) return;
    const candidates = [...this.chunks.entries()]
      .filter(([, s]) => s.mesh && !s.mesh.visible && this.frame - s.lastUsed > 120)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let toDrop = this.chunks.size - CACHE_CAP;
    for (const [key, state] of candidates) {
      if (toDrop-- <= 0) break;
      if (key.split(':')[1] === '0') continue; // never drop roots
      state.mesh!.geometry.dispose();
      this.group.remove(state.mesh!);
      this.chunks.delete(key);
    }
  }

  dispose(): void {
    for (const [, state] of this.chunks) {
      if (state.mesh) {
        state.mesh.geometry.dispose();
        this.group.remove(state.mesh);
      }
    }
    this.chunks.clear();
  }
}
