import type { ChunkRequest, ChunkResult } from '../chunk-builder';
import { CHUNK_RES } from '../chunk-builder';
import { nodeArcKm, nodeRect, faceDir } from '../cubesphere';
import { permutationTable } from '../heightfield';
import type { TerrainParams } from '../heightfield';
import { CHUNK_WGSL } from './chunk.wgsl';

const N = CHUNK_RES + 3; // vertices per edge including the skirt ring
const VERTS = N * N;
const POS_BYTES = VERTS * 3 * 4;
const UV_BYTES = VERTS * 2 * 4;
const PARAM_FLOATS = 20; // see the Params struct in chunk.wgsl.ts
const PARAM_BYTES = PARAM_FLOATS * 4;

interface Slot {
  params: GPUBuffer;
  positions: GPUBuffer;
  normals: GPUBuffer;
  uvs: GPUBuffer;
  colors: GPUBuffer;
  readback: GPUBuffer;
  bindGroup: GPUBindGroup;
  perm: GPUBuffer;
  permSeed: number;
}

/**
 * Chunk generation on the GPU via a WebGPU compute pass.
 *
 * Same output shape as the worker pool (TerrainWorkerPool) so PlanetTerrain
 * does not care which backend produced a chunk. Requests run one at a time
 * per slot; a small ring of slots keeps the queue busy while readbacks land.
 */
export class GpuChunkGenerator {
  private readonly slots: Slot[] = [];
  private readonly free: Slot[] = [];
  private readonly queue: {
    req: Omit<ChunkRequest, 'reqId'>;
    resolve: (r: ChunkResult) => void;
  }[] = [];
  private pendingCount = 0;
  private nextId = 1;

  private constructor(
    private readonly device: GPUDevice,
    private readonly pipeline: GPUComputePipeline,
    slots: number,
  ) {
    for (let i = 0; i < slots; i++) this.slots.push(this.createSlot());
    this.free.push(...this.slots);
  }

  /**
   * Build a generator on the renderer's WebGPU device, or return null when
   * the renderer is running the WebGL2 fallback.
   */
  static async create(renderer: unknown): Promise<GpuChunkGenerator | null> {
    const backend = (renderer as { backend?: { isWebGPUBackend?: boolean; device?: GPUDevice } })
      .backend;
    const device = backend?.isWebGPUBackend ? backend.device : undefined;
    if (!device) return null;
    try {
      const module = device.createShaderModule({ code: CHUNK_WGSL });
      const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      return new GpuChunkGenerator(device, pipeline, 3);
    } catch (err) {
      console.warn('[space-engine] GPU terrain unavailable, using workers:', err);
      return null;
    }
  }

  get inFlight(): number {
    return this.pendingCount + this.queue.length;
  }

  build(req: Omit<ChunkRequest, 'reqId'>): Promise<ChunkResult> {
    return new Promise<ChunkResult>((resolve) => {
      this.queue.push({ req, resolve });
      this.pump();
    });
  }

  private createSlot(): Slot {
    const d = this.device;
    const storage = (size: number) =>
      d.createBuffer({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = d.createBuffer({
      size: PARAM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const perm = d.createBuffer({
      size: 1024 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const positions = storage(POS_BYTES);
    const normals = storage(POS_BYTES);
    const uvs = storage(UV_BYTES);
    const colors = storage(POS_BYTES);
    const readback = d.createBuffer({
      size: POS_BYTES * 3 + UV_BYTES,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const bindGroup = d.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: perm } },
        { binding: 2, resource: { buffer: positions } },
        { binding: 3, resource: { buffer: normals } },
        { binding: 4, resource: { buffer: uvs } },
        { binding: 5, resource: { buffer: colors } },
      ],
    });
    return { params, perm, permSeed: NaN, positions, normals, uvs, colors, readback, bindGroup };
  }

  private pump(): void {
    while (this.queue.length > 0 && this.free.length > 0) {
      const slot = this.free.pop()!;
      const job = this.queue.shift()!;
      this.pendingCount++;
      void this.run(slot, job.req)
        .then((result) => job.resolve(result))
        .finally(() => {
          this.pendingCount--;
          this.free.push(slot);
          this.pump();
        });
    }
  }

  private uploadPerm(slot: Slot, terrain: TerrainParams): void {
    if (slot.permSeed === terrain.seed) return;
    const table = new Uint32Array(1024);
    table.set(permutationTable(terrain.seed), 0);
    table.set(permutationTable(terrain.seed * 7919 + 13), 512);
    this.device.queue.writeBuffer(slot.perm, 0, table);
    slot.permSeed = terrain.seed;
  }

  private async run(slot: Slot, req: Omit<ChunkRequest, 'reqId'>): Promise<ChunkResult> {
    const { node, radiusKm, terrain } = req;
    const { u0, v0, size } = nodeRect(node);
    const arc = nodeArcKm(node, radiusKm);
    const dir = faceDir(node.face, u0 + size / 2, v0 + size / 2, { x: 0, y: 0, z: 0 });
    const anchor: [number, number, number] = [
      dir.x * radiusKm,
      dir.y * radiusKm,
      dir.z * radiusKm,
    ];

    // must mirror the constants in chunk-builder.ts
    const params = new Float32Array(PARAM_FLOATS);
    const asU32 = new Uint32Array(params.buffer);
    params[0] = radiusKm;
    params[1] = terrain.amplitudeKm;
    params[2] = 1 / (terrain.baseScale ?? 0.7);
    params[3] = terrain.ridged ?? 0.35;
    params[4] = terrain.detail ?? 1;
    params[5] = 0.005; // global minimum wavelength, km
    params[6] = u0;
    params[7] = v0;
    params[8] = size;
    params[9] = size / CHUNK_RES;
    params[10] = arc;
    params[11] = arc * 0.02 + 0.05; // skirt depth
    asU32[12] = node.face;
    asU32[13] = CHUNK_RES;
    params[14] = Math.min(Math.max(1 - arc / CHUNK_RES / 2, 0), 1);
    params[16] = anchor[0];
    params[17] = anchor[1];
    params[18] = anchor[2];

    this.uploadPerm(slot, terrain);
    this.device.queue.writeBuffer(slot.params, 0, params);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, slot.bindGroup);
    const groups = Math.ceil(N / 8);
    pass.dispatchWorkgroups(groups, groups);
    pass.end();

    let offset = 0;
    encoder.copyBufferToBuffer(slot.positions, 0, slot.readback, offset, POS_BYTES);
    offset += POS_BYTES;
    encoder.copyBufferToBuffer(slot.normals, 0, slot.readback, offset, POS_BYTES);
    offset += POS_BYTES;
    encoder.copyBufferToBuffer(slot.colors, 0, slot.readback, offset, POS_BYTES);
    offset += POS_BYTES;
    encoder.copyBufferToBuffer(slot.uvs, 0, slot.readback, offset, UV_BYTES);
    this.device.queue.submit([encoder.finish()]);

    await slot.readback.mapAsync(GPUMapMode.READ);
    const raw = slot.readback.getMappedRange();
    const positions = new Float32Array(raw.slice(0, POS_BYTES));
    const normals = new Float32Array(raw.slice(POS_BYTES, POS_BYTES * 2));
    const colors = new Float32Array(raw.slice(POS_BYTES * 2, POS_BYTES * 3));
    const uvs = new Float32Array(raw.slice(POS_BYTES * 3, POS_BYTES * 3 + UV_BYTES));
    slot.readback.unmap();

    return { reqId: this.nextId++, node, anchor, positions, normals, uvs, colors };
  }

  dispose(): void {
    for (const slot of this.slots) {
      for (const b of [
        slot.params,
        slot.perm,
        slot.positions,
        slot.normals,
        slot.uvs,
        slot.colors,
        slot.readback,
      ]) {
        b.destroy();
      }
    }
  }
}
