import type { ChunkRequest, ChunkResult } from './chunk-builder';

/**
 * Either terrain generation path: the Web Worker pool (always available) or
 * the WebGPU compute generator. PlanetTerrain talks only to this.
 */
export interface ChunkBackend {
  /** Requests queued or awaiting results, used to throttle LOD expansion. */
  readonly inFlight: number;
  build(req: Omit<ChunkRequest, 'reqId'>): Promise<ChunkResult>;
  dispose(): void;
}
