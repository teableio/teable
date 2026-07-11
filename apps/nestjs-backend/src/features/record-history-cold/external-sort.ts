import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { IColdHistoryRow } from './part-codec';
import { compareRowAsc, iterateNdjsonLines } from './part-codec';

/** rows per in-memory run before spilling to disk (secondary, count-based cap) */
const DEFAULT_RUN_SIZE = 50_000;
/**
 * default cap on run files opened at once during a merge. A single history row
 * can be tens of MB (up to 15MB observed on the ai fleet), and the merge holds
 * one decoded row per open reader plus that reader's line buffer, so an
 * unbounded fan-in over a big bucket's runs OOM'd the 2026-07-08 drain. Above
 * this the merge goes multi-pass.
 */
const DEFAULT_MERGE_FAN_IN = 16;
/**
 * a merge must combine at least two runs per pass or the file count never
 * shrinks and the multi-pass loop spins forever — clamp any smaller
 * configured value (env allows 1) up to this floor
 */
const MIN_MERGE_FAN_IN = 2;

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
 * and a V8 OOM at the 2304MB default cap. Charging every add against one
 * run-wide budget and evicting the largest run restores a constant bound no
 * matter how many buckets or tables are in flight.
 *
 * The budget stays charged for an evicted run until its spill WRITE lands (not
 * merely until the rows leave the in-memory array): the rows are still
 * referenced by the in-flight gzip write, so releasing early let a fast
 * large-row producer race ahead of the disk and pile up in-flight writes.
 * enforce() therefore also waits on in-flight spills when nothing is
 * evictable, which is the backpressure that bounds total memory.
 */
export class SortMemoryBudget {
  private used = 0;
  private readonly sorters = new Set<ExternalRowSorter>();
  private readonly inflight = new Set<Promise<void>>();

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

  /** track a spill write so enforce() can wait on it; auto-removed on settle */
  trackInflight(write: Promise<void>): void {
    this.inflight.add(write);
    const drop = (): void => {
      this.inflight.delete(write);
    };
    write.then(drop, drop);
  }

  /** evict the largest live run(s) until the total fits the budget again */
  async enforce(): Promise<void> {
    while (this.used > this.maxBytes) {
      let largest: ExternalRowSorter | undefined;
      for (const sorter of this.sorters) {
        if (!largest || sorter.pendingBytes > largest.pendingBytes) largest = sorter;
      }
      if (largest && largest.pendingBytes > 0) {
        try {
          await largest.evict();
        } catch {
          // a cross-table eviction failure is NOT this caller's error: the
          // evicted sorter recorded it and its own table fails loudly at the
          // next add()/drainTo() instead of deleting rows it never wrote.
          // The swap already freed the memory, so the loop still progresses.
        }
        continue;
      }
      // nothing evictable in memory: the overage is all in-flight spill
      // writes. Wait for one to land (releasing its bytes) before letting the
      // caller add more — this is the backpressure that stops a large-row
      // firehose from outrunning the disk and piling up in-flight writes.
      if (this.inflight.size > 0) {
        await Promise.race([...this.inflight].map((write) => write.catch(() => undefined)));
        continue;
      }
      // nothing evictable, nothing in flight: the remainder is pinned by
      // sorters mid-drain (released at cleanup). Overshoot bounded by one
      // run; do not spin.
      return;
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
 * temp file, and a bounded-fan-in k-way merge (with adjacent row-id dedup)
 * emits one clean byte-ordered stream — the only order the part keys and the
 * read-path pruning understand.
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

  private readonly mergeFanIn: number;

  constructor(
    private readonly runSize = DEFAULT_RUN_SIZE,
    private readonly budget?: SortMemoryBudget,
    mergeFanIn = DEFAULT_MERGE_FAN_IN
  ) {
    // fan-in of 1 would loop forever (a pass of 1->1 never shrinks the count)
    this.mergeFanIn = Math.max(MIN_MERGE_FAN_IN, mergeFanIn);
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

  /**
   * Multi-pass k-way merge that never opens more than mergeFanIn readers at
   * once. Each pass merges groups of up-to-K run files into one deduped run,
   * deleting inputs as it goes, until a final group of <=K remains to stream
   * into `emit`. this.runFiles always lists the live temp files so cleanup()
   * unlinks them on any throw.
   */
  private async mergeSpilledRuns(emit: (row: IColdHistoryRow) => Promise<void>): Promise<void> {
    while (this.runFiles.length > this.mergeFanIn) {
      const inputs = this.runFiles;
      const outputs: string[] = [];
      for (let i = 0; i < inputs.length; i += this.mergeFanIn) {
        const group = inputs.slice(i, i + this.mergeFanIn);
        const merged = await this.mergeGroupToFile(group);
        outputs.push(merged);
        // keep both the untouched inputs and the new outputs tracked so a
        // throw mid-pass still cleans every temp file up
        this.runFiles = [...inputs, ...outputs];
      }
      for (const file of inputs) {
        await unlink(file).catch(() => undefined);
      }
      this.runFiles = outputs;
    }
    for await (const row of this.mergeFiles(this.runFiles)) {
      await emit(row);
    }
  }

  /** k-way merge a group of run files into a fresh gzipped run file (deduped) */
  private async mergeGroupToFile(files: string[]): Promise<string> {
    const file = join(
      tmpdir(),
      `rh-cold-merge-${process.pid}-${randomBytes(6).toString('hex')}.ndjson.gz`
    );
    try {
      await pipeline(
        Readable.from(this.mergeFilesToLines(files)),
        createGzip({ level: 1 }),
        createWriteStream(file)
      );
    } catch (error) {
      this.spillError ??= error;
      await unlink(file).catch(() => undefined);
      throw error;
    }
    return file;
  }

  private async *mergeFilesToLines(files: string[]): AsyncGenerator<string> {
    for await (const row of this.mergeFiles(files)) {
      yield `${JSON.stringify(row)}\n`;
    }
  }

  /**
   * k-way merge the given run files into one byte-ordered, id-deduped stream.
   * Opens exactly files.length readers, so callers must keep that <= fan-in.
   */
  private async *mergeFiles(files: string[]): AsyncGenerator<IColdHistoryRow> {
    const heads: IMergeHead[] = [];
    try {
      for (const file of files) {
        const iterator = readRunRows(file);
        const first = await iterator.next();
        if (!first.done) heads.push({ row: first.value, iterator });
        else await iterator.return?.(undefined);
      }
      let lastId: string | undefined;
      while (heads.length > 0) {
        const minIndex = pickMinRow(heads);
        const head = heads[minIndex];
        if (head.row.id !== lastId) {
          lastId = head.row.id;
          yield head.row;
        }
        const next = await head.iterator.next();
        if (next.done) heads.splice(minIndex, 1);
        else head.row = next.value;
      }
    } finally {
      // early return / throw: close any readers still open so their file
      // handles and decompressor buffers are released promptly
      for (const head of heads) {
        await head.iterator.return?.(undefined).catch(() => undefined);
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
   * silently break the merge order. The budget charge is released only when
   * the write LANDS (the rows stay referenced by the in-flight write until
   * then), so a large-row producer cannot race ahead of the disk.
   */
  async spill(): Promise<void> {
    if (this.run.length === 0) return;
    const rows = this.run;
    const bytes = this.runBytes;
    this.run = [];
    this.runBytes = 0;
    const tracked: Promise<void> = this.writeRun(rows).finally(() => {
      this.pendingSpills.delete(tracked);
      this.budget?.release(bytes);
    });
    this.pendingSpills.add(tracked);
    this.budget?.trackInflight(tracked);
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

interface IMergeHead {
  row: IColdHistoryRow;
  iterator: AsyncGenerator<IColdHistoryRow>;
}

/** index of the byte-smallest head row across the open run readers */
function pickMinRow(heads: IMergeHead[]): number {
  let minIndex = 0;
  for (let i = 1; i < heads.length; i++) {
    if (compareRowAsc(heads[i].row, heads[minIndex].row) < 0) minIndex = i;
  }
  return minIndex;
}

function* serializeRunRows(rows: IColdHistoryRow[]): Generator<string> {
  for (const row of rows) {
    yield `${JSON.stringify(row)}\n`;
  }
}

async function* readRunRows(file: string): AsyncGenerator<IColdHistoryRow> {
  const stream = createReadStream(file).pipe(createGunzip());
  // iterateNdjsonLines avoids readline's regex/ConsString flatten on huge
  // lines (a single 15MB history row is one line) and destroys the stream
  // on early return
  for await (const line of iterateNdjsonLines(stream)) {
    yield JSON.parse(line) as IColdHistoryRow;
  }
}
