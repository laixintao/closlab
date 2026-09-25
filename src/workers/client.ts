import { LocalizedError, msg } from '../i18n/core';
export class TopologyClient {
  private worker = new Worker(new URL('./topology.worker.ts', import.meta.url), { type: 'module' });
  private sequence = 0;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.error) pending.reject(new LocalizedError(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = event => this.rejectAll(new LocalizedError(event.message || msg('Could not start the computation worker')));
  }
  request<T>(kind: 'build' | 'layout' | 'path' | 'allPaths', payload: unknown): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.worker.postMessage({ id, kind, payload });
    });
  }
  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  dispose() { this.worker.terminate(); this.rejectAll(new LocalizedError(msg("Computation cancelled"))); }
}
