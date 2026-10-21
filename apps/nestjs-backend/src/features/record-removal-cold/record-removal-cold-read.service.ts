import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { isColdReadInterrupted, isMissingPartError } from '../cold-archive/cold-errors';
import type { IServingOrder } from '../cold-archive/part-order';
import { orderPartsByServingBound, pageOutranksRest } from '../cold-archive/part-order';
import type {
  ColdRemovalReason,
  IColdRemovalRow,
  IParsedPartKey,
  IPartStatsEntry,
  ITableColdStats,
} from './part-codec';
import { bloomMightContain, compareRemovalRowDesc } from './part-codec';
import { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';
import { recordRemovalColdConfig } from './record-removal-cold.config';

// Cold-side reader for the archive list merge (P3.2): serves the tail of an
// archive page from record-removal cold parts once the caller's PG
// record_trash zone runs out. The PG half of the seam lives in the EE
// ArchiveService — this service only sees an exclusive boundary (the last PG
// row, or a decoded rms1: cursor) and continues strictly after it in the
// requested serving order.

// sort dimensions the archive list pages on; 'removedTime' matches the part
// physical order (fast path with early stops), the record-meta dims force a
// bounded full scan (slow path — see fillBySecondary)
export type IRemovalColdOrderBy = 'removedTime' | 'recordCreatedTime' | 'recordLastModifiedTime';

export type IRemovalColdDirection = 'asc' | 'desc';

// exclusive resume point in the serving order: (orderBy sort key, row id) of
// the last row the caller already served
export interface IRemovalColdBoundary {
  // ISO value of the orderBy dimension
  k: string;
  id: string;
}

export interface IRemovalColdFilters {
  recordCreatedBys?: string[];
  recordLastModifiedBys?: string[];
  removedTimeStart?: string;
  removedTimeEnd?: string;
  recordCreatedTimeStart?: string;
  recordCreatedTimeEnd?: string;
}

export interface ICollectArchivedRowsInput {
  tableId: string;
  reason: ColdRemovalReason;
  // rows to return; the reader over-fetches one internally to detect whether
  // a next page exists
  limit: number;
  orderBy: IRemovalColdOrderBy;
  direction: IRemovalColdDirection;
  boundary?: IRemovalColdBoundary;
  filters?: IRemovalColdFilters;
  // caller-supplied row filter (e.g. the EE archive search matcher): rows
  // failing it do not count toward the page, so cold pages stay full while
  // matches remain
  rowPredicate?: (row: IColdRemovalRow) => boolean;
  // tombstone filter: rows restored/purged AFTER sinking must vanish from
  // cold reads. Receives (recordId, removedTime) so the caller can apply the
  // time-qualified rule (see isTombstonedAt in the tombstone service — a
  // record re-archived after its tombstone sinks legitimate NEWER rows).
  // Absent = "never tombstoned".
  isTombstoned?: (recordId: string, removedTime: string) => boolean;
  // row-id dedup across the PG/cold seam: the caller seeds it with the PG
  // page's row ids (the sunk-but-not-yet-deleted overlap window); this call
  // adds every emitted cold row id
  seenIds: Set<string>;
  // overrides the config default (s3ReadTimeoutMs) for the whole call
  deadlineMs?: number;
}

export interface ICollectArchivedRowsResult {
  rows: IColdRemovalRow[];
  // rms1: cursor after the last returned row; null = the cold tail is done
  nextCursor: string | null;
}

const COLD_CURSOR_PREFIX = 'rms1:';

// rms1 cold cursor: base64url(JSON { k, id }) — the exclusive (sort key, id)
// resume point. The { k: null, id: null } form means "cold zone, from the
// top": the EE seam hands it out when the PG zone ended without a usable
// sort-key boundary (all-null secondary keys) or as a retryable cursor after
// a cold timeout on a fresh boundary-less page.
export const encodeRemovalColdCursor = (boundary: IRemovalColdBoundary | undefined): string => {
  const payload = boundary ? { k: boundary.k, id: boundary.id } : { k: null, id: null };
  return `${COLD_CURSOR_PREFIX}${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
};

// undefined = not a cold cursor (PG zone); { boundary: undefined } = cold
// zone from the top; { boundary } = cold zone resume point
export const decodeRemovalColdCursor = (
  cursor: string
): { boundary?: IRemovalColdBoundary } | undefined => {
  if (!cursor.startsWith(COLD_CURSOR_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.slice(COLD_CURSOR_PREFIX.length), 'base64url').toString('utf8')
    ) as { k?: string | null; id?: string | null };
    if (typeof parsed.k === 'string' && typeof parsed.id === 'string') {
      return { boundary: { k: parsed.k, id: parsed.id } };
    }
    if (parsed.k === null && parsed.id === null) return {};
  } catch {
    // malformed payload: fall through — treated as garbage by the caller
  }
  return undefined;
};

const sortKeyOf = (row: IColdRemovalRow, orderBy: IRemovalColdOrderBy): string | undefined => {
  if (orderBy === 'removedTime') return row.removedTime;
  return orderBy === 'recordCreatedTime' ? row.recordCreatedTime : row.recordLastModifiedTime;
};

const toIso = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : new Date(value).toISOString();

// filter bounds normalized to the canonical ISO form once per call, so every
// comparison against row values (already ISO with milliseconds + 'Z', see the
// flusher's to_char) is a plain lexicographic string compare
interface INormalizedFilters {
  removedTimeStart?: string;
  removedTimeEnd?: string;
  recordCreatedTimeStart?: string;
  recordCreatedTimeEnd?: string;
  recordCreatedBys?: string[];
  recordLastModifiedBys?: string[];
}

const normalizeFilters = (filters: IRemovalColdFilters | undefined): INormalizedFilters => ({
  removedTimeStart: toIso(filters?.removedTimeStart),
  removedTimeEnd: toIso(filters?.removedTimeEnd),
  recordCreatedTimeStart: toIso(filters?.recordCreatedTimeStart),
  recordCreatedTimeEnd: toIso(filters?.recordCreatedTimeEnd),
  recordCreatedBys: filters?.recordCreatedBys,
  recordLastModifiedBys: filters?.recordLastModifiedBys,
});

// entry sets are advisory: unknown (null = over the stats cap) or no filter →
// cannot prune
const setsIntersect = (entrySet: string[] | null, queryList: string[] | undefined): boolean => {
  if (!entrySet || !queryList?.length) return true;
  return entrySet.some((value) => queryList.includes(value));
};

interface IPartCandidate extends IParsedPartKey {
  size?: number;
  etag?: string;
}

// a key from a listing can vanish mid-read when a flusher/compactor heal pass
// supersedes it — shared by the page scan and the point lookup, both of which
// resolve the race with one fresh re-list + rescan
// point lookup over the cold parts of one (tableId, reason) prefix — the
// archive restore fallback and the purge-of-sunk-rows path resolve recordIds
// with no PG row through this
export interface ILookupArchivedRowsInput {
  tableId: string;
  reason: ColdRemovalReason;
  recordIds: string[];
  // same time-qualified tombstone predicate as the page reader: suppressed
  // rows are treated as nonexistent, so an id whose every cold row is
  // tombstoned simply comes back "not found"
  isTombstoned?: (recordId: string, removedTime: string) => boolean;
  // overrides the config default (s3ReadTimeoutMs) for the whole call
  deadlineMs?: number;
}

@Injectable()
export class RecordRemovalColdReadService {
  private readonly logger = new Logger(RecordRemovalColdReadService.name);

  constructor(private readonly coldStorage: RecordRemovalColdStorageService) {}

  async collectArchivedRows(input: ICollectArchivedRowsInput): Promise<ICollectArchivedRowsResult> {
    const config = recordRemovalColdConfig();
    // a limit of 0 would make the +1 probe unpoppable; the seam never asks
    // for empty pages (it hands out a boundary cursor instead), so clamp
    const limit = Math.max(1, Math.floor(input.limit));
    const deadline = Date.now() + (input.deadlineMs ?? config.s3ReadTimeoutMs);
    const scan = new ArchiveColdScan(
      this.coldStorage,
      input,
      normalizeFilters(input.filters),
      deadline,
      this.logger
    );

    const want = limit + 1;
    const out: IColdRemovalRow[] = [];
    const timedOut =
      input.orderBy === 'removedTime'
        ? await scan.fillByRemovedTime(want, out)
        : await scan.fillBySecondary(want, out);

    let nextCursor: string | null = null;
    if (out.length > limit) {
      const probe = out.pop()!;
      // the probe row is served on the NEXT page — it must stay deduplicable
      input.seenIds.delete(probe.id);
      nextCursor = this.cursorAfter(out, input.orderBy);
    } else if (timedOut && out.length > 0) {
      // partial page under the S3 budget: fast-path months are collected
      // atomically (a partially scanned month contributes nothing), so the
      // last emitted row is a safe resume point — hand back a cursor so the
      // client continues where the scan stopped
      nextCursor = this.cursorAfter(out, input.orderBy);
    } else if (timedOut) {
      // nothing collected before the budget ran out: an empty page here would
      // read as "no more archives" and silently truncate — fail loudly
      // instead; retries make progress because scanned parts land in the
      // part byte cache
      throw new ServiceUnavailableException(
        'record removal cold storage read timed out; please retry'
      );
    }
    return { rows: out, nextCursor };
  }

  private cursorAfter(out: IColdRemovalRow[], orderBy: IRemovalColdOrderBy): string {
    const last = out[out.length - 1];
    // rows emitted under a secondary sort always carry the dim (missing-dim
    // rows are excluded), so the sort key is never undefined here
    return encodeRemovalColdCursor({ k: sortKeyOf(last, orderBy)!, id: last.id });
  }

  // Point-look up the LATEST cold row of each requested recordId.
  //
  // COST PROFILE: months are walked newest→oldest; per month one LIST plus a
  // scan of only the parts whose stats recordBloom might contain a still-
  // missing id ("definitely absent" parts are skipped; no stats/bloom = must
  // scan). Rows bucket by removedTime, so the newest month containing a
  // record holds its latest row — a month is finalized once all its candidate
  // parts were scanned, found ids leave the missing set, and the walk stops
  // early when it is empty. With stats present a K-id lookup typically
  // downloads the few parts that actually hold the records plus ~0.8% bloom
  // false positives; an id that never existed costs the month LISTs alone.
  //
  // ALL-OR-NOTHING under the time budget: a partial scan could hand back an
  // OLDER copy of a record whose latest row sits in an unscanned month (a
  // restore would then resurrect stale data), so exceeding the budget throws
  // instead of returning what was found — retries make progress through the
  // part byte cache.
  async lookupArchivedRowsByRecordIds(
    input: ILookupArchivedRowsInput
  ): Promise<Map<string, IColdRemovalRow>> {
    const config = recordRemovalColdConfig();
    const deadline = Date.now() + (input.deadlineMs ?? config.s3ReadTimeoutMs);
    const found = new Map<string, IColdRemovalRow>();
    const missing = new Set(input.recordIds);
    if (missing.size === 0) return found;

    const months = await this.coldStorage.listMonths(input.tableId, input.reason);
    this.assertLookupBudget(deadline);
    if (months.length === 0) return found;
    const stats = await this.coldStorage.readStatsCached(input.tableId, input.reason);
    this.assertLookupBudget(deadline);

    // listMonths is newest→oldest already
    for (const yyyymm of months) {
      if (missing.size === 0) break;
      try {
        await this.lookupMonth(input, yyyymm, stats, missing, found, deadline);
      } catch (error) {
        if (!isMissingPartError(error)) throw error;
        this.logger.warn(
          `cold removal part vanished under a concurrent rewrite in ${input.tableId}/${input.reason}/${yyyymm}; re-listing`
        );
        await this.lookupMonth(input, yyyymm, stats, missing, found, deadline);
      }
      // month fully scanned: everything found so far is final (older months
      // only hold strictly older removedTimes)
      for (const recordId of found.keys()) missing.delete(recordId);
    }
    return found;
  }

  private async lookupMonth(
    input: ILookupArchivedRowsInput,
    yyyymm: string,
    stats: ITableColdStats | undefined,
    missing: Set<string>,
    found: Map<string, IColdRemovalRow>,
    deadline: number
  ): Promise<void> {
    const parts = await this.coldStorage.listMonthParts(input.tableId, input.reason, yyyymm);
    this.assertLookupBudget(deadline);
    const candidates = parts.filter((part) =>
      RecordRemovalColdReadService.bloomAllowsAny(stats?.parts[part.key], missing)
    );
    for (const candidate of candidates) {
      await this.scanPartForRecords(input, candidate, missing, found, deadline);
    }
  }

  // stats are advisory: no entry / no bloom → must scan; with a bloom the part
  // is skipped only when EVERY still-missing id is definitely absent
  private static bloomAllowsAny(entry: IPartStatsEntry | undefined, missing: Set<string>): boolean {
    const bloom = entry?.recordBloom;
    if (!bloom) return true;
    for (const recordId of missing) {
      if (bloomMightContain(bloom, recordId)) return true;
    }
    return false;
  }

  private async scanPartForRecords(
    input: ILookupArchivedRowsInput,
    candidate: IPartCandidate,
    missing: Set<string>,
    found: Map<string, IColdRemovalRow>,
    deadline: number
  ): Promise<void> {
    let scanned = 0;
    try {
      for await (const item of this.coldStorage.iterateRowsCached(
        candidate.key,
        { etag: candidate.etag, size: candidate.size },
        deadline
      )) {
        if ((scanned++ & 1023) === 0) this.assertLookupBudget(deadline);
        const row = item.row;
        if (!row || !missing.has(row.recordId)) continue;
        if (input.isTombstoned?.(row.recordId, row.removedTime)) continue;
        const best = found.get(row.recordId);
        // keep the max-(removedTime, id) row; day/month part overlap during a
        // compaction transition can surface the same row twice — equal rows
        // compare 0 and the first copy wins
        if (!best || compareRemovalRowDesc(row, best) < 0) {
          found.set(row.recordId, row);
        }
      }
    } catch (error) {
      if (!isColdReadInterrupted(error)) throw error;
      this.throwLookupTimeout();
    }
  }

  private assertLookupBudget(deadline: number): void {
    if (Date.now() > deadline) this.throwLookupTimeout();
  }

  private throwLookupTimeout(): never {
    throw new ServiceUnavailableException(
      'record removal cold storage lookup timed out; please retry'
    );
  }
}

// One page's scan state over the cold months of a (tableId, reason) prefix.
//
// Fast path (orderBy=removedTime): months are walked in serving order and
// collected atomically; inside a month the candidate parts (pruned by bucket
// dims and _stats) are scanned with early stops — parts are physically
// (removedTime DESC, id DESC) sorted, so a desc reader stops the moment its
// page quota is met (unlike record-history, whose record-major parts always
// need a full scan).
//
// Slow path (secondary sort keys): parts are removedTime-ordered, so there is
// no early stop — every candidate part streams fully through a bounded top-K.
class ArchiveColdScan {
  private months: string[] | undefined;
  private stats: ITableColdStats | undefined;
  private statsLoaded = false;
  private timedOut = false;

  constructor(
    private readonly coldStorage: RecordRemovalColdStorageService,
    private readonly input: ICollectArchivedRowsInput,
    private readonly filters: INormalizedFilters,
    private readonly deadline: number,
    private readonly logger: Logger
  ) {}

  // ---------------------------------------------------------------- fast path

  async fillByRemovedTime(want: number, out: IColdRemovalRow[]): Promise<boolean> {
    if (!(await this.ensureMonthMetadata()) || !this.months) return this.timedOut;
    // listMonths returns newest→oldest; asc serves oldest months first
    const ordered = this.input.direction === 'desc' ? this.months : [...this.months].reverse();
    for (const yyyymm of ordered) {
      if (out.length >= want) break;
      const verdict = this.classifyMonth(yyyymm);
      if (verdict === 'stop') break;
      if (verdict === 'skip') continue;
      const rows = await this.collectMonth(yyyymm, want - out.length, 'fast');
      if (this.timedOut) break;
      this.emit(rows, want, out);
    }
    return this.timedOut;
  }

  // undefined = scan this month; 'skip' = try the next one; 'stop' = every
  // remaining month (in iteration order) is out of the window
  private classifyMonth(yyyymm: string): 'skip' | 'stop' | undefined {
    const { lo, hi } = ArchiveColdScan.monthRange(yyyymm);
    return this.input.direction === 'desc'
      ? this.classifyMonthDesc(lo, hi)
      : this.classifyMonthAsc(lo, hi);
  }

  // iterating newest→oldest: once a month falls below the start bound, all
  // remaining months are older still
  private classifyMonthDesc(lo: string, hi: string): 'skip' | 'stop' | undefined {
    const f = this.filters;
    const boundary = this.input.boundary;
    if (f.removedTimeStart && hi <= f.removedTimeStart) return 'stop';
    if (f.removedTimeEnd && lo > f.removedTimeEnd) return 'skip';
    if (boundary && lo > boundary.k) return 'skip';
    return undefined;
  }

  // iterating oldest→newest: once a month rises above the end bound, all
  // remaining months are newer still
  private classifyMonthAsc(lo: string, hi: string): 'skip' | 'stop' | undefined {
    const f = this.filters;
    const boundary = this.input.boundary;
    if (f.removedTimeEnd && lo > f.removedTimeEnd) return 'stop';
    if (f.removedTimeStart && hi <= f.removedTimeStart) return 'skip';
    if (boundary && hi <= boundary.k) return 'skip';
    return undefined;
  }

  // ---------------------------------------------------------------- slow path

  // SECONDARY-SORT COST PROFILE: parts are removedTime-ordered, so a page on
  // recordCreatedTime/recordLastModifiedTime cannot stop early — every
  // candidate part (after bucket + _stats pruning on the removedTime filters
  // and the secondary-dim ranges) streams fully through a bounded top-K
  // (k = limit+1, compacted at k*8). One page costs O(candidate cold rows)
  // scanned with O(k) held; later pages re-scan but hit the part byte cache.
  // Acceptable: secondary sorts are an explicit user action on the archive
  // list, never its default order.
  //
  // The scan is all-or-nothing under the time budget: a partially scanned key
  // space could emit rows that unscanned parts should have preceded, and the
  // resume cursor would then skip them forever — so a timeout here
  // contributes zero rows (the caller degrades or fails loudly).
  async fillBySecondary(want: number, out: IColdRemovalRow[]): Promise<boolean> {
    if (!(await this.ensureMonthMetadata()) || !this.months) return this.timedOut;
    const collected: IColdRemovalRow[] = [];
    for (const yyyymm of this.months) {
      // months only bound removedTime, which is orthogonal to the secondary
      // sort: they prune by the removedTime FILTERS alone, in any order
      const { lo, hi } = ArchiveColdScan.monthRange(yyyymm);
      if (this.filters.removedTimeStart && hi <= this.filters.removedTimeStart) continue;
      if (this.filters.removedTimeEnd && lo > this.filters.removedTimeEnd) continue;
      collected.push(...(await this.collectMonth(yyyymm, want, 'slow')));
      if (this.timedOut) return true;
      if (collected.length > want * 8) {
        this.trimTopK(collected, want);
      }
    }
    this.trimTopK(collected, want);
    this.emit(collected, want, out);
    return false;
  }

  // ------------------------------------------------------------- month scans

  // a key from our listing can vanish mid-read when a flusher/compactor heal
  // pass supersedes it — the replacement part exists but is invisible to our
  // stale listing. One fresh re-list + rescan resolves the race; rows double-
  // collected across the retry are deduplicated by id. A second miss (or one
  // during the retry) propagates.
  private async collectMonth(
    yyyymm: string,
    k: number,
    mode: 'fast' | 'slow'
  ): Promise<IColdRemovalRow[]> {
    try {
      return await this.collectMonthOnce(yyyymm, k, mode);
    } catch (error) {
      if (this.degradeInterrupted(error, yyyymm)) return [];
      if (!isMissingPartError(error)) throw error;
      this.logger.warn(
        `cold removal part vanished under a concurrent rewrite in ${this.input.tableId}/${this.input.reason}/${yyyymm}; re-listing`
      );
      try {
        return await this.collectMonthOnce(yyyymm, k, mode);
      } catch (retryError) {
        if (this.degradeInterrupted(retryError, yyyymm)) return [];
        throw retryError;
      }
    }
  }

  // a transient store failure (throttled/5xx LIST) is the deadline's twin: months
  // already collected stand, the incomplete one drops, zero progress still raises 503
  private degradeInterrupted(error: unknown, yyyymm: string): boolean {
    if (!isColdReadInterrupted(error)) return false;
    this.timedOut = true;
    this.logger.warn(
      `record-removal cold read interrupted at ${this.input.tableId}/${this.input.reason}/${yyyymm}: ${
        error instanceof Error ? error.message : error
      }; returning a partial page`
    );
    return true;
  }

  private async collectMonthOnce(
    yyyymm: string,
    k: number,
    mode: 'fast' | 'slow'
  ): Promise<IColdRemovalRow[]> {
    const { input } = this;
    const parts = await this.coldStorage.listMonthParts(input.tableId, input.reason, yyyymm);
    if (this.budgetSpent()) return [];
    const order = this.servingOrder(mode);
    const candidates = orderPartsByServingBound(
      parts.filter((part) => this.bucketAllows(part) && this.statsAllowPart(part)),
      order
    );
    const collected: IColdRemovalRow[] = [];
    for (let index = 0; index < candidates.length; index++) {
      if (Date.now() > this.deadline) this.timedOut = true;
      if (this.timedOut) {
        // set here or mid-scan inside the part scan: a partially scanned
        // month must contribute nothing (its rows would be incomplete)
        this.logger.warn(
          `record-removal cold read hit the S3 time budget at ${input.tableId}/${input.reason}/${yyyymm}; returning a partial page`
        );
        return [];
      }
      collected.push(...(await this.scanPart(candidates[index], k, mode)));
      // one request consumes at most k rows, so anything beyond the k best can
      // never be read: folding them away every time the page fills keeps a
      // month with many parts from holding parts × k rows at once
      if (collected.length < k) continue;
      this.trimTopK(collected, k);
      const weakest =
        collected.length === k ? sortKeyOf(collected[k - 1], input.orderBy) : undefined;
      if (pageOutranksRest(weakest, candidates[index + 1], order)) break;
    }
    if (this.timedOut) return [];
    this.trimTopK(collected, k);
    return collected;
  }

  // ------------------------------------------------------------- part scans

  // only the desc removedTime scan can exploit the physical part order; the asc
  // fast path and the secondary sorts share the bounded keep-k full scan (asc:
  // the best/oldest rows sit at the part's END — slow-ish but bounded:
  // O(part rows) scanned, O(k) held)
  private async scanPart(
    candidate: IPartCandidate,
    k: number,
    mode: 'fast' | 'slow'
  ): Promise<IColdRemovalRow[]> {
    return mode === 'fast' && this.input.direction === 'desc'
      ? this.scanPartRemovedTimeDesc(candidate, k)
      : this.scanPartKeepK(candidate, k);
  }

  // stream one part's rows with the shared safety rails: the deadline must
  // hold WITHIN a part too (a slow download or a large part would otherwise
  // be read to completion long past the budget — checked every 1024 rows),
  // and a download that outlived the budget is a timeout, not a failure.
  // Stopping (return/break by the consumer) closes the underlying stream.
  private async *iteratePart(candidate: IPartCandidate): AsyncGenerator<IColdRemovalRow> {
    let scanned = 0;
    try {
      for await (const item of this.coldStorage.iterateRowsCached(
        candidate.key,
        { etag: candidate.etag, size: candidate.size },
        this.deadline
      )) {
        if ((scanned++ & 1023) === 0 && Date.now() > this.deadline) {
          this.timedOut = true;
          return;
        }
        if (item.row) yield item.row;
      }
    } catch (error) {
      if (!isColdReadInterrupted(error)) throw error;
      this.timedOut = true;
    }
  }

  // fast-path desc: the part is physically (removedTime DESC, id DESC)
  // sorted, so matching rows arrive in serving order — stop at the page
  // quota or below the oldest bound
  private async scanPartRemovedTimeDesc(
    candidate: IPartCandidate,
    k: number
  ): Promise<IColdRemovalRow[]> {
    const collected: IColdRemovalRow[] = [];
    for await (const row of this.iteratePart(candidate)) {
      // physical desc order: below the oldest bound nothing later matches
      if (this.filters.removedTimeStart && row.removedTime < this.filters.removedTimeStart) {
        break;
      }
      if (!this.matchesRow(row)) continue;
      collected.push(row);
      // page-fill early stop: later rows are strictly worse
      if (collected.length >= k) break;
    }
    return collected;
  }

  // full stream keeping the k best rows under the serving order — used by
  // the asc fast path and by the secondary sorts, where no early stop is
  // possible (see the cost profile note)
  private async scanPartKeepK(candidate: IPartCandidate, k: number): Promise<IColdRemovalRow[]> {
    const collected: IColdRemovalRow[] = [];
    for await (const row of this.iteratePart(candidate)) {
      if (!this.matchesRow(row)) continue;
      collected.push(row);
      if (collected.length > k * 8) this.trimTopK(collected, k);
    }
    this.trimTopK(collected, k);
    return collected;
  }

  // --------------------------------------------------------------- filtering

  private matchesRow(row: IColdRemovalRow): boolean {
    const { input } = this;
    // seam dedup: the caller seeds seenIds with its PG page (the flush
    // overlap window) and emitted rows accumulate here — a seen row must
    // never consume top-K space
    if (input.seenIds.has(row.id)) return false;
    if (!this.withinTimeFilters(row) || !this.matchesActorFilters(row)) return false;
    // secondary sorts exclude rows missing the sort dim entirely (the PG side
    // orders its NULLs per Prisma default inside its own zone — see the
    // archive seam note in the EE service)
    const key = sortKeyOf(row, input.orderBy);
    if (key === undefined) return false;
    if (input.boundary && !this.afterBoundary(key, row.id)) return false;
    // tombstoned rows (restored/purged after sinking) vanish from cold reads
    if (input.isTombstoned?.(row.recordId, row.removedTime)) return false;
    return input.rowPredicate ? input.rowPredicate(row) : true;
  }

  private withinTimeFilters(row: IColdRemovalRow): boolean {
    const f = this.filters;
    if (f.removedTimeStart && row.removedTime < f.removedTimeStart) return false;
    if (f.removedTimeEnd && row.removedTime > f.removedTimeEnd) return false;
    // a range filter on an absent dim can never match — SQL NULL comparison
    // semantics, identical to the PG side of the seam
    if (
      f.recordCreatedTimeStart &&
      (row.recordCreatedTime === undefined || row.recordCreatedTime < f.recordCreatedTimeStart)
    ) {
      return false;
    }
    if (
      f.recordCreatedTimeEnd &&
      (row.recordCreatedTime === undefined || row.recordCreatedTime > f.recordCreatedTimeEnd)
    ) {
      return false;
    }
    return true;
  }

  private matchesActorFilters(row: IColdRemovalRow): boolean {
    const f = this.filters;
    if (
      f.recordCreatedBys?.length &&
      (!row.recordCreatedBy || !f.recordCreatedBys.includes(row.recordCreatedBy))
    ) {
      return false;
    }
    if (
      f.recordLastModifiedBys?.length &&
      (!row.recordLastModifiedBy || !f.recordLastModifiedBys.includes(row.recordLastModifiedBy))
    ) {
      return false;
    }
    return true;
  }

  // exclusive boundary in serving order; the id tie-break is a raw UTF-16
  // code-unit comparison (byte order for these ASCII ids) — the same total
  // order the parts are written in, never a locale/db collation
  private afterBoundary(key: string, id: string): boolean {
    const boundary = this.input.boundary!;
    if (key !== boundary.k) {
      return this.input.direction === 'desc' ? key < boundary.k : key > boundary.k;
    }
    return this.input.direction === 'desc' ? id < boundary.id : id > boundary.id;
  }

  // ----------------------------------------------------------------- pruning

  // key-level pruning from the bucket dims alone (works without stats): a
  // day part covers [dd 00:00, dd+1 00:00) UTC, a month part the whole month
  private bucketAllows(part: IParsedPartKey): boolean {
    const { lo, hi } = ArchiveColdScan.bucketRange(part);
    const f = this.filters;
    if (f.removedTimeStart && hi <= f.removedTimeStart) return false;
    if (f.removedTimeEnd && lo > f.removedTimeEnd) return false;
    if (this.input.orderBy === 'removedTime' && this.input.boundary) {
      // hi is exclusive: rows < hi <= boundary can never sort after it (asc)
      if (this.input.direction === 'desc' && lo > this.input.boundary.k) return false;
      if (this.input.direction === 'asc' && hi <= this.input.boundary.k) return false;
    }
    return true;
  }

  // stats are advisory: no entry → must scan
  private statsAllowPart(part: IPartCandidate): boolean {
    const entry = this.stats?.parts[part.key];
    if (!entry) return true;
    const f = this.filters;
    if (f.removedTimeStart && entry.maxRemovedTime < f.removedTimeStart) return false;
    if (f.removedTimeEnd && entry.minRemovedTime > f.removedTimeEnd) return false;
    // the record-meta bounds cover only rows carrying the dim; rows without
    // it can never match a range filter (NULL semantics) nor serve a
    // secondary sort, so pruning against them is exact — and an ABSENT bound
    // means the part has zero dim-carrying rows, prunable whenever the dim is
    // range-filtered
    if (
      f.recordCreatedTimeStart &&
      (entry.maxRecordCreatedTime === undefined ||
        entry.maxRecordCreatedTime < f.recordCreatedTimeStart)
    ) {
      return false;
    }
    if (
      f.recordCreatedTimeEnd &&
      (entry.minRecordCreatedTime === undefined ||
        entry.minRecordCreatedTime > f.recordCreatedTimeEnd)
    ) {
      return false;
    }
    if (!this.orderBoundsAllow(entry)) return false;
    return (
      setsIntersect(entry.recordCreatedBys, f.recordCreatedBys) &&
      setsIntersect(entry.recordLastModifiedBys, f.recordLastModifiedBys)
    );
  }

  // boundary pruning on the ordering dim, plus the secondary-sort "no
  // dim-carrying rows at all" case
  private orderBoundsAllow(entry: IPartStatsEntry): boolean {
    const { orderBy, direction, boundary } = this.input;
    let min: string | undefined = entry.minRemovedTime;
    let max: string | undefined = entry.maxRemovedTime;
    if (orderBy !== 'removedTime') {
      min =
        orderBy === 'recordCreatedTime'
          ? entry.minRecordCreatedTime
          : entry.minRecordLastModifiedTime;
      max =
        orderBy === 'recordCreatedTime'
          ? entry.maxRecordCreatedTime
          : entry.maxRecordLastModifiedTime;
      // every row of this part misses the secondary sort dim → none servable
      if (min === undefined || max === undefined) return false;
    }
    if (!boundary) return true;
    if (direction === 'desc') return min! <= boundary.k;
    return max! >= boundary.k;
  }

  // -------------------------------------------------------------- assembling

  // Only the fast path is served from removedTime, the one dimension whose
  // bounds are required on every entry. A secondary sort is served from bounds
  // that are optional, so it declares them unknown: the listing order then
  // survives untouched and nothing ever prunes.
  private servingOrder(mode: 'fast' | 'slow'): IServingOrder<IPartCandidate> {
    const descending = this.input.direction === 'desc';
    if (mode !== 'fast') return { boundOf: () => undefined, descending };
    return {
      boundOf: (part) => {
        const entry = this.stats?.parts[part.key];
        return descending ? entry?.maxRemovedTime : entry?.minRemovedTime;
      },
      descending,
    };
  }

  private compareServing(a: IColdRemovalRow, b: IColdRemovalRow): number {
    const { orderBy, direction } = this.input;
    // collected rows always carry the sort dim (matchesRow excluded the rest)
    const ka = sortKeyOf(a, orderBy)!;
    const kb = sortKeyOf(b, orderBy)!;
    const sign = direction === 'desc' ? -1 : 1;
    if (ka !== kb) return ka < kb ? -sign : sign;
    if (a.id !== b.id) return a.id < b.id ? -sign : sign;
    return 0;
  }

  // sort into serving order, drop adjacent id-duplicates (day/month part
  // overlap during a compaction transition, or a concurrent re-flush), keep
  // only the k best — in place
  private trimTopK(collected: IColdRemovalRow[], k: number): void {
    collected.sort((a, b) => this.compareServing(a, b));
    let write = 0;
    for (let read = 0; read < collected.length && write < k; read++) {
      if (write === 0 || collected[write - 1].id !== collected[read].id) {
        collected[write++] = collected[read];
      }
    }
    collected.length = Math.min(write, k);
  }

  private emit(rows: IColdRemovalRow[], want: number, out: IColdRemovalRow[]): void {
    for (const row of rows) {
      if (out.length >= want) return;
      if (this.input.seenIds.has(row.id)) continue;
      this.input.seenIds.add(row.id);
      out.push(row);
    }
  }

  // ---------------------------------------------------------------- metadata

  // metadata awaits count against the budget too; sets timedOut when spent
  private budgetSpent(): boolean {
    if (Date.now() > this.deadline) this.timedOut = true;
    return this.timedOut;
  }

  // loads the month list + stats once; false when the budget ran out doing so
  private async ensureMonthMetadata(): Promise<boolean> {
    if (!this.months) {
      this.months = await this.coldStorage.listMonths(this.input.tableId, this.input.reason);
      if (this.budgetSpent()) return false;
    }
    if (!this.statsLoaded && this.months.length > 0) {
      this.statsLoaded = true;
      this.stats = await this.coldStorage.readStatsCached(this.input.tableId, this.input.reason);
      if (this.budgetSpent()) return false;
    }
    return true;
  }

  // [lo, hi) ISO range of a month dir
  private static monthRange(yyyymm: string): { lo: string; hi: string } {
    const year = Number(yyyymm.slice(0, 4));
    const month = Number(yyyymm.slice(4, 6));
    return {
      lo: new Date(Date.UTC(year, month - 1, 1)).toISOString(),
      hi: new Date(Date.UTC(year, month, 1)).toISOString(),
    };
  }

  // [lo, hi) ISO range of a part's bucket
  private static bucketRange(part: IParsedPartKey): { lo: string; hi: string } {
    if (part.kind !== 'day') return ArchiveColdScan.monthRange(part.yyyymm);
    const year = Number(part.yyyymm.slice(0, 4));
    const month = Number(part.yyyymm.slice(4, 6));
    const day = Number(part.dd);
    return {
      lo: new Date(Date.UTC(year, month - 1, day)).toISOString(),
      hi: new Date(Date.UTC(year, month - 1, day + 1)).toISOString(),
    };
  }
}
