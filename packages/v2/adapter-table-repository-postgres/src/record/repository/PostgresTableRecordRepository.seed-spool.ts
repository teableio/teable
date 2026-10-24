import type { createReadStream } from 'node:fs';
import type { FileHandle, mkdtemp, open, rm } from 'node:fs/promises';
import type { tmpdir } from 'node:os';
import type { join } from 'node:path';
import type { createInterface } from 'node:readline';

export type DeferredInsertSeedBatch = {
  tableId: string;
  recordIds: string[];
  changedFieldIds: string[];
};

/** Batches of record ids for the legacy post-commit compute path; never record values. */
export interface IDeferredInsertSeedSpool {
  append(batch: DeferredInsertSeedBatch): Promise<void>;
  seal(): Promise<void>;
  batches(): AsyncGenerator<DeferredInsertSeedBatch>;
  dispose(): Promise<void>;
}

/** The subset of Node builtins this spool uses; type-only, erased from the bundle. */
type NodeBuiltins = {
  fsPromises: { mkdtemp: typeof mkdtemp; open: typeof open; rm: typeof rm };
  fs: { createReadStream: typeof createReadStream };
  os: { tmpdir: typeof tmpdir };
  path: { join: typeof join };
  readline: { createInterface: typeof createInterface };
};

/**
 * Node builtins are read through `process.getBuiltinModule` so this module (and
 * the repository that owns it) stays importable by a browser bundle. The
 * builtins are only requested when a spool is actually created.
 */
const loadNodeBuiltins = (): NodeBuiltins | undefined => {
  if (typeof process === 'undefined' || typeof process.getBuiltinModule !== 'function') {
    return undefined;
  }
  return {
    fsPromises: process.getBuiltinModule('node:fs/promises'),
    fs: process.getBuiltinModule('node:fs'),
    os: process.getBuiltinModule('node:os'),
    path: process.getBuiltinModule('node:path'),
    readline: process.getBuiltinModule('node:readline'),
  };
};

/**
 * Browser spool. A browser has no request-owned disk space, and its import and
 * deferred-compute paths are bounded by what the page can hold anyway, so the
 * batches stay in memory behind the same lifecycle as the disk-backed variant.
 */
class MemoryDeferredInsertSeedSpool implements IDeferredInsertSeedSpool {
  private readonly batchesInMemory: DeferredInsertSeedBatch[] = [];
  private sealed = false;

  async append(batch: DeferredInsertSeedBatch): Promise<void> {
    if (this.sealed) throw new Error('Deferred insert seed spool is closed');
    this.batchesInMemory.push(batch);
  }

  async seal(): Promise<void> {
    this.sealed = true;
  }

  async *batches(): AsyncGenerator<DeferredInsertSeedBatch> {
    for (const batch of this.batchesInMemory) {
      yield batch;
    }
  }

  async dispose(): Promise<void> {
    this.sealed = true;
    this.batchesInMemory.length = 0;
  }
}

class DiskDeferredInsertSeedSpool implements IDeferredInsertSeedSpool {
  private constructor(
    private readonly node: NodeBuiltins,
    private readonly directory: string,
    private readonly path: string,
    private writer: FileHandle | undefined
  ) {}

  static async create(node: NodeBuiltins): Promise<DiskDeferredInsertSeedSpool> {
    const directory = await node.fsPromises.mkdtemp(
      node.path.join(node.os.tmpdir(), 'teable-insert-seeds-')
    );
    const path = node.path.join(directory, 'seeds.jsonl');
    try {
      return new DiskDeferredInsertSeedSpool(
        node,
        directory,
        path,
        await node.fsPromises.open(path, 'wx', 0o600)
      );
    } catch (error) {
      await node.fsPromises.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async append(batch: DeferredInsertSeedBatch): Promise<void> {
    if (!this.writer) throw new Error('Deferred insert seed spool is closed');
    await this.writer.writeFile(`${JSON.stringify(batch)}\n`);
  }

  async seal(): Promise<void> {
    const writer = this.writer;
    this.writer = undefined;
    await writer?.close();
  }

  async *batches(): AsyncGenerator<DeferredInsertSeedBatch> {
    const input = this.node.fs.createReadStream(this.path, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024,
    });
    const lines = this.node.readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        yield JSON.parse(line) as DeferredInsertSeedBatch;
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }

  async dispose(): Promise<void> {
    try {
      await this.seal();
    } finally {
      await this.node.fsPromises.rm(this.directory, { recursive: true, force: true });
    }
  }
}

export const createDeferredInsertSeedSpool = async (): Promise<IDeferredInsertSeedSpool> => {
  const node = loadNodeBuiltins();
  return node ? DiskDeferredInsertSeedSpool.create(node) : new MemoryDeferredInsertSeedSpool();
};
