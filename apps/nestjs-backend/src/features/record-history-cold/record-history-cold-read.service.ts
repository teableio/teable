import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DataDbClientManager } from '../../global/data-db-client-manager.service';
import type { IColdHistoryRow, IParsedPartKey, ITableColdStats } from './part-codec';
import { bloomMightContain, compareRowByTimeDesc } from './part-codec';
import {
  ColdReadDeadlineError,
  RecordHistoryColdStorageService,
} from './record-history-cold-storage.service';
import { recordHistoryColdConfig } from './record-history-cold.config';

/** row shape consumed by the existing getRecordHistory post-processing */
export interface IMergedHistoryRow {
  id: string;
  recordId: string;
  fieldId: string;
  before: string;
  after: string;
  createdTime: Date;
  createdBy: string;
}

export interface ICollectHistoryRowsInput {
  tableId: string;
  recordId?: string;
  startDate?: string;
  endDate?: string;
  /** fieldIds ∩ projection, exactly as computed by getRecordHistory */
  allowedFieldIds?: string[];
  shouldFilterByField: boolean;
  createdByIds?: string[];
  cursor?: string | null;
  limit: number;
}

export interface ICollectHistoryRowsResult {
  rows: IMergedHistoryRow[];
  nextCursor?: string;
}

const CURSOR_PREFIX = 'chs1:';

export const encodeColdCursor = (createdTime: Date, id: string): string =>
  `${CURSOR_PREFIX}${Buffer.from(JSON.stringify({ t: createdTime.toISOString(), id })).toString('base64url')}`;

export const decodeColdCursor = (cursor: string): { t: string; id: string } | undefined => {
  if (!cursor.startsWith(CURSOR_PREFIX)) return undefined;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8')
    ) as { t?: string; id?: string };
    if (typeof parsed.t === 'string' && typeof parsed.id === 'string') {
      return { t: parsed.t, id: parsed.id };
    }
  } catch {
    // fall through to undefined: treated as a legacy cursor by the caller
  }
  return undefined;
};

interface IBoundary {
  /** ISO time of the boundary row */
  t: string;
  id: string;
  /** legacy prisma cursors point at the next row to return → inclusive */
  inclusive: boolean;
}

interface IBufferSource {
  head(): IMergedHistoryRow | undefined;
  advance(): Promise<void>;
}

/** the slice of the routed data prisma client the merged read touches */
interface IRecordHistoryBufferClient {
  recordHistory: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
}

/**
 * Merged record-history read: newest rows from the PG write buffer, older
 * rows from cold parts, in one (created_time DESC, id DESC) stream with row-id
 * dedup (buffer wins) so the P0/P1 overlap window — parts uploaded but buffer
 * not yet deleted — never yields duplicates.
 */
@Injectable()
export class RecordHistoryColdReadService {
  private readonly logger = new Logger(RecordHistoryColdReadService.name);

  constructor(
    private readonly dataDbClientManager: DataDbClientManager,
    private readonly coldStorage: RecordHistoryColdStorageService
  ) {}

  async collectHistoryRows(input: ICollectHistoryRowsInput): Promise<ICollectHistoryRowsResult> {
    const config = recordHistoryColdConfig();
    // mirror the legacy predicate exactly: field filter requested with an
    // empty allowed set matches nothing
    if (input.shouldFilterByField && !input.allowedFieldIds?.length) {
      return { rows: [] };
    }

    const dataPrisma = (await this.dataDbClientManager.dataPrismaForTable(
      input.tableId
    )) as unknown as IRecordHistoryBufferClient;
    const boundary = await this.resolveBoundary(dataPrisma, input.cursor);

    const want = input.limit + 1;
    const out: IMergedHistoryRow[] = [];
    const seenIds = new Set<string>();

    const buffer = this.createBufferSource(dataPrisma, input, boundary);
    await buffer.advance();

    // buffer first, cold parts only for the shortfall (the hot "just edited"
    // pages never touch S3): the buffer always holds every row newer than the
    // flush cutoff, so continuing into S3 from the last emitted row preserves
    // the global order; id-dedup covers the upload-but-not-yet-deleted overlap
    let timedOut = false;
    while (out.length < want) {
      const head = buffer.head();
      if (!head) break;
      if (!seenIds.has(head.id)) {
        seenIds.add(head.id);
        out.push(head);
      }
      await buffer.advance();
    }
    if (out.length < want) {
      const last = out[out.length - 1];
      const s3Boundary: IBoundary | undefined = last
        ? { t: last.createdTime.toISOString(), id: last.id, inclusive: false }
        : boundary;
      // the S3 budget starts when the cold segment starts — a slow buffer
      // query must not pre-spend it and turn every fall-through into an
      // instant timeout
      const s3 = new ColdSegmentIterator(
        this.coldStorage,
        input,
        s3Boundary,
        Date.now() + config.s3ReadTimeoutMs,
        this.logger
      );
      timedOut = await this.fillFromCold(s3, want, out, seenIds);
    }

    let nextCursor: string | undefined;
    if (out.length > input.limit) {
      out.pop();
      const last = out[out.length - 1];
      nextCursor = encodeColdCursor(last.createdTime, last.id);
    } else if (timedOut && out.length > 0) {
      // partial page under the S3 time budget: months are scanned atomically,
      // so the last emitted row is a safe month-boundary resume point — hand
      // back a cursor so the client can continue where the scan stopped
      const last = out[out.length - 1];
      nextCursor = encodeColdCursor(last.createdTime, last.id);
    } else if (timedOut) {
      // nothing collected before the budget ran out: an empty page here would
      // read as "no more history" and silently truncate — fail loudly instead;
      // retries make progress because scanned parts land in the etag cache
      throw new ServiceUnavailableException(
        'record history cold storage read timed out; please retry'
      );
    }
    return { rows: out, nextCursor };
  }

  private async fillFromCold(
    s3: ColdSegmentIterator,
    want: number,
    out: IMergedHistoryRow[],
    seenIds: Set<string>
  ): Promise<boolean> {
    while (out.length < want) {
      const taken = await s3.take();
      if (!taken) break;
      if (seenIds.has(taken.id)) continue;
      seenIds.add(taken.id);
      out.push({
        id: taken.id,
        recordId: taken.recordId,
        fieldId: taken.fieldId,
        before: taken.before,
        after: taken.after,
        createdTime: new Date(taken.createdTime),
        createdBy: taken.createdBy,
      });
    }
    return s3.timedOut;
  }

  private async resolveBoundary(
    dataPrisma: IRecordHistoryBufferClient,
    cursor: string | null | undefined
  ): Promise<IBoundary | undefined> {
    if (!cursor) return undefined;
    const decoded = decodeColdCursor(cursor);
    if (decoded) {
      return { t: decoded.t, id: decoded.id, inclusive: false };
    }
    // legacy prisma cursor: the id of the next row to return; it may already
    // have been flushed out of the buffer, in which case we restart the page
    const row = (await dataPrisma.recordHistory.findUnique({
      where: { id: cursor },
      select: { id: true, createdTime: true },
    })) as { id: string; createdTime: Date } | null;
    if (!row) {
      this.logger.warn(
        `legacy record-history cursor ${cursor} not found in buffer; restarting page`
      );
      return undefined;
    }
    return { t: row.createdTime.toISOString(), id: row.id, inclusive: true };
  }

  /**
   * buffer reads use raw SQL with `id COLLATE "C"` so tie ordering (rows
   * sharing one created_time) is plain byte order — the same total order the
   * cold-part comparator uses in JS. The db column collation would order
   * mixed-case cuids differently and make pagination unstable across the
   * buffer/S3 seam.
   */
  private createBufferSource(
    dataPrisma: IRecordHistoryBufferClient,
    input: ICollectHistoryRowsInput,
    boundary: IBoundary | undefined
  ): IBufferSource {
    const batchSize = 100;
    let queue: IMergedHistoryRow[] = [];
    let index = 0;
    let exhausted = false;
    let after: { t: Date; id: string; inclusive: boolean } | undefined = boundary
      ? { t: new Date(boundary.t), id: boundary.id, inclusive: boundary.inclusive }
      : undefined;

    const fetch = async () => {
      const conditions: string[] = [`"table_id" = $1`];
      const params: unknown[] = [input.tableId];
      const push = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };
      if (input.recordId) conditions.push(`"record_id" = ${push(input.recordId)}`);
      if (input.startDate) conditions.push(`"created_time" >= ${push(new Date(input.startDate))}`);
      if (input.endDate) conditions.push(`"created_time" <= ${push(new Date(input.endDate))}`);
      if (input.shouldFilterByField) {
        conditions.push(`"field_id" = ANY(${push(input.allowedFieldIds ?? [])}::text[])`);
      }
      if (input.createdByIds?.length) {
        conditions.push(`"created_by" = ANY(${push(input.createdByIds)}::text[])`);
      }
      if (after) {
        const timeParam = push(after.t);
        const op = after.inclusive ? '<=' : '<';
        conditions.push(
          `("created_time" < ${timeParam} OR ("created_time" = ${timeParam} AND "id" COLLATE "C" ${op} ${push(after.id)}))`
        );
      }
      const rows = (await dataPrisma.$queryRawUnsafe(
        `SELECT "id", "record_id" AS "recordId", "field_id" AS "fieldId",
           "before", "after", "created_time" AS "createdTime", "created_by" AS "createdBy"
         FROM "record_history"
         WHERE ${conditions.join(' AND ')}
         ORDER BY "created_time" DESC, "id" COLLATE "C" DESC
         LIMIT ${batchSize}`,
        ...params
      )) as IMergedHistoryRow[];
      queue = rows;
      index = 0;
      if (rows.length < batchSize) {
        exhausted = true;
      }
      const last = rows[rows.length - 1];
      after = last ? { t: last.createdTime, id: last.id, inclusive: false } : after;
    };

    return {
      head: () => queue[index],
      advance: async () => {
        if (index < queue.length) {
          index += 1;
        }
        if (index >= queue.length && !exhausted) {
          await fetch();
        }
      },
    };
  }
}

interface IPartCandidate extends IParsedPartKey {
  size?: number;
  etag?: string;
}

/**
 * Walks cold months newest→oldest. Within a month it scans the candidate
 * parts (pruned by key record-range and _stats), keeping only the top-k rows
 * per part (parts are record-sorted, not time-sorted, so a full part scan is
 * required — but memory stays O(k × parts)), then serves the month's rows in
 * (created_time DESC, id DESC) order.
 */
class ColdSegmentIterator {
  private months: string[] | undefined;
  private monthIndex = 0;
  private queue: IColdHistoryRow[] = [];
  private queueIndex = 0;
  private stats: ITableColdStats | undefined;
  private statsLoaded = false;
  timedOut = false;

  constructor(
    private readonly coldStorage: RecordHistoryColdStorageService,
    private readonly input: ICollectHistoryRowsInput,
    private readonly boundary: IBoundary | undefined,
    private readonly deadline: number,
    private readonly logger: Logger
  ) {}

  async head(): Promise<IColdHistoryRow | undefined> {
    while (this.queueIndex >= this.queue.length) {
      const advanced = await this.advanceMonth();
      if (!advanced) return undefined;
    }
    return this.queue[this.queueIndex];
  }

  async take(): Promise<IColdHistoryRow | undefined> {
    const row = await this.head();
    if (row) this.queueIndex += 1;
    return row;
  }

  private get startIso(): string | undefined {
    return this.input.startDate ? new Date(this.input.startDate).toISOString() : undefined;
  }

  private get endIso(): string | undefined {
    return this.input.endDate ? new Date(this.input.endDate).toISOString() : undefined;
  }

  /** undefined = scan this month; 'skip' = try an older one; 'stop' = all remaining months are older than the window */
  private classifyMonth(yyyymm: string): 'skip' | 'stop' | undefined {
    const monthStartIso = `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}-01T00:00:00.000Z`;
    if (this.startIso && this.monthEndIso(yyyymm) < this.startIso) {
      return 'stop'; // months are sorted desc: every remaining month is older
    }
    if (this.endIso && monthStartIso > this.endIso) return 'skip';
    if (this.boundary && monthStartIso > this.boundary.t) return 'skip';
    return undefined;
  }

  /** metadata awaits count against the budget too; sets timedOut when spent */
  private budgetSpent(): boolean {
    if (Date.now() > this.deadline) this.timedOut = true;
    return this.timedOut;
  }

  /** loads month list + stats once; false when the budget ran out doing so */
  private async ensureMonthMetadata(): Promise<boolean> {
    if (!this.months) {
      this.months = await this.coldStorage.listMonths(this.input.tableId);
      if (this.budgetSpent()) return false;
    }
    if (!this.statsLoaded) {
      this.statsLoaded = true;
      this.stats = await this.coldStorage.readStats(this.input.tableId);
      if (this.budgetSpent()) return false;
    }
    return true;
  }

  private async advanceMonth(): Promise<boolean> {
    if (this.timedOut) return false;
    if (!(await this.ensureMonthMetadata()) || !this.months) return false;
    while (this.monthIndex < this.months.length) {
      const yyyymm = this.months[this.monthIndex++];
      const verdict = this.classifyMonth(yyyymm);
      if (verdict === 'stop') return false;
      if (verdict === 'skip') continue;
      const rows = await this.collectMonth(yyyymm);
      if (this.timedOut) return false;
      if (rows.length > 0) {
        this.queue = rows;
        this.queueIndex = 0;
        return true;
      }
    }
    return false;
  }

  private monthEndIso(yyyymm: string): string {
    const year = Number(yyyymm.slice(0, 4));
    const month = Number(yyyymm.slice(4, 6));
    const next = new Date(Date.UTC(year, month, 1));
    return new Date(next.getTime() - 1).toISOString();
  }

  /**
   * a key from our listing can vanish mid-read when a flusher/compactor
   * heal pass supersedes it — the replacement part exists but is invisible
   * to our stale listing. One fresh re-list + rescan resolves the race;
   * a second miss (or one during the retry) propagates.
   */
  private async collectMonth(yyyymm: string): Promise<IColdHistoryRow[]> {
    try {
      return await this.collectMonthOnce(yyyymm);
    } catch (error) {
      if (!ColdSegmentIterator.isMissingPartError(error)) throw error;
      this.logger.warn(
        `cold part vanished under a concurrent rewrite in ${this.input.tableId}/${yyyymm}; re-listing`
      );
      return await this.collectMonthOnce(yyyymm);
    }
  }

  private static isMissingPartError(error: unknown): boolean {
    const candidate = error as { name?: string; code?: string; message?: string } | undefined;
    const signature = `${candidate?.name ?? ''} ${candidate?.code ?? ''} ${candidate?.message ?? ''}`;
    return /NoSuchKey|NotFound|ENOENT|does not exist|404/i.test(signature);
  }

  private async collectMonthOnce(yyyymm: string): Promise<IColdHistoryRow[]> {
    const { input } = this;
    const parts = await this.coldStorage.listMonthParts(input.tableId, yyyymm);
    if (this.budgetSpent()) return [];
    const candidates = this.pruneParts(parts);
    const k = input.limit + 1;
    let collected: IColdHistoryRow[] = [];
    for (const candidate of candidates) {
      if (Date.now() > this.deadline) {
        this.timedOut = true;
      }
      if (this.timedOut) {
        // set here or mid-scan inside scanPartTopK: a partially scanned
        // month must contribute nothing (its rows would be incomplete)
        this.logger.warn(
          `record-history cold read hit the S3 time budget at ${input.tableId}/${yyyymm}; returning a partial page`
        );
        return [];
      }
      collected.push(...(await this.scanPartTopK(candidate, k)));
      // one request consumes at most k rows, so anything beyond the k
      // newest can never be read — compact periodically to keep a month
      // with hundreds of parts from allocating parts × k rows at once
      if (collected.length > k * 8) {
        collected = ColdSegmentIterator.topKDeduped(collected, k);
      }
    }
    if (this.timedOut) return [];
    return ColdSegmentIterator.topKDeduped(collected, k);
  }

  /** sort desc, drop adjacent id-duplicates (day/month part overlap during a
   * compaction transition), keep only the k newest */
  private static topKDeduped(collected: IColdHistoryRow[], k: number): IColdHistoryRow[] {
    collected.sort((a, b) => compareRowByTimeDesc(a, b));
    const rows: IColdHistoryRow[] = [];
    for (const row of collected) {
      if (rows.length === 0 || rows[rows.length - 1].id !== row.id) {
        rows.push(row);
        if (rows.length === k) break;
      }
    }
    return rows;
  }

  /**
   * record-level pruning: a part's key carries its minRecordId, so a part
   * with minRecordId > recordId can never contain the record. Every other
   * part stays a candidate — a heavily edited record can exceed the part
   * size budget and spill across consecutive parts (each starting AT that
   * record), so keeping only the last min<=recordId part per group would
   * drop the earlier spilled rows. The per-part stats record range and
   * bloom filter prune the surviving candidates cheaply.
   */
  private pruneByRecordId(parts: IParsedPartKey[], recordId: string): IPartCandidate[] {
    return parts.filter((part) => part.minRecordId <= recordId);
  }

  /** entry sets are advisory: unknown (null) or no filter → cannot prune */
  private static setsIntersect(
    entrySet: string[] | null,
    queryList: string[] | undefined
  ): boolean {
    if (!entrySet || !queryList?.length) return true;
    return entrySet.some((value) => queryList.includes(value));
  }

  /** stats are advisory: no entry → must scan */
  private statsAllowPart(part: IPartCandidate): boolean {
    const { input, boundary, stats } = this;
    const entry = stats?.parts[part.key];
    if (!entry) return true;
    const recordId = input.recordId;
    if (recordId && (entry.maxRecordId < recordId || entry.minRecordId > recordId)) return false;
    if (recordId && entry.recordBloom && !bloomMightContain(entry.recordBloom, recordId)) {
      return false; // bloom "definitely absent" — safe to prune
    }
    if (boundary && entry.minCreatedTime > boundary.t) return false;
    if (this.startIso && entry.maxCreatedTime < this.startIso) return false;
    if (this.endIso && entry.minCreatedTime > this.endIso) return false;
    if (
      input.shouldFilterByField &&
      !ColdSegmentIterator.setsIntersect(entry.fieldIds, input.allowedFieldIds)
    ) {
      return false;
    }
    return ColdSegmentIterator.setsIntersect(entry.createdBys, input.createdByIds);
  }

  private pruneParts(parts: IParsedPartKey[]): IPartCandidate[] {
    const candidates = this.input.recordId
      ? this.pruneByRecordId(parts, this.input.recordId)
      : parts;
    return candidates.filter((part) => this.statsAllowPart(part));
  }

  private withinBoundary(row: IColdHistoryRow): boolean {
    const { boundary } = this;
    if (!boundary) return true;
    if (row.createdTime > boundary.t) return false;
    if (row.createdTime === boundary.t) {
      return boundary.inclusive ? row.id <= boundary.id : row.id < boundary.id;
    }
    return true;
  }

  private matchesRow(row: IColdHistoryRow): boolean {
    const { input } = this;
    if (input.recordId && row.recordId !== input.recordId) return false;
    if (this.startIso && row.createdTime < this.startIso) return false;
    if (this.endIso && row.createdTime > this.endIso) return false;
    if (input.shouldFilterByField && !input.allowedFieldIds?.includes(row.fieldId)) return false;
    if (input.createdByIds?.length && !input.createdByIds.includes(row.createdBy)) return false;
    return this.withinBoundary(row);
  }

  /** full part scan keeping only the k newest matching rows */
  private async scanPartTopK(candidate: IPartCandidate, k: number): Promise<IColdHistoryRow[]> {
    const top: IColdHistoryRow[] = [];
    let scanned = 0;
    try {
      for await (const item of this.coldStorage.iterateRowsCached(
        candidate.key,
        { etag: candidate.etag, size: candidate.size },
        this.deadline
      )) {
        // the deadline must hold WITHIN a part too: a slow download or a
        // large part would otherwise be read to completion long past the S3
        // budget. Breaking marks the month as timed out (partial scans
        // contribute nothing) and the iterator's finally destroys the stream.
        if ((scanned++ & 1023) === 0 && Date.now() > this.deadline) {
          this.timedOut = true;
          break;
        }
        const row = item.row;
        if (!row || !this.matchesRow(row)) continue;
        ColdSegmentIterator.pushTopK(top, row, k);
      }
    } catch (error) {
      // a download that outlived the budget is a timeout, not a failure
      if (!(error instanceof ColdReadDeadlineError)) throw error;
      this.timedOut = true;
    }
    return top.sort((a, b) => compareRowByTimeDesc(a, b));
  }

  private static pushTopK(top: IColdHistoryRow[], row: IColdHistoryRow, k: number): void {
    if (top.length < k) {
      top.push(row);
      if (top.length === k) top.sort((a, b) => compareRowByTimeDesc(a, b));
      return;
    }
    // top is sorted desc; the last element is the current worst
    if (compareRowByTimeDesc(row, top[k - 1]) < 0) {
      top[k - 1] = row;
      top.sort((a, b) => compareRowByTimeDesc(a, b));
    }
  }
}
