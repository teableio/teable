/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/cognitive-complexity */
import { Readable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type StorageAdapter from '../attachments/plugins/adapter';
import { BucketMergeFeeder } from './bucket-merge-feeder';
import { ExternalRowSorter, SortMemoryBudget } from './external-sort';
import type { IColdHistoryRow } from './part-codec';
import {
  bloomMightContain,
  buildPartKey,
  buildRecordBloom,
  compareRowByTimeDesc,
  iterateNdjsonLines,
  iteratePartRows,
  parsePartKey,
  partFileSuffix,
  truncateColdRow,
  truncateColdValue,
} from './part-codec';
import { PartWriter } from './part-writer';
import {
  decodeColdCursor,
  encodeColdCursor,
  RecordHistoryColdReadService,
} from './record-history-cold-read.service';
import { RecordHistoryColdStorageService } from './record-history-cold-storage.service';
import { RecordHistoryColdProcessor } from './record-history-cold.processor';
import { RecordHistoryCompactorService } from './record-history-compactor.service';
import { nextReadBatchLimit, RecordHistoryFlusherService } from './record-history-flusher.service';
import type { IColdFlushRunResult } from './record-history-flusher.service';

const ROOT = 'record-history';

class FakeStorageAdapter {
  objects = new Map<string, Buffer>();

  async uploadFileStream(_bucket: string, path: string, stream: Buffer | Readable) {
    const chunks: Buffer[] = [];
    if (Buffer.isBuffer(stream)) {
      chunks.push(stream);
    } else {
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
    }
    this.objects.set(path, Buffer.concat(chunks));
    return { hash: '', path };
  }

  async downloadFile(_bucket: string, path: string): Promise<Readable> {
    const body = this.objects.get(path);
    if (!body) throw new Error(`NoSuchKey: ${path}`);
    return Readable.from(body);
  }

  async listObjects(_bucket: string, prefix: string, options?: { delimiter?: string }) {
    const objects: { key: string; size: number }[] = [];
    const prefixes = new Set<string>();
    for (const [key, body] of this.objects) {
      if (!key.startsWith(prefix)) continue;
      if (options?.delimiter) {
        const rest = key.slice(prefix.length);
        const idx = rest.indexOf(options.delimiter);
        if (idx >= 0) {
          prefixes.add(prefix + rest.slice(0, idx + 1));
          continue;
        }
      }
      objects.push({ key, size: body.length });
    }
    objects.sort((a, b) => (a.key < b.key ? -1 : 1));
    return { objects, prefixes: [...prefixes].sort() };
  }

  async deleteFile(_bucket: string, path: string) {
    this.objects.delete(path);
  }

  async deleteDir(_bucket: string, path: string) {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}

const makeRow = (overrides: Partial<IColdHistoryRow>): IColdHistoryRow => ({
  id: 'rh0000000000000000000000',
  recordId: 'recA',
  fieldId: 'fldA',
  before: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'old' }),
  after: JSON.stringify({ meta: { type: 'singleLineText' }, data: 'new' }),
  createdTime: '2026-05-10T10:00:00.000Z',
  createdBy: 'usr1',
  ...overrides,
});

const sortAsc = (rows: IColdHistoryRow[]) =>
  [...rows].sort((a, b) => {
    if (a.recordId !== b.recordId) return a.recordId < b.recordId ? -1 : 1;
    if (a.createdTime !== b.createdTime) return a.createdTime < b.createdTime ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

const seedParts = async (
  storage: RecordHistoryColdStorageService,
  tableId: string,
  bucket: { yyyymm: string; kind: 'day' | 'month'; dd?: string },
  rows: IColdHistoryRow[],
  partUncompressedBytes = 1024 * 1024
) => {
  const writer = new PartWriter({
    store: storage.partStore,
    rootDir: storage.rootDir,
    tableId,
    bucket,
    partUncompressedBytes,
  });
  for (const row of sortAsc(rows)) {
    await writer.add(row);
  }
  return writer.finish();
};

describe('record-history cold storage', () => {
  let fake: FakeStorageAdapter;
  let storage: RecordHistoryColdStorageService;

  beforeEach(() => {
    fake = new FakeStorageAdapter();
    storage = new RecordHistoryColdStorageService(fake as unknown as StorageAdapter);
  });

  afterEach(() => {
    delete process.env.BACKEND_RECORD_HISTORY_COLD_S3_READ_TIMEOUT_MS;
  });

  describe('part key codec', () => {
    it('builds and parses day and month keys', () => {
      const day = buildPartKey(
        ROOT,
        'tblX',
        { yyyymm: '202605', kind: 'day', dd: '07' },
        3,
        'recB'
      );
      expect(day).toBe(`record-history/v1/tblX/202605/07-p0003-recB${partFileSuffix()}`);
      const parsedDay = parsePartKey(ROOT, day);
      expect(parsedDay).toMatchObject({
        tableId: 'tblX',
        yyyymm: '202605',
        kind: 'day',
        dd: '07',
        seq: 3,
        minRecordId: 'recB',
      });

      const month = buildPartKey(ROOT, 'tblX', { yyyymm: '202605', kind: 'month' }, 0, 'recA');
      const parsedMonth = parsePartKey(ROOT, month);
      expect(parsedMonth).toMatchObject({ kind: 'month', seq: 0, minRecordId: 'recA' });

      expect(parsePartKey(ROOT, 'record-history/v1/tblX/_stats.json')).toBeUndefined();
    });
  });

  describe('PartWriter', () => {
    it('cuts multiple verified parts and round-trips all rows', async () => {
      const rows = Array.from({ length: 50 }, (_, i) =>
        makeRow({
          id: `rh${String(i).padStart(4, '0')}`,
          recordId: `rec${String(i % 7).padStart(2, '0')}`,
          createdTime: `2026-05-10T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
        })
      );
      const entries = await seedParts(
        storage,
        'tblW',
        { yyyymm: '202605', kind: 'day', dd: '10' },
        rows,
        2048 // force multiple parts
      );
      expect(entries.length).toBeGreaterThan(1);
      expect(entries.reduce((sum, e) => sum + e.rows, 0)).toBe(50);

      const decoded: IColdHistoryRow[] = [];
      for (const entry of entries) {
        const stream = await fake.downloadFile('any', entry.key);
        for await (const item of iteratePartRows(entry.key, stream)) {
          if (item.row) decoded.push(item.row);
        }
      }
      expect(decoded).toHaveLength(50);
      expect(new Set(decoded.map((r) => r.id)).size).toBe(50);
      // raw before/after text preserved exactly
      expect(decoded[0].before).toBe(rows[0].before);
      // min record id is embedded in the key
      for (const entry of entries) {
        const parsed = parsePartKey(ROOT, entry.key)!;
        expect(parsed.minRecordId).toBe(entry.minRecordId);
      }
    });
  });

  describe('record bloom', () => {
    it('never yields false negatives and prunes most foreign ids', () => {
      const ids = [
        'recZNamfOGgQuUXi2ez',
        ...Array.from({ length: 60 }, (_, i) => `rec${i.toString(36).padStart(16, 'x')}`),
      ];
      const bloom = buildRecordBloom(ids, ids.length);
      for (const id of ids) {
        expect(bloomMightContain(bloom, id)).toBe(true);
      }
      const foreign = Array.from({ length: 300 }, (_, i) => `recForeign${i}`);
      const falsePositives = foreign.filter((id) => bloomMightContain(bloom, id)).length;
      expect(falsePositives).toBeLessThan(15); // ~1% target, generous bound
    });
  });

  describe('part byte cache accounting', () => {
    it('re-caching the same key under concurrent misses does not leak phantom bytes', () => {
      const internals = storage as unknown as {
        cachePart: (cacheKey: string, buffer: Buffer) => void;
        partCacheBytes: number;
        partCache: Map<string, Buffer>;
      };
      const buf = Buffer.alloc(1024, 1);
      internals.cachePart('k@etag1', buf);
      internals.cachePart('k@etag1', Buffer.alloc(1024, 2));
      expect(internals.partCacheBytes).toBe(1024);
      expect(internals.partCache.size).toBe(1);
    });
  });

  describe('cursor codec', () => {
    it('round-trips and rejects legacy cursors', () => {
      const cursor = encodeColdCursor(new Date('2026-05-10T10:00:00.000Z'), 'rh1');
      expect(decodeColdCursor(cursor)).toEqual({ t: '2026-05-10T10:00:00.000Z', id: 'rh1' });
      expect(decodeColdCursor('rhlegacycuidcursor')).toBeUndefined();
    });
  });

  describe('merged read', () => {
    const tableId = 'tblR';

    const makeBufferRow = (
      id: string,
      createdTime: string,
      extra: Partial<IColdHistoryRow> = {}
    ) => {
      const row = makeRow({ id, createdTime, ...extra });
      return {
        id: row.id,
        recordId: row.recordId,
        fieldId: row.fieldId,
        before: row.before,
        after: row.after,
        createdTime: new Date(row.createdTime),
        createdBy: row.createdBy,
      };
    };

    const createService = (buffer: ReturnType<typeof makeBufferRow>[]) => {
      const sorted = [...buffer].sort((a, b) =>
        compareRowByTimeDesc(
          { createdTime: a.createdTime.toISOString(), id: a.id },
          { createdTime: b.createdTime.toISOString(), id: b.id }
        )
      );
      // mini interpreter for the service's raw buffer query; JS ordinal string
      // compares match the COLLATE "C" semantics the SQL requests
      const queryRawUnsafe = async (sql: string, ...params: unknown[]) => {
        let i = 1; // $1 is always tableId
        const recordId = sql.includes('"record_id" = $') ? (params[i++] as string) : undefined;
        const gte = sql.includes('"created_time" >= $') ? (params[i++] as Date) : undefined;
        const lte = sql.includes('"created_time" <= $') ? (params[i++] as Date) : undefined;
        const fieldIds = sql.includes('"field_id" = ANY') ? (params[i++] as string[]) : undefined;
        const createdBys = sql.includes('"created_by" = ANY')
          ? (params[i++] as string[])
          : undefined;
        let boundary: { t: Date; id: string; inclusive: boolean } | undefined;
        if (sql.includes('OR ("created_time" =')) {
          boundary = {
            t: params[i++] as Date,
            id: params[i++] as string,
            inclusive: sql.includes('COLLATE "C" <= $'),
          };
        }
        const limit = Number(/LIMIT (\d+)/.exec(sql)![1]);
        return sorted
          .filter((r) => {
            if (recordId && r.recordId !== recordId) return false;
            if (gte && r.createdTime < gte) return false;
            if (lte && r.createdTime > lte) return false;
            if (fieldIds && !fieldIds.includes(r.fieldId)) return false;
            if (createdBys && !createdBys.includes(r.createdBy)) return false;
            if (boundary) {
              if (r.createdTime > boundary.t) return false;
              if (
                r.createdTime.getTime() === boundary.t.getTime() &&
                (boundary.inclusive ? r.id > boundary.id : r.id >= boundary.id)
              ) {
                return false;
              }
            }
            return true;
          })
          .slice(0, limit);
      };
      const dataPrisma = {
        recordHistory: {
          findUnique: async ({ where }: any) => sorted.find((row) => row.id === where.id) ?? null,
        },
        $queryRawUnsafe: queryRawUnsafe,
      };
      const dataDbClientManager = {
        dataPrismaForTable: async () => dataPrisma,
      };
      return new RecordHistoryColdReadService(dataDbClientManager as never, storage);
    };

    it('merges buffer and cold rows, dedups overlap, and paginates across the seam', async () => {
      // cold rows: 30 rows across two months
      const coldRows = Array.from({ length: 30 }, (_, i) =>
        makeRow({
          id: `rhcold${String(i).padStart(3, '0')}`,
          recordId: `rec${String(i % 3).padStart(2, '0')}`,
          createdTime: `2026-0${i % 2 === 0 ? '4' : '5'}-1${i % 9}T0${i % 9}:00:00.000Z`,
        })
      );
      const april = coldRows.filter((r) => r.createdTime.startsWith('2026-04'));
      const may = coldRows.filter((r) => r.createdTime.startsWith('2026-05'));
      await seedParts(storage, tableId, { yyyymm: '202604', kind: 'month' }, april);
      await seedParts(storage, tableId, { yyyymm: '202605', kind: 'day', dd: '15' }, may);

      // buffer: 5 newer rows + the WHOLE May set as overlap copies — matching
      // the production invariant (created_time is stamped at insert, so the
      // buffer is always a superset of everything newer than the delete
      // cutoff; upload-but-not-yet-deleted rows exist in both stores)
      const buffer = [
        ...Array.from({ length: 5 }, (_, i) =>
          makeBufferRow(`rhbuf${i}`, `2026-06-0${i + 1}T12:00:00.000Z`)
        ),
        ...may.map((row) => makeBufferRow(row.id, row.createdTime, { recordId: row.recordId })),
      ];

      const service = createService(buffer);
      const seen: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await service.collectHistoryRows({
          tableId,
          shouldFilterByField: false,
          cursor,
          limit: 7,
        });
        seen.push(...page.rows.map((row) => row.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      // 5 buffer + 30 cold, overlap deduped
      expect(seen).toHaveLength(35);
      expect(new Set(seen).size).toBe(35);
      // strictly descending (createdTime, id)
      const timeline = seen.map((id) => id); // ids unique; verify by re-reading first page order
      expect(timeline.slice(0, 5)).toEqual(['rhbuf4', 'rhbuf3', 'rhbuf2', 'rhbuf1', 'rhbuf0']);
    });

    it('serves record-level queries via minRecordId pruning and field filters', async () => {
      const rows = [
        makeRow({
          id: 'rh1',
          recordId: 'recA',
          fieldId: 'fldX',
          createdTime: '2026-05-10T10:00:00.000Z',
        }),
        makeRow({
          id: 'rh2',
          recordId: 'recB',
          fieldId: 'fldY',
          createdTime: '2026-05-11T10:00:00.000Z',
        }),
        makeRow({
          id: 'rh3',
          recordId: 'recC',
          fieldId: 'fldX',
          createdTime: '2026-05-12T10:00:00.000Z',
        }),
      ];
      const entries = await seedParts(storage, tableId, { yyyymm: '202605', kind: 'month' }, rows);
      await storage.writeStats(tableId, {
        version: 1,
        tableId,
        parts: Object.fromEntries(entries.map((entry) => [entry.key, entry])),
      });
      const service = createService([]);

      const byRecord = await service.collectHistoryRows({
        tableId,
        recordId: 'recB',
        shouldFilterByField: false,
        limit: 20,
      });
      expect(byRecord.rows.map((r) => r.id)).toEqual(['rh2']);

      const byField = await service.collectHistoryRows({
        tableId,
        shouldFilterByField: true,
        allowedFieldIds: ['fldX'],
        limit: 20,
      });
      expect(byField.rows.map((r) => r.id)).toEqual(['rh3', 'rh1']);

      const emptyProjection = await service.collectHistoryRows({
        tableId,
        shouldFilterByField: true,
        allowedFieldIds: [],
        limit: 20,
      });
      expect(emptyProjection.rows).toHaveLength(0);
    });

    it('honors legacy prisma cursors inclusively when the row is still buffered', async () => {
      const buffer = [
        makeBufferRow('rhz3', '2026-06-03T12:00:00.000Z'),
        makeBufferRow('rhz2', '2026-06-02T12:00:00.000Z'),
        makeBufferRow('rhz1', '2026-06-01T12:00:00.000Z'),
      ];
      const service = createService(buffer);
      const page = await service.collectHistoryRows({
        tableId,
        shouldFilterByField: false,
        cursor: 'rhz2', // legacy cursor: next page starts AT rhz2
        limit: 20,
      });
      expect(page.rows.map((r) => r.id)).toEqual(['rhz2', 'rhz1']);
    });

    it('reads every part of a record whose history spills across part cuts', async () => {
      // a heavily edited record exceeds the part size budget: the writer cuts
      // mid-record, so several consecutive parts share minRecordId=recB
      const fat = JSON.stringify({ data: 'x'.repeat(300) });
      const rows = [
        makeRow({ id: 'rha1', recordId: 'recA', createdTime: '2026-05-09T00:00:00.000Z' }),
        ...Array.from({ length: 12 }, (_, i) =>
          makeRow({
            id: `rhb${String(i).padStart(2, '0')}`,
            recordId: 'recB',
            after: fat,
            createdTime: `2026-05-10T${String(i).padStart(2, '0')}:00:00.000Z`,
          })
        ),
        makeRow({ id: 'rhc1', recordId: 'recC', createdTime: '2026-05-11T00:00:00.000Z' }),
      ];
      const entries = await seedParts(
        storage,
        tableId,
        { yyyymm: '202605', kind: 'month' },
        rows,
        1000 // ~2-3 fat rows per part → recB spans several parts
      );
      expect(entries.length).toBeGreaterThan(2);
      expect(entries.filter((e) => e.minRecordId === 'recB').length).toBeGreaterThan(1);
      await storage.writeStats(tableId, {
        version: 1,
        tableId,
        parts: Object.fromEntries(entries.map((entry) => [entry.key, entry])),
      });
      const service = createService([]);

      const byRecord = await service.collectHistoryRows({
        tableId,
        recordId: 'recB',
        shouldFilterByField: false,
        limit: 50,
      });
      expect(byRecord.rows.map((r) => r.id)).toEqual(
        Array.from({ length: 12 }, (_, i) => `rhb${String(11 - i).padStart(2, '0')}`)
      );
    });

    it('fails loudly instead of serving an empty page when the S3 budget expires', async () => {
      const rows = [makeRow({ id: 'rht1', recordId: 'recA' })];
      await seedParts(storage, tableId, { yyyymm: '202605', kind: 'month' }, rows);
      process.env.BACKEND_RECORD_HISTORY_COLD_S3_READ_TIMEOUT_MS = '1';
      const slowStorage = new Proxy(storage, {
        get(target, prop, receiver) {
          if (prop === 'listMonthParts') {
            return async (...args: [string, string]) => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              return target.listMonthParts(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const dataDbClientManager = {
        dataPrismaForTable: async () => ({
          recordHistory: { findUnique: async () => null },
          $queryRawUnsafe: async () => [],
        }),
      };
      const service = new RecordHistoryColdReadService(
        dataDbClientManager as never,
        slowStorage as never
      );
      await expect(
        service.collectHistoryRows({ tableId, shouldFilterByField: false, limit: 20 })
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('oversized value truncation', () => {
    it('replaces a value over the cap with a marker and leaves normal ones alone', () => {
      expect(truncateColdValue('"small"', 256)).toBe('"small"');
      const big = 'x'.repeat(300);
      const marked = truncateColdValue(JSON.stringify(big), 256);
      const parsed = JSON.parse(marked);
      expect(parsed.coldTruncated).toBe(true);
      expect(parsed.units).toBe(JSON.stringify(big).length);
      // keeps a non-nullish `data` so getRecordHistory renders it, not a blank
      expect(typeof parsed.data).toBe('string');
      expect(parsed.data.length).toBeGreaterThan(0);
    });

    it('truncateColdRow returns the same ref when nothing is oversized', () => {
      const row = makeRow({ id: 'rhsmall' });
      expect(truncateColdRow(row, 256 * 1024)).toBe(row);
    });

    it('a cap of 0 disables truncation', () => {
      const row = makeRow({ id: 'rhbig', after: 'y'.repeat(5_000_000) });
      expect(truncateColdRow(row, 0)).toBe(row);
    });

    it('feeder truncates an oversized value folded back from an existing part', async () => {
      const tableId = 'tblTrunc';
      const bucket = { yyyymm: '202607', kind: 'day' as const, dd: '07' };
      // an existing cold part written before the cap, holding one 2MB value
      const legacy = makeRow({
        id: 'rhlegacy',
        recordId: 'recA',
        before: JSON.stringify('z'.repeat(2 * 1024 * 1024)),
        createdTime: '2026-07-07T01:00:00.000Z',
      });
      await seedParts(storage, tableId, bucket, [legacy]);
      const existing = (await storage.listMonthParts(tableId, '202607')).filter(
        (p) => p.kind === 'day' && p.dd === '07'
      );
      const writer = new PartWriter({
        store: storage.partStore,
        rootDir: storage.rootDir,
        tableId,
        bucket,
        partUncompressedBytes: 1024 * 1024,
      });
      const feeder = new BucketMergeFeeder(writer, existing, storage, undefined, 16, 256 * 1024);
      await feeder.push(
        makeRow({ id: 'rhnew', recordId: 'recB', createdTime: '2026-07-07T02:00:00.000Z' })
      );
      const entries = await feeder.finish();
      const decoded: IColdHistoryRow[] = [];
      for (const entry of entries) {
        for await (const item of storage.iterateRows(entry.key)) {
          if (item.row) decoded.push(item.row);
        }
      }
      const healed = decoded.find((r) => r.id === 'rhlegacy')!;
      const healedBefore = JSON.parse(healed.before);
      expect(healedBefore.coldTruncated).toBe(true);
      expect(healedBefore.units).toBe(legacy.before.length);
      expect(typeof healedBefore.data).toBe('string');
      // the normal row is untouched and both survive the rewrite
      expect(decoded.map((r) => r.id).sort()).toEqual(['rhlegacy', 'rhnew']);
    });
  });

  describe('bucket merge feeder', () => {
    it('re-flushing a bucket merges its existing parts instead of clobbering them', async () => {
      const tableId = 'tblF';
      const bucket = { yyyymm: '202607', kind: 'day' as const, dd: '07' };
      const firstBatch = Array.from({ length: 5 }, (_, i) =>
        makeRow({
          id: `rhfeed0${i}`,
          recordId: 'recA',
          createdTime: `2026-07-07T0${i}:00:00.000Z`,
        })
      );
      const existingEntries = await seedParts(storage, tableId, bucket, firstBatch);

      // second run: only 2 new rows remain in the buffer (first 5 already
      // deleted); one of them duplicates an existing row (overlap window)
      const writer = new PartWriter({
        store: storage.partStore,
        rootDir: storage.rootDir,
        tableId,
        bucket,
        partUncompressedBytes: 1024 * 1024,
      });
      const existing = (await storage.listMonthParts(tableId, '202607')).filter(
        (part) => part.kind === 'day' && part.dd === '07'
      );
      expect(existing.map((p) => p.key)).toEqual(existingEntries.map((e) => e.key));
      const feeder = new BucketMergeFeeder(writer, existing, storage);
      await feeder.push(
        makeRow({ id: 'rhfeed04', recordId: 'recA', createdTime: '2026-07-07T04:00:00.000Z' })
      ); // dup
      await feeder.push(
        makeRow({ id: 'rhfeed05', recordId: 'recA', createdTime: '2026-07-07T05:00:00.000Z' })
      );
      await feeder.push(
        makeRow({ id: 'rhfeed06', recordId: 'recB', createdTime: '2026-07-07T06:00:00.000Z' })
      );
      const entries = await feeder.finish();
      expect(feeder.mergedExistingRows).toBe(5);

      const decoded: IColdHistoryRow[] = [];
      for (const entry of entries) {
        for await (const item of storage.iterateRows(entry.key)) {
          if (item.row) decoded.push(item.row);
        }
      }
      expect(decoded.map((r) => r.id).sort()).toEqual([
        'rhfeed00',
        'rhfeed01',
        'rhfeed02',
        'rhfeed03',
        'rhfeed04',
        'rhfeed05',
        'rhfeed06',
      ]);
    });
  });

  describe('external row sorter', () => {
    it('drains sorted and deduped across gzip-spilled runs', async () => {
      const sorter = new ExternalRowSorter(3); // tiny run size => several spill files
      const rows = [
        makeRow({ id: 'rh05', recordId: 'recC' }),
        makeRow({ id: 'rh01', recordId: 'recA' }),
        makeRow({ id: 'rh04', recordId: 'recB', createdTime: '2026-05-11T00:00:00.000Z' }),
        makeRow({ id: 'rh02', recordId: 'recA', createdTime: '2026-05-11T00:00:00.000Z' }),
        makeRow({ id: 'rh03', recordId: 'recB' }),
        makeRow({ id: 'rh03', recordId: 'recB' }), // duplicate id straddling runs
        makeRow({ id: 'rh00', recordId: 'recA' }),
      ];
      for (const row of rows) {
        await sorter.add(row);
      }
      const out: IColdHistoryRow[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row);
      });
      expect(out.map((r) => r.id)).toEqual(['rh00', 'rh01', 'rh02', 'rh03', 'rh04', 'rh05']);
      // round-tripped rows survive the gzip spill byte-for-byte
      expect(out[0]).toEqual(rows[6]);
    });

    it('a shared budget evicts the largest run while smaller ones stay in memory', async () => {
      const budget = new SortMemoryBudget(2700);
      const fat = new ExternalRowSorter(undefined, budget);
      const thin = new ExternalRowSorter(undefined, budget);
      await fat.add(makeRow({ id: 'rhfat', recordId: 'recB', after: 'x'.repeat(2500) }));
      expect(fat.pendingBytes).toBeGreaterThan(0); // fits alone
      await thin.add(makeRow({ id: 'rhthin', recordId: 'recA' }));
      // the joint total went over budget: the LARGEST run spilled, not the adder
      expect(fat.pendingBytes).toBe(0);
      expect(thin.pendingBytes).toBeGreaterThan(0);
      expect(budget.usedBytes).toBe(thin.pendingBytes);

      const fatOut: string[] = [];
      await fat.drainTo(async (row) => {
        fatOut.push(row.id);
      });
      const thinOut: string[] = [];
      await thin.drainTo(async (row) => {
        thinOut.push(row.id);
      });
      expect(fatOut).toEqual(['rhfat']);
      expect(thinOut).toEqual(['rhthin']);
      expect(budget.usedBytes).toBe(0); // drains released every charge
    });

    it('a row added while a spill is in flight opens the next run', async () => {
      const sorter = new ExternalRowSorter();
      await sorter.add(makeRow({ id: 'rh10', recordId: 'recB' }));
      const spilling = sorter.spill(); // deliberately not awaited: swap is synchronous
      await sorter.add(makeRow({ id: 'rh09', recordId: 'recA' }));
      await spilling;
      expect(sorter.pendingBytes).toBeGreaterThan(0); // rh09 sits in the NEW run
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual(['rh09', 'rh10']); // both present exactly once, byte order
    });

    it('cleanup releases the budget charge', async () => {
      const budget = new SortMemoryBudget(1024 * 1024);
      const sorter = new ExternalRowSorter(undefined, budget);
      await sorter.add(makeRow({ id: 'rh20' }));
      expect(budget.usedBytes).toBeGreaterThan(0);
      await sorter.cleanup();
      expect(budget.usedBytes).toBe(0);
    });

    it('drainTo waits for an un-awaited (budget-evicted) spill before choosing its path', async () => {
      // reproduces the cross-table race: an eviction spilled this sorter but
      // the write has not landed in runFiles yet when the owner starts to
      // drain. Without settling the in-flight spill first, drainTo would take
      // the in-memory path over an already-emptied run and silently drop the
      // spilled rows.
      const sorter = new ExternalRowSorter();
      await sorter.add(makeRow({ id: 'rh01', recordId: 'recA' }));
      await sorter.add(makeRow({ id: 'rh02', recordId: 'recB' }));
      const spilling = sorter.spill(); // NOT awaited: mimics budget.enforce mid-flight
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      await spilling;
      expect(out.sort()).toEqual(['rh01', 'rh02']); // neither spilled row lost
    });

    // a field whose JSON.stringify throws (stands in for a /tmp-full or gzip
    // failure mid-spill) while keeping a real numeric .length so the byte
    // budget accounting is unaffected
    const poisonField = () =>
      ({
        length: 4,
        toJSON() {
          throw new Error('spill boom');
        },
      }) as unknown as string;

    it('a spill write failure poisons the sorter so the owner errors instead of losing rows', async () => {
      const sorter = new ExternalRowSorter(2); // spill on the 2nd add
      await sorter.add(makeRow({ id: 'rh01', recordId: 'recA' }));
      await expect(
        sorter.add(makeRow({ id: 'rh02', recordId: 'recB', before: poisonField() }))
      ).rejects.toThrow();
      // poisoned: every later use rethrows, never silently emits a partial set
      await expect(sorter.add(makeRow({ id: 'rh03', recordId: 'recC' }))).rejects.toThrow();
      await expect(sorter.drainTo(async () => undefined)).rejects.toThrow();
    });

    it('a failed cross-table eviction does not throw into the table that triggered enforce', async () => {
      const budget = new SortMemoryBudget(2000);
      const victim = new ExternalRowSorter(undefined, budget);
      // victim holds the largest run AND a poison row, but stays under budget
      // so it does not self-spill on add
      await victim.add(makeRow({ id: 'rhbig', recordId: 'recA', after: 'q'.repeat(900) }));
      await victim.add(makeRow({ id: 'rhbad', recordId: 'recB', before: poisonField() }));
      expect(victim.pendingBytes).toBeGreaterThan(0);

      // trigger tips the shared total over budget → enforce picks victim as
      // largest → victim's spill fails — but the failure belongs to victim,
      // not to trigger, whose add must still resolve
      const trigger = new ExternalRowSorter(undefined, budget);
      await expect(
        trigger.add(makeRow({ id: 'rhtrig', recordId: 'recA', after: 'w'.repeat(900) }))
      ).resolves.toBeUndefined();
      // victim carries the error; it will fail its own flush loudly
      await expect(victim.drainTo(async () => undefined)).rejects.toThrow();
      await trigger.cleanup();
    });

    it('read batch limit re-targets the byte goal from observed row weight', () => {
      // thin rows: the configured cap wins
      expect(nextReadBatchLimit(500 * 500, 500, 5000)).toBe(5000);
      // ~1MB rows: 8MB target / 1MB = 8 rows a batch, so gigantic rows never
      // materialize a gigabyte-sized batch
      expect(nextReadBatchLimit(500 * 1024 * 1024, 500, 5000)).toBe(8);
      // a 15MB row: floor of 1 lets it be read one at a time
      expect(nextReadBatchLimit(15 * 1024 * 1024, 1, 5000)).toBe(1);
      // 4KB rows: lands at 8MB target / 4KB = 2048
      expect(nextReadBatchLimit(500 * 4096, 500, 5000)).toBe(2048);
      // a cap set below the target still wins as the hard ceiling
      expect(nextReadBatchLimit(500 * 500, 500, 50)).toBe(50);
    });

    it('reads record_history via the native pg (knex) client, truncating over-cap values in SQL', async () => {
      let capturedSql = '';
      let capturedBindings: unknown[] = [];
      const returnedRow = {
        id: 'rh1',
        recordId: 'rec1',
        fieldId: 'fld1',
        before: 'kept',
        after:
          '{"data":"[value too large, cold-truncated (5 chars)]","coldTruncated":true,"units":5}',
        beforeTruncated: false,
        afterTruncated: true,
        createdTime: '2026-01-01T00:00:00.000Z',
        createdBy: 'u1',
      };
      const fakeKnex = {
        raw: async (sql: string, bindings: unknown[]) => {
          capturedSql = sql;
          capturedBindings = bindings;
          return { rows: [returnedRow] };
        },
      };
      const dataKnexForTable = async () => fakeKnex;
      const flusher = new RecordHistoryFlusherService(
        ...([null, null, null, { dataKnexForTable }, null] as unknown as ConstructorParameters<
          typeof RecordHistoryFlusherService
        >)
      );
      const rows = await (
        flusher as unknown as {
          readBatch: (
            tableId: string,
            qualified: string,
            cutoff: Date,
            limit: number,
            maxValueUnits: number,
            after?: { recordId: string; createdTime: Date; id: string }
          ) => Promise<Array<{ before: string; afterTruncated: boolean; createdTime: Date }>>;
        }
      ).readBatch(
        'tblX',
        '"public"."record_history"',
        new Date('2026-06-01T00:00:00Z'),
        500,
        1024 * 1024,
        { recordId: 'rec0', createdTime: new Date('2026-05-01T00:00:00Z'), id: 'rh0' }
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toBe('kept');
      expect(rows[0].afterTruncated).toBe(true);
      // truncation stays in SQL; the read runs on the native pg client with ? binds
      expect(capturedSql).toContain('cold-truncated');
      expect(capturedSql).toContain('char_length');
      expect(capturedSql).not.toContain('$1');
      // binds are emitted in SQL order: tableId, cutoff, then the keyset triple
      expect(capturedBindings[0]).toBe('tblX');
      expect(capturedBindings).toHaveLength(5);
      // timestamps read + bound as UTC, independent of the process TZ
      expect(capturedSql).toContain('to_char');
      expect(capturedSql).toContain('::timestamp');
      expect(capturedBindings[1]).toBe('2026-06-01T00:00:00.000');
      expect(rows[0].createdTime.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('multi-pass merge stays correct when runs exceed the fan-in', async () => {
      // fan-in 2 with a tiny run size forces several spilled runs and >1 pass
      const sorter = new ExternalRowSorter(2, undefined, 2);
      const ids = ['rh07', 'rh02', 'rh05', 'rh00', 'rh09', 'rh03', 'rh06', 'rh01', 'rh08', 'rh04'];
      for (const id of ids) {
        await sorter.add(makeRow({ id, recordId: `rec${id.slice(2)}` }));
      }
      // a duplicate id in a separate run must dedup across passes
      await sorter.add(makeRow({ id: 'rh04', recordId: 'rec04' }));
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual([
        'rh00',
        'rh01',
        'rh02',
        'rh03',
        'rh04',
        'rh05',
        'rh06',
        'rh07',
        'rh08',
        'rh09',
      ]);
    });

    it('a fan-in of 1 is clamped so the multi-pass merge still converges', async () => {
      // env allows FAN_IN=1; without the floor the pass groups 1->1 forever
      const sorter = new ExternalRowSorter(2, undefined, 1);
      const ids = ['rh03', 'rh01', 'rh04', 'rh00', 'rh02'];
      for (const id of ids) {
        await sorter.add(makeRow({ id, recordId: `rec${id.slice(2)}` }));
      }
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual(['rh00', 'rh01', 'rh02', 'rh03', 'rh04']);
    });

    it('the NDJSON reader splits a multi-MB line without readline', async () => {
      // one ~2MB "row" plus small neighbours, delivered in small chunks: the
      // readline path would rope-flatten + regex this repeatedly (the OOM);
      // the buffer splitter must return each line intact
      const big = 'x'.repeat(2 * 1024 * 1024);
      const lines = [
        JSON.stringify({ id: 'a', v: 1 }),
        JSON.stringify({ id: 'b', v: big }),
        JSON.stringify({ id: 'c', v: 3 }),
      ];
      const payload = Buffer.from(lines.join('\n') + '\n', 'utf8');
      const stream = Readable.from(
        (function* () {
          for (let i = 0; i < payload.length; i += 64 * 1024) {
            yield payload.subarray(i, i + 64 * 1024);
          }
        })()
      );
      const decoded: { id: string; v: unknown }[] = [];
      for await (const line of iterateNdjsonLines(stream)) {
        decoded.push(JSON.parse(line));
      }
      expect(decoded.map((r) => r.id)).toEqual(['a', 'b', 'c']);
      expect((decoded[1].v as string).length).toBe(big.length);
    });
  });

  describe('orphan buffer cleanup', () => {
    const makeFlusher = (opts: {
      bufferedTables: string[];
      liveTables: { id: string; binding?: { mode: string; state: string } | null }[];
      bindings?: unknown[];
      deleteCount?: number;
      deleteThrows?: boolean;
    }) => {
      const executed: { sql: string; params: unknown[] }[] = [];
      const prismaService = {
        tableMeta: {
          findMany: async ({ where }: any) => {
            const ids: string[] = where.id.in;
            return opts.liveTables
              .filter((table) => ids.includes(table.id))
              .map((table) => ({
                id: table.id,
                base: { space: { dataDbBinding: table.binding ?? null } },
              }));
          },
        },
        spaceDataDbBinding: { findMany: async () => opts.bindings ?? [] },
      };
      const metaFallbackDataPrismaService = {
        $queryRawUnsafe: async () => opts.bufferedTables.map((tableId) => ({ tableId })),
        $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
          executed.push({ sql, params });
          if (opts.deleteThrows) throw new Error('lock timeout');
          return opts.deleteCount ?? 0;
        },
      };
      const service = new RecordHistoryFlusherService(
        prismaService as any,
        metaFallbackDataPrismaService as any,
        {} as any,
        {} as any,
        {} as any
      );
      return { service, executed };
    };

    it('sweeps orphan rows (no table_meta), sparing live and byodb-routed tables', async () => {
      const { service, executed } = makeFlusher({
        bufferedTables: ['tblLive', 'tblOrphan', 'tblByodb'],
        liveTables: [
          { id: 'tblLive', binding: null },
          { id: 'tblByodb', binding: { mode: 'byodb', state: 'ready' } },
        ],
        deleteCount: 12451,
      });
      const cutoff = new Date('2026-07-08T00:00:00.000Z');
      const orphanCleanup = { enabled: true, deletedRows: 0 };

      const groups = await (service as any).discoverGroups(
        { mode: 'incremental' },
        cutoff,
        orphanCleanup
      );

      // only the live shared table is flushed; the byodb-routed one is served
      // elsewhere and the orphan appears in no group
      expect(groups).toEqual([{ kind: 'shared', tableIds: ['tblLive'] }]);
      // exactly one delete, scoped to the orphan id and bounded by the cutoff
      expect(executed).toHaveLength(1);
      expect(executed[0].sql).toContain('DELETE FROM "record_history"');
      expect(executed[0].params[0]).toEqual(['tblOrphan']);
      expect(executed[0].params[1]).toBe(cutoff);
      expect(orphanCleanup.deletedRows).toBe(12451);
    });

    it('never deletes when the cleanup gate is off (read-only environment)', async () => {
      const { service, executed } = makeFlusher({
        bufferedTables: ['tblOrphan'],
        liveTables: [],
      });
      const orphanCleanup = { enabled: false, deletedRows: 0 };

      await (service as any).discoverGroups({ mode: 'incremental' }, new Date(), orphanCleanup);

      expect(executed).toHaveLength(0);
      expect(orphanCleanup.deletedRows).toBe(0);
    });

    it('isolates a failed orphan delete so live-table flushing still proceeds', async () => {
      const { service, executed } = makeFlusher({
        bufferedTables: ['tblLive', 'tblOrphan'],
        liveTables: [{ id: 'tblLive', binding: null }],
        deleteThrows: true,
      });
      const orphanCleanup = { enabled: true, deletedRows: 0 };

      // a locked/timed-out orphan delete must not abort discovery
      const groups = await (service as any).discoverGroups(
        { mode: 'incremental' },
        new Date('2026-07-08T00:00:00.000Z'),
        orphanCleanup
      );

      expect(executed).toHaveLength(1);
      expect(groups).toEqual([{ kind: 'shared', tableIds: ['tblLive'] }]);
      expect(orphanCleanup.deletedRows).toBe(0);
    });
  });

  describe('compactor', () => {
    it('force-repairs month parts written under a mismatched collation order', async () => {
      const tableId = 'tblRepair';
      // mixed-case record ids ordered like the db collation (case-insensitive-ish),
      // i.e. NOT byte order — plus the same rows duplicated across two parts,
      // exactly the state a collation-ordered merge leaves behind
      const rows = [
        makeRow({ id: 'rhx1', recordId: 'recAaa', createdTime: '2026-05-01T01:00:00.000Z' }),
        makeRow({ id: 'rhx2', recordId: 'recaBB', createdTime: '2026-05-01T02:00:00.000Z' }),
        makeRow({ id: 'rhx3', recordId: 'recACC', createdTime: '2026-05-01T03:00:00.000Z' }),
      ];
      const writeLegacyPart = async (seq: number) => {
        const writer = new PartWriter({
          store: storage.partStore,
          rootDir: storage.rootDir,
          tableId,
          bucket: { yyyymm: '202605', kind: 'month' },
          partUncompressedBytes: 1024 * 1024,
          startSeq: seq,
        });
        for (const row of rows) await writer.add(row); // collation order, not byte order
        return writer.finish();
      };
      await writeLegacyPart(0);
      await writeLegacyPart(1); // full duplicate set in a second part

      const compactor = new RecordHistoryCompactorService(storage);
      const skipped = await compactor.compactMonth(tableId, '202605');
      expect(skipped.skippedReason).toBe('no-day-parts');

      const repaired = await compactor.compactMonth(tableId, '202605', { force: true });
      expect(repaired.rows).toBe(3);

      const remaining = await storage.listMonthParts(tableId, '202605');
      const decoded: IColdHistoryRow[] = [];
      for (const part of remaining) {
        for await (const item of storage.iterateRows(part.key)) {
          if (item.row) decoded.push(item.row);
        }
      }
      // byte order of record ids: recACC < recAaa < recaBB ('C'=67 < 'a'=97)
      expect(decoded.map((r) => r.id)).toEqual(['rhx3', 'rhx1', 'rhx2']);
      expect(new Set(decoded.map((r) => r.id)).size).toBe(3);
    });

    it('merges day parts into month parts, dedups, heals and rewrites stats', async () => {
      const tableId = 'tblC';
      const day1 = Array.from({ length: 10 }, (_, i) =>
        makeRow({
          id: `rhd1${String(i).padStart(2, '0')}`,
          recordId: `rec${String(i % 4).padStart(2, '0')}`,
          createdTime: `2026-05-01T0${i % 9}:00:00.000Z`,
        })
      );
      const day2 = Array.from({ length: 10 }, (_, i) =>
        makeRow({
          id: `rhd2${String(i).padStart(2, '0')}`,
          recordId: `rec${String(i % 5).padStart(2, '0')}`,
          createdTime: `2026-05-02T0${i % 9}:00:00.000Z`,
        })
      );
      await seedParts(storage, tableId, { yyyymm: '202605', kind: 'day', dd: '01' }, day1);
      await seedParts(storage, tableId, { yyyymm: '202605', kind: 'day', dd: '02' }, day2);
      await storage.writeStats(tableId, { version: 1, tableId, parts: {} });

      const compactor = new RecordHistoryCompactorService(storage);
      const result = await compactor.compactMonth(tableId, '202605');
      expect(result.rows).toBe(20);
      expect(result.outputParts).toBeGreaterThan(0);

      const remaining = await storage.listMonthParts(tableId, '202605');
      expect(remaining.every((part) => part.kind === 'month')).toBe(true);

      const decoded: IColdHistoryRow[] = [];
      for (const part of remaining) {
        for await (const item of storage.iterateRows(part.key)) {
          if (item.row) decoded.push(item.row);
        }
      }
      expect(decoded).toHaveLength(20);
      expect(new Set(decoded.map((r) => r.id)).size).toBe(20);

      const stats = await storage.readStats(tableId);
      expect(Object.keys(stats!.parts)).toHaveLength(remaining.length);

      // idempotent re-run: no day parts left → no-op
      const rerun = await compactor.compactMonth(tableId, '202605');
      expect(rerun.skippedReason).toBe('no-day-parts');
    });
  });

  describe('cold maintenance processor', () => {
    class FakeColdQueue {
      jobs: {
        id?: string;
        name: string;
        data: unknown;
        state: string;
        opts?: unknown;
        timestamp?: number;
        finishedOn?: number;
      }[] = [];
      schedulers: { key: string }[] = [];

      async getJobSchedulers() {
        return this.schedulers;
      }

      async upsertJobScheduler(key: string) {
        if (!this.schedulers.some((scheduler) => scheduler.key === key)) {
          this.schedulers.push({ key });
        }
      }

      async getJobs(states: string[]) {
        return this.jobs.filter((job) => states.includes(job.state));
      }

      async add(name: string, data: unknown, opts?: { jobId?: string }) {
        // mirrors BullMQ's custom-id validation — the exact rule the first
        // production catch-up chain tripped over
        if (opts?.jobId?.includes(':')) {
          throw new Error('Custom Id cannot contain :');
        }
        // mirrors BullMQ's dedupe: a custom id matching ANY still-stored job
        // (completed and failed ones included) returns the EXISTING job
        const existing = opts?.jobId && this.jobs.find((job) => job.id === opts.jobId);
        if (existing) {
          return existing;
        }
        const job = {
          id: opts?.jobId,
          name,
          data,
          state: 'delayed',
          opts,
          timestamp: Date.now(),
        };
        this.jobs.push(job);
        return job;
      }

      async remove(jobId: string) {
        const before = this.jobs.length;
        this.jobs = this.jobs.filter((job) => job.id !== jobId);
        return before - this.jobs.length;
      }

      async getJob(jobId: string) {
        return this.jobs.find((job) => job.id === jobId);
      }
    }

    const makeProcessor = (
      queue: FakeColdQueue,
      flushResult: Partial<IColdFlushRunResult> = {}
    ) => {
      const flusher = {
        runFlush: async (): Promise<IColdFlushRunResult> => ({
          startedAt: '2026-07-08T00:00:00.000Z',
          cutoff: '2026-07-07T00:00:00.000Z',
          mode: 'incremental',
          tables: [],
          totalRows: 0,
          totalParts: 0,
          totalCompressedBytes: 0,
          totalTruncatedValues: 0,
          orphanRowsDeleted: 0,
          durationMs: 1,
          leftoverTables: 0,
          budgetExhausted: false,
          ...flushResult,
        }),
      };
      return new RecordHistoryColdProcessor(
        flusher as never,
        {} as never,
        {} as never,
        queue as never
      );
    };

    beforeEach(() => {
      delete process.env.BACKEND_RECORD_HISTORY_COLD_DISABLED;
    });

    it('chains a catch-up job with a colon-free id when the budget is exhausted', async () => {
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue, { budgetExhausted: true, leftoverTables: 3 });

      await processor.process({ name: 'record-history-cold:flush', data: {} } as any);

      const chained = queue.jobs.filter((job) =>
        job.id?.startsWith('record-history-cold-flush-catchup')
      );
      expect(chained).toHaveLength(1);
      expect(chained[0].id).toBe('record-history-cold-flush-catchup-1');
      expect(chained[0].data).toEqual({ catchupHop: 1 });
    });

    it('increments the hop id along the chain', async () => {
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue, { budgetExhausted: true });

      await processor.process({
        id: 'record-history-cold-flush-catchup-4',
        name: 'record-history-cold:flush',
        data: { catchupHop: 4 },
      } as any);

      expect(queue.jobs.map((job) => job.id)).toEqual(['record-history-cold-flush-catchup-5']);
    });

    it('registers both schedulers at bootstrap and queues nothing else', async () => {
      const queue = new FakeColdQueue();
      await makeProcessor(queue).onApplicationBootstrap();
      expect(queue.schedulers.map((scheduler) => scheduler.key)).toEqual([
        'record-history-cold:flush',
        'record-history-cold:compact',
      ]);
      // deliberately no boot-time kick: draining a backlog sooner than the
      // next daily slot is a runbook op (EE runner, --max-rows=0), not boot
      // magic — fixed-id kick markers plus BullMQ's lazy retention pruning
      // caused the 2026-07-08 production stalls
      expect(queue.jobs).toHaveLength(0);
    });

    it('does not start a second chain while one is pending', async () => {
      const queue = new FakeColdQueue();
      queue.jobs.push({
        id: 'record-history-cold-flush-catchup-9',
        name: 'record-history-cold:flush',
        data: { catchupHop: 9 },
        state: 'delayed',
      });
      const processor = makeProcessor(queue, { budgetExhausted: true });

      await processor.process({ name: 'record-history-cold:flush', data: {} } as any);

      expect(queue.jobs).toHaveLength(1);
    });
  });
});
