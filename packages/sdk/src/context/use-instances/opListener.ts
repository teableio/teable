import type { Doc } from 'sharedb/lib/client';

export class OpListenersManager<T> {
  private opListeners: Map<string, () => void> = new Map();
  private collection: string;

  constructor(collection: string) {
    this.collection = collection;
  }

  add(doc: Doc<T>, handler: (op: unknown[]) => void) {
    if (this.opListeners.has(doc.id)) {
      return;
    }
    doc.on('op batch', handler);
    this.opListeners.set(doc.id, () => {
      doc.removeListener('op batch', handler);
      doc.listenerCount('op batch') === 0 && doc.destroy();
    });
  }

  remove(doc: Doc<T>) {
    const cleanupFunction = this.opListeners.get(doc.id);
    cleanupFunction && cleanupFunction();
    this.opListeners.delete(doc.id);
  }

  clear() {
    this.opListeners.forEach((cleanupFunction) => cleanupFunction());
    this.opListeners.clear();
  }
}
