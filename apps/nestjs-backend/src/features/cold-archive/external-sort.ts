import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { iterateNdjsonLines } from './ndjson';

/** rows per in-memory run before spilling (secondary, count-based cap) */
const DEFAULT_RUN_SIZE = 50_000;
/**
 * run files a merge may open at once. Each open reader holds one decoded row
 * plus its line buffer, and a cold row can be tens of MB, so an unbounded
 * fan-in OOM'd the 2026-07-08 drain. Above this the merge goes multi-pass.
 */
const DEFAULT_MERGE_FAN_IN = 16;
const MIN_MERGE_FAN_IN = 2;

/** what a sorter needs to know about the rows of one cold subsystem */
export interface IColdRowCodec<TRow extends { id: string }> {
  /** the subsystem's canonical part order */
  compare: (a: TRow, b: TRow) => number;
  /** approximate serialized bytes; real heap cost is ~2-3x (UTF-16 + headers) */
  sizeOf: (row: TRow) => number;
  /** tmpdir filename prefix, kept distinct per subsystem for spill triage */
  tmpPrefix: string;
}

/** the only surface SortMemoryBudget needs from the runs it evicts */
export interface IEvictable {
  readonly pendingBytes: number;
  evict(): Promise<void>;
}

/**
 * Shared cap on the bytes ALL live sorters may hold in memory together.
 *
 * A table flush opens one sorter per bucket and buffer reads can keep every
 * bucket live at once, so a per-sorter cap puts peak memory at O(#buckets x
 * run size). On the 2026-07-08 drain a 21-month table (x4 table concurrency)
 * turned that into 2-3GB of heap and a V8 OOM. Charging every add against one
 * run-wide budget and evicting the largest run restores a constant bound.
 *
 * Bytes stay charged until an evicted run's spill WRITE lands, not merely
 * until the rows leave the array: the in-flight gzip write still references
 * them. enforce() therefore waits on in-flight spills when nothing is
 * evictable, which is the backpressure that bounds total memory.
 */
export class SortMemoryBudget {
  private used = 0;
  private readonly sorters = new Set<IEvictable>();
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly maxBytes: number) {}

  get usedBytes(): number {
    return this.used;
  }

  register(sorter: IEvictable): void {
    this.sorters.add(sorter);
  }

  /** stop offering this run for eviction; its bytes stay charged until released */
  unregister(sorter: IEvictable): void {
    this.sorters.delete(sorter);
  }

  charge(bytes: number): void {
    this.used += bytes;
  }

  release(bytes: number): void {
    this.used = Math.max(0, this.used - bytes);
  }

  trackInflight(write: Promise<void>): void {
    this.inflight.add(write);
    const drop = (): void => {
      this.inflight.delete(write);
    };
    write.then(drop, drop);
  }

  async enforce(): Promise<void> {
    while (this.used > this.maxBytes) {
      let largest: IEvictable | undefined;
      for (const sorter of this.sorters) {
        if (!largest || sorter.pendingBytes > largest.pendingBytes) largest = sorter;
      }
      if (largest && largest.pendingBytes > 0) {
        try {
          await largest.evict();
        } catch {
          // the evicted sorter records its own failure and fails its own table
          // loudly; the swap already freed memory, so this loop still progresses
        }
        continue;
      }
      if (this.inflight.size > 0) {
        await Promise.race([...this.inflight].map((write) => write.catch(() => undefined)));
        continue;
      }
      // the remainder is pinned by sorters mid-drain (released at cleanup);
      // overshoot is bounded by one run, so return instead of spinning
      return;
    }
  }
}

/**
 * Disk-backed sort + dedup for bucket rewrites.
 *
 * No input order can be trusted: the buffer stream follows the db collation
 * (mixed-case cuids order differently than bytes, and a timestamp tiebreak
 * need not match the comparator either), and existing parts folded back in may
 * carry that order too. Rows collect into in-memory runs, each sorted with the
 * codec's comparator and spilled to a gzipped temp file; a bounded-fan-in
 * k-way merge with adjacent id dedup emits one stream in the canonical order —
 * the only order the part keys and the read path understand.
 *
 * A run spills at DEFAULT_RUN_SIZE rows, or earlier when the shared budget
 * evicts it: the count bounds one sorter, only the budget bounds all of them.
 */
export class ColdRowSorter<TRow extends { id: string }> implements IEvictable {
  private run: TRow[] = [];
  private runBytes = 0;
  private runFiles: string[] = [];
  private rowsAdded = 0;
  private readonly pendingSpills = new Set<Promise<void>>();
  /** first spill failure; every later add()/drainTo() rethrows it */
  private spillError: unknown;
  private draining = false;

  private readonly mergeFanIn: number;

  constructor(
    private readonly codec: IColdRowCodec<TRow>,
    private readonly runSize = DEFAULT_RUN_SIZE,
    private readonly budget?: SortMemoryBudget,
    mergeFanIn = DEFAULT_MERGE_FAN_IN
  ) {
    // a pass of 1->1 never shrinks the file count, so the merge would spin
    this.mergeFanIn = Math.max(MIN_MERGE_FAN_IN, mergeFanIn);
    budget?.register(this);
  }

  get added(): number {
    return this.rowsAdded;
  }

  /** bytes held by the in-memory run — the budget's eviction key */
  get pendingBytes(): number {
    return this.runBytes;
  }

  /**
   * A failed spill means accepted rows are gone, so the output would be
   * incomplete: fail fast rather than let the owner delete buffer rows that
   * were never written.
   */
  async add(row: TRow): Promise<void> {
    if (this.spillError) throw this.spillError;
    const bytes = this.codec.sizeOf(row);
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

  /**
   * Merge all runs in canonical order, deduped by row id, into `emit`.
   *
   * The draining gate, the unregister and the settle all happen BEFORE the
   * in-memory/merge choice: an eviction racing this drain would otherwise
   * leave its rows in a file the merge never sees, and the caller would then
   * delete buffer rows that never reached a part.
   */
  async drainTo(emit: (row: TRow) => Promise<void>): Promise<void> {
    try {
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

  private async drainInMemory(emit: (row: TRow) => Promise<void>): Promise<void> {
    this.run.sort(this.codec.compare);
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
   * once: each pass merges groups of up-to-K runs into one, deleting inputs as
   * it goes, until a final group of <=K streams into `emit`.
   */
  private async mergeSpilledRuns(emit: (row: TRow) => Promise<void>): Promise<void> {
    while (this.runFiles.length > this.mergeFanIn) {
      const inputs = this.runFiles;
      const outputs: string[] = [];
      for (let i = 0; i < inputs.length; i += this.mergeFanIn) {
        const group = inputs.slice(i, i + this.mergeFanIn);
        const merged = await this.mergeGroupToFile(group);
        outputs.push(merged);
        // track inputs AND outputs so a throw mid-pass still unlinks every file
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

  private async mergeGroupToFile(files: string[]): Promise<string> {
    const file = this.tmpFile('merge');
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

  /** opens exactly files.length readers, so callers must keep that <= fan-in */
  private async *mergeFiles(files: string[]): AsyncGenerator<TRow> {
    const heads: IMergeHead<TRow>[] = [];
    try {
      for (const file of files) {
        const iterator = readRunRows<TRow>(file);
        const first = await iterator.next();
        if (!first.done) heads.push({ row: first.value, iterator });
        else await iterator.return?.(undefined);
      }
      let lastId: string | undefined;
      while (heads.length > 0) {
        const minIndex = this.pickMinRow(heads);
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
      // on early return or throw, release file handles and decompressor buffers
      for (const head of heads) {
        await head.iterator.return?.(undefined).catch(() => undefined);
      }
    }
  }

  private pickMinRow(heads: IMergeHead<TRow>[]): number {
    let minIndex = 0;
    for (let i = 1; i < heads.length; i++) {
      if (this.codec.compare(heads[i].row, heads[minIndex].row) < 0) minIndex = i;
    }
    return minIndex;
  }

  async cleanup(): Promise<void> {
    // settle first, or an in-flight spill's file leaks into tmpdir once
    // runFiles is cleared
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
   * Eviction entry point for the shared budget. A no-op once draining started:
   * an eviction picked moments before the unregister must not swap rows out
   * from under the emitter.
   */
  async evict(): Promise<void> {
    if (this.draining) return;
    await this.spill();
  }

  /**
   * Sort + write the current run to a gzipped temp file.
   *
   * The swap happens BEFORE any await: a budget sweep may spill this sorter
   * between its owner's adds, and a row pushed during the write must open the
   * next run — landing in an already-sorted file would break the merge order.
   * The charge is released only when the write LANDS, so a large-row producer
   * cannot race ahead of the disk.
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

  private async settleSpills(): Promise<void> {
    await Promise.allSettled([...this.pendingSpills]);
    if (this.spillError) throw this.spillError;
  }

  private async writeRun(rows: TRow[]): Promise<void> {
    rows.sort(this.codec.compare);
    const file = this.tmpFile('run');
    try {
      // level 1: ~4-6x on this JSON for a few % CPU. The budget makes runs
      // smaller and more numerous, so this keeps their disk footprint below
      // what the uncompressed big runs cost.
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

  private tmpFile(kind: 'run' | 'merge'): string {
    return join(
      tmpdir(),
      `${this.codec.tmpPrefix}-${kind}-${process.pid}-${randomBytes(6).toString('hex')}.ndjson.gz`
    );
  }
}

interface IMergeHead<TRow> {
  row: TRow;
  iterator: AsyncGenerator<TRow>;
}

function* serializeRunRows<TRow>(rows: TRow[]): Generator<string> {
  for (const row of rows) {
    yield `${JSON.stringify(row)}\n`;
  }
}

async function* readRunRows<TRow>(file: string): AsyncGenerator<TRow> {
  const stream = createReadStream(file).pipe(createGunzip());
  for await (const line of iterateNdjsonLines(stream)) {
    yield JSON.parse(line) as TRow;
  }
}
