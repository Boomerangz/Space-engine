import type { ChunkRequest, ChunkResult } from './chunk-builder';

/**
 * Fixed-size worker pool for chunk generation. Requests are queued and
 * handed to idle workers; results resolve promises by request id.
 */
export class TerrainWorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: ChunkRequest[] = [];
  private readonly pending = new Map<number, (r: ChunkResult) => void>();
  private nextId = 1;

  constructor(size = Math.min(4, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<ChunkResult>) => {
        const resolve = this.pending.get(e.data.reqId);
        this.pending.delete(e.data.reqId);
        resolve?.(e.data);
        this.dispatch(worker);
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  get inFlight(): number {
    return this.pending.size + this.queue.length;
  }

  build(req: Omit<ChunkRequest, 'reqId'>): Promise<ChunkResult> {
    const reqId = this.nextId++;
    const request = { ...req, reqId };
    return new Promise<ChunkResult>((resolve) => {
      this.pending.set(reqId, resolve);
      const worker = this.idle.pop();
      if (worker) worker.postMessage(request);
      else this.queue.push(request);
    });
  }

  private dispatch(worker: Worker): void {
    const next = this.queue.shift();
    if (next) worker.postMessage(next);
    else this.idle.push(worker);
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}
