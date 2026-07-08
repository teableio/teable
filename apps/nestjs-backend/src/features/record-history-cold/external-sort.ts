import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { IColdHistoryRow } from './part-codec';
import { compareRowAsc } from './part-codec';

/** rows per in-memory run before spilling to disk (secondary, count-based cap) */
const DEFAULT_RUN_SIZE = 50_000;

/**
 * approximate serialized bytes of a row — the budgeting unit for sort runs
 * and read batches; actual JS heap cost is ~2-3x this (UTF-16 strings plus
 * object headers)
 */
export const approxColdRowBytes = (row: IColdHistoryRow): number =>
  64 +
  row.id.length +
  row.recordId.length +
  row.fieldId.length +
  row.before.length +
  row.after.length +
  row.createdTime.length +
  row.createdBy.length;

/**
 * Shared cap on the bytes ALL live sorters may hold in memory together.
 *
 * A table flush opens one sorter per bucket, and record-major buffer reads
 * keep every bucket of the table live at once — so a per-sorter cap alone
 * puts peak memory at O(#buckets x run size). On the 2026-07-08 cn drain a
 * 21-month table (x4 table concurrency) multiplied that into 2-3GB of heap
 * and a V8 OOM at the 2304MB default cap, three runs in a row. Charging
 * every add against one run-wide budget and evicting the largest run
 * restores a constant bound no matter how many buckets or tables are in
 * flight.
 */
export class SortMemoryBudget {
  private used = 0;
  private readonly sorters = new Set<ExternalRowSorter>();

  constructor(private readonly maxBytes: number) {}

  get usedBytes(): number {
    return this.used;
  }

  register(sorter: ExternalRowSorter): void {
    this.sorters.add(sorter);
  }

  /** stop offering this sorter's run for eviction (bytes stay charged until released) */
  unregister(sorter: ExternalRowSorter): void {
    this.sorters.delete(sorter);
  }

  charge(bytes: number): void {
    this.used += bytes;
  }

  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }

  /** evict the largest live run(s) until the total fits the budget again */
  async enforce(): Promise<void> {
    while (this.used > this.maxBytes) {
      let largest: ExternalRowSorter | undefined;
      for (const sorter of this.sorters) {
        if (!largest || sorter.pendingBytes > largest.pendingBytes) largest = sorter;
      }
      // nothing evictable left: the remainder is pinned by sorters already
      // draining (their bytes release at cleanup) — overshoot is bounded by
      // one run, do not busy-loop on it
      if (!largest || largest.pendingBytes === 0) return;
      try {
        await largest.evict();
      } catch {
        // a cross-table eviction failure is NOT this caller's error: the
        // evicted sorter recorded it and its own table fails loudly at the
        // next add()/drainTo() instead of deleting rows it never wrote.
        // The swap already freed the memory, so the loop still progresses.
      }
    }
  }
}

/**
 * Disk-backed sort + dedup for bucket rewrites.
 *
 * Nothing about the inputs' order can be trusted: the buffer stream follows
 * the db collation (mixed-case cuids order differently than bytes), and
 * legacy parts may carry that order too. Rows are collected into in-memory
 * runs, each run sorted with the byte comparator and spilled to a gzipped
 * temp file, and the final k-way merge (with adjacent row-id dedup) emits one
 * clean byte-ordered stream — the only order the part keys and the read-path
 * pruning understand.
 *
 * A run spills at DEFAULT_RUN_SIZE rows, or earlier when the shared
 * SortMemoryBudget evicts it — the count alone bounds one sorter, only the
 * budget bounds all of them together.
 */
export class ExternalRowSorter {
  private run: IColdHistoryRow[] = [];
  private runBytes = 0;
  private runFiles: string[] = [];
  private rowsAdded = 0;
  /** spill writes still in flight (budget evictions the owner never awaits) */
  private readonly pendingSpills = new Set<Promise<void>>();
  /** first spill failure; every later add()/drainTo() rethrows it */
  private spillError: unknown;
  private draining = false;

  constructor(
    private readonly runSize = DEFAULT_RUN_SIZE,
    private readonly budget?: SortMemoryBudget
  ) {
    budget?.register(this);
  }

  get added(): number {
    return this.rowsAdded;
  }

  /** bytes currently held by the in-memory run (the budget's eviction key) */
  get pendingBytes(): number {
    return this.runBytes;
  }

  async add(row: IColdHistoryRow): Promise<void> {
    // fail fast: a failed spill means rows this sorter accepted are gone,
    // so its output is incomplete — the owning table must error out (and
    // skip its buffer delete), not keep feeding a sorter that cannot deliver
    if (this.spillError) throw this.spillError;
    const bytes = approxColdRowBytes(row);
    this.run.push(row);
    this.rowsAdded += 1;
    this.runBytes += bytes;
    this.budget?.charge(bytes);
    if (this.run.length >= this.runSize) {
      await this.spill();
      return;
    }
    await this.budget?.enforce();
  }

  /** merge all runs in byte order, deduped by row id, into `emit` */
  async drainTo(emit: (row: IColdHistoryRow) => Promise<void>): Promise<void> {
    try {
      // from here on the output set is frozen: no eviction may touch this
      // sorter again (draining gate + unregister), and every in-flight
      // eviction write must land in runFiles — or fail loudly — BEFORE we
      // choose between the in-memory and merge paths. Skipping the settle
      // would let a budget eviction racing this drain leave its rows in a
      // file the merge never sees, and the caller would then delete buffer
      // rows that were never written to a part.
      this.draining = true;
      this.budget?.unregister(this);
      await this.settleSpills();
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
    // let in-flight spill writes land first so their files are unlinked
    // below instead of leaking into tmpdir after runFiles was cleared
    await Promise.allSettled([...this.pendingSpills]);
    this.budget?.release(this.runBytes);
    this.runBytes = 0;
    this.run = [];
    this.budget?.unregister(this);
    for (const file of this.runFiles) {
      await unlink(file).catch(() => undefined);
    }
    this.runFiles = [];
  }

  /**
   * eviction entry point for the shared budget — a no-op once the owner
   * started draining: the drain froze the output set, and an eviction picked
   * from the registry moments before the unregister must not swap rows out
   * from under the emitter
   */
  async evict(): Promise<void> {
    if (this.draining) return;
    await this.spill();
  }

  /**
   * sort + write the current run to a gzipped temp file. The swap happens
   * BEFORE any await: a budget sweep may spill this sorter while its owner is
   * between adds, and a row pushed during the file write must open the next
   * run — landing inside a file whose contents were already sorted would
   * silently break the merge order. The write itself is tracked in
   * pendingSpills so drainTo/cleanup can settle writes they never awaited.
   */
  async spill(): Promise<void> {
    if (this.run.length === 0) return;
    const rows = this.run;
    this.run = [];
    this.budget?.release(this.runBytes);
    this.runBytes = 0;
    const write = this.writeRun(rows);
    const tracked: Promise<void> = write.finally(() => this.pendingSpills.delete(tracked));
    this.pendingSpills.add(tracked);
    await tracked;
  }

  /** every in-flight spill has landed (or the first failure is rethrown) */
  private async settleSpills(): Promise<void> {
    await Promise.allSettled([...this.pendingSpills]);
    if (this.spillError) throw this.spillError;
  }

  private async writeRun(rows: IColdHistoryRow[]): Promise<void> {
    rows.sort(compareRowAsc);
    const file = join(
      tmpdir(),
      `rh-cold-run-${process.pid}-${randomBytes(6).toString('hex')}.ndjson.gz`
    );
    try {
      // gzip level 1: ~4-6x on this JSON for a few % CPU — the budget makes
      // runs smaller and more numerous, this keeps their disk footprint (and
      // spill I/O) below what the uncompressed big runs used to cost
      await pipeline(
        Readable.from(serializeRunRows(rows)),
        createGzip({ level: 1 }),
        createWriteStream(file)
      );
    } catch (error) {
      this.spillError ??= error;
      await unlink(file).catch(() => undefined);
      throw error;
    }
    this.runFiles.push(file);
  }
}

function* serializeRunRows(rows: IColdHistoryRow[]): Generator<string> {
  for (const row of rows) {
    yield `${JSON.stringify(row)}\n`;
  }
}

async function* readRunRows(file: string): AsyncGenerator<IColdHistoryRow> {
  const lines = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    yield JSON.parse(line) as IColdHistoryRow;
  }
}
