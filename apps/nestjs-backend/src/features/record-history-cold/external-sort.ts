import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { IColdHistoryRow } from './part-codec';
import { compareRowAsc } from './part-codec';

/** rows per in-memory run before spilling to disk (~50MB at ~1KB rows) */
const DEFAULT_RUN_SIZE = 50_000;

/**
 * Disk-backed sort + dedup for bucket rewrites.
 *
 * Nothing about the inputs' order can be trusted: the buffer stream follows
 * the db collation (mixed-case cuids order differently than bytes), and
 * legacy parts may carry that order too. Rows are collected into in-memory
 * runs, each run sorted with the byte comparator and spilled to a temp file,
 * and the final k-way merge (with adjacent row-id dedup) emits one clean
 * byte-ordered stream — the only order the part keys and the read-path
 * pruning understand.
 */
export class ExternalRowSorter {
  private run: IColdHistoryRow[] = [];
  private runFiles: string[] = [];
  private rowsAdded = 0;

  constructor(private readonly runSize = DEFAULT_RUN_SIZE) {}

  get added(): number {
    return this.rowsAdded;
  }

  async add(row: IColdHistoryRow): Promise<void> {
    this.run.push(row);
    this.rowsAdded += 1;
    if (this.run.length >= this.runSize) {
      await this.spill();
    }
  }

  /** merge all runs in byte order, deduped by row id, into `emit` */
  async drainTo(emit: (row: IColdHistoryRow) => Promise<void>): Promise<void> {
    try {
      if (this.runFiles.length === 0) {
        await this.drainInMemory(emit);
        return;
      }
      await this.spill();
      await this.mergeSpilledRuns(emit);
    } finally {
      await this.cleanup();
    }
  }

  /** common case: everything fit in one in-memory run */
  private async drainInMemory(emit: (row: IColdHistoryRow) => Promise<void>): Promise<void> {
    this.run.sort(compareRowAsc);
    let lastId: string | undefined;
    for (const row of this.run) {
      if (row.id === lastId) continue;
      lastId = row.id;
      await emit(row);
    }
    this.run = [];
  }

  private async mergeSpilledRuns(emit: (row: IColdHistoryRow) => Promise<void>): Promise<void> {
    const heads: { row: IColdHistoryRow; iterator: AsyncGenerator<IColdHistoryRow> }[] = [];
    for (const file of this.runFiles) {
      const iterator = readRunRows(file);
      const first = await iterator.next();
      if (!first.done) heads.push({ row: first.value, iterator });
    }
    let lastId: string | undefined;
    while (heads.length > 0) {
      let minIndex = 0;
      for (let i = 1; i < heads.length; i++) {
        if (compareRowAsc(heads[i].row, heads[minIndex].row) < 0) minIndex = i;
      }
      const head = heads[minIndex];
      if (head.row.id !== lastId) {
        lastId = head.row.id;
        await emit(head.row);
      }
      const next = await head.iterator.next();
      if (next.done) {
        heads.splice(minIndex, 1);
      } else {
        head.row = next.value;
      }
    }
  }

  async cleanup(): Promise<void> {
    this.run = [];
    for (const file of this.runFiles) {
      await unlink(file).catch(() => undefined);
    }
    this.runFiles = [];
  }

  private async spill(): Promise<void> {
    if (this.run.length === 0) return;
    this.run.sort(compareRowAsc);
    const file = join(
      tmpdir(),
      `rh-cold-run-${process.pid}-${randomBytes(6).toString('hex')}.ndjson`
    );
    const sink = createWriteStream(file);
    try {
      for (const row of this.run) {
        if (!sink.write(`${JSON.stringify(row)}\n`)) {
          await once(sink, 'drain');
        }
      }
      await new Promise<void>((resolve, reject) => {
        sink.end(() => resolve());
        sink.on('error', reject);
      });
    } catch (error) {
      sink.destroy();
      await unlink(file).catch(() => undefined);
      throw error;
    }
    this.runFiles.push(file);
    this.run = [];
  }
}

async function* readRunRows(file: string): AsyncGenerator<IColdHistoryRow> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    yield JSON.parse(line) as IColdHistoryRow;
  }
}
