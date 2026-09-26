import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export type DeferredInsertSeedBatch = {
  tableId: string;
  recordIds: string[];
  changedFieldIds: string[];
};

/** Disk-backed seeds for the legacy post-commit compute path, never record values. */
export class DeferredInsertSeedSpool {
  private constructor(
    private readonly directory: string,
    private readonly path: string,
    private writer: FileHandle | undefined
  ) {}

  static async create(): Promise<DeferredInsertSeedSpool> {
    const directory = await mkdtemp(join(tmpdir(), 'teable-insert-seeds-'));
    const path = join(directory, 'seeds.jsonl');
    try {
      return new DeferredInsertSeedSpool(directory, path, await open(path, 'wx', 0o600));
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
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
    const input = createReadStream(this.path, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    const lines = createInterface({ input, crlfDelay: Infinity });
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
      await rm(this.directory, { recursive: true, force: true });
    }
  }
}
