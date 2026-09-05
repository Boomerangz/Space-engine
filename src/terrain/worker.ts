/**
 * Terrain worker: builds chunk meshes off the main thread.
 */
import { buildChunk, type ChunkRequest } from './chunk-builder';

self.onmessage = (e: MessageEvent<ChunkRequest>) => {
  const result = buildChunk(e.data);
  (self as unknown as Worker).postMessage(result, [
    result.positions.buffer,
    result.normals.buffer,
    result.uvs.buffer,
  ]);
};
