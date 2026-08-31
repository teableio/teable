/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/cognitive-complexity */
import { Readable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type StorageAdapter from '../attachments/plugins/adapter';
import { BucketMergeFeeder } from './bucket-merge-feeder';
import { ExternalRowSorter, SortMemoryBudget } from './external-sort';
import type {
  ColdRemovalReason,
  IColdRemovalRow,
  IColdTruncationMarker,
  IParsedPartKey,
  IPartBucket,
} from './part-codec';
import {
  bloomMightContain,
  buildPartKey,
  buildRecordBloom,
  compareRemovalRowDesc,
  iterateNdjsonLines,
  parsePartKey,
  partFileSuffix,
  statsKey,
  truncateRemovalRow,
} from './part-codec';
import type { IPartStore } from './part-writer';
import { PartWriter } from './part-writer';
import type { ICollectArchivedRowsInput } from './record-removal-cold-read.service';
import {
  decodeRemovalColdCursor,
  encodeRemovalColdCursor,
  RecordRemovalColdReadService,
} from './record-removal-cold-read.service';
import { RecordRemovalColdStorageService } from './record-removal-cold-storage.service';
import { recordRemovalColdConfig } from './record-removal-cold.config';
import { RecordRemovalColdProcessor } from './record-removal-cold.processor';
import { RecordRemovalCompactorService } from './record-removal-compactor.service';
import type { IColdFlushRunResult, ITableFlushResult } from './record-removal-flusher.service';
import { RecordRemovalFlusherService } from './record-removal-flusher.service';
import { isTombstonedAt, RecordRemovalTombstoneService } from './record-removal-tombstone.service';

const ROOT = 'record-removal';
const DAY_MS = 24 * 60 * 60 * 1000;

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

const makeRow = (overrides: Partial<IColdRemovalRow>): IColdRemovalRow => ({
  id: 'rms0000000000000000000000',
  recordId: 'recA',
  snapshot: JSON.stringify({ id: 'recA', fields: { fldA: 'value' } }),
  reason: 'archived',
  removedTime: '2026-05-10T10:00:00.000Z',
  removedBy: 'usr1',
  ...overrides,
});

const sortDesc = (rows: IColdRemovalRow[]) => [...rows].sort(compareRemovalRowDesc);

const seedParts = async (
  storage: RecordRemovalColdStorageService,
  tableId: string,
  reason: ColdRemovalReason,
  bucket: IPartBucket,
  rows: IColdRemovalRow[],
  partUncompressedBytes = 1024 * 1024
) => {
  const writer = new PartWriter({
    store: storage.partStore,
    rootDir: storage.rootDir,
    tableId,
    reason,
    bucket,
    partUncompressedBytes,
  });
  for (const row of sortDesc(rows)) {
    await writer.add(row);
  }
  return writer.finish();
};

const decodeParts = async (storage: RecordRemovalColdStorageService, keys: string[]) => {
  const rows: IColdRemovalRow[] = [];
  for (const key of keys) {
    for await (const item of storage.iterateRows(key)) {
      if (item.row) rows.push(item.row);
    }
  }
  return rows;
};

describe('record-removal cold storage', () => {
  let fake: FakeStorageAdapter;
  let storage: RecordRemovalColdStorageService;

  beforeEach(() => {
    fake = new FakeStorageAdapter();
    storage = new RecordRemovalColdStorageService(fake as unknown as StorageAdapter);
  });

  describe('part key codec', () => {
    it('builds and parses day and month keys with the reason segment', () => {
      const day = buildPartKey(
        ROOT,
        'tblX',
        'archived',
        { yyyymm: '202605', kind: 'day', dd: '07' },
        3,
        'a1b2c3'
      );
      expect(day).toBe(
        `record-removal/v1/tblX/archived/202605/07-p0003-ra1b2c3${partFileSuffix()}`
      );
      expect(parsePartKey(ROOT, day)).toMatchObject({
        tableId: 'tblX',
        reason: 'archived',
        yyyymm: '202605',
        kind: 'day',
        dd: '07',
        seq: 3,
      });

      const month = buildPartKey(
        ROOT,
        'tblX',
        'deleted',
        { yyyymm: '202605', kind: 'month' },
        0,
        'ffee00'
      );
      const parsedMonth = parsePartKey(ROOT, month);
      expect(parsedMonth).toMatchObject({ reason: 'deleted', kind: 'month', seq: 0 });
      expect(parsedMonth?.dd).toBeUndefined();
    });

    it('scopes the stats key per (tableId, reason)', () => {
      expect(statsKey(ROOT, 'tblX', 'archived')).toBe(
        'record-removal/v1/tblX/archived/_stats.json'
      );
      expect(statsKey(ROOT, 'tblX', 'deleted')).toBe('record-removal/v1/tblX/deleted/_stats.json');
    });

    it('rejects malformed keys', () => {
      const good = buildPartKey(
        ROOT,
        'tblX',
        'archived',
        { yyyymm: '202605', kind: 'month' },
        1,
        'abc123'
      );
      expect(parsePartKey(ROOT, good)).toBeDefined();
      // stats files are not parts
      expect(parsePartKey(ROOT, 'record-removal/v1/tblX/archived/_stats.json')).toBeUndefined();
      // the reason segment is mandatory: a history-layout key must not parse
      expect(
        parsePartKey(ROOT, 'record-removal/v1/tblX/202605/07-p0003-rabc123.ndjson.zst')
      ).toBeUndefined();
      // unknown reason
      expect(
        parsePartKey(ROOT, 'record-removal/v1/tblX/purged/202605/07-p0003-rabc123.ndjson.zst')
      ).toBeUndefined();
      // bad month / bad day / missing run token / wrong root
      expect(
        parsePartKey(ROOT, 'record-removal/v1/tblX/archived/20265/07-p0003-rabc.ndjson.zst')
      ).toBeUndefined();
      expect(
        parsePartKey(ROOT, 'record-removal/v1/tblX/archived/202605/7-p0003-rabc.ndjson.zst')
      ).toBeUndefined();
      expect(
        parsePartKey(ROOT, 'record-removal/v1/tblX/archived/202605/07-p0003.ndjson.zst')
      ).toBeUndefined();
      expect(parsePartKey('other-root', good)).toBeUndefined();
    });
  });

  describe('PartWriter', () => {
    it('cuts multiple verified parts under the reason prefix and round-trips all rows', async () => {
      const rows = Array.from({ length: 50 }, (_, i) =>
        makeRow({
          id: `rms${String(i).padStart(4, '0')}`,
          recordId: `rec${String(i % 7).padStart(2, '0')}`,
          removedTime: `2026-05-10T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
        })
      );
      // one distinctive multi-byte snapshot to assert byte-exact round-tripping
      rows[0].snapshot = JSON.stringify({ id: 'recX', fields: { fldA: '值-ünïq' } });
      const entries = await seedParts(
        storage,
        'tblW',
        'deleted',
        { yyyymm: '202605', kind: 'day', dd: '10' },
        rows,
        2048 // force multiple parts
      );
      expect(entries.length).toBeGreaterThan(1);
      expect(entries.reduce((sum, e) => sum + e.rows, 0)).toBe(50);

      const decoded = await decodeParts(
        storage,
        entries.map((e) => e.key)
      );
      expect(decoded).toHaveLength(50);
      expect(new Set(decoded.map((r) => r.id)).size).toBe(50);
      // snapshot text survives byte-exact
      expect(decoded.find((r) => r.id === 'rms0000')!.snapshot).toBe(rows[0].snapshot);
      for (const entry of entries) {
        const parsed = parsePartKey(ROOT, entry.key)!;
        expect(parsed).toMatchObject({
          tableId: 'tblW',
          reason: 'deleted',
          yyyymm: '202605',
          kind: 'day',
          dd: '10',
        });
      }
      // seqs are contiguous from 0 in write order
      expect(entries.map((e) => parsePartKey(ROOT, e.key)!.seq)).toEqual(entries.map((_, i) => i));
    });

    it('deletes a part whose post-upload verification fails', async () => {
      const tamper: IPartStore = {
        upload: async (key, stream) => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(chunk as Buffer);
          }
          const body = Buffer.concat(chunks);
          // drop the tail: the read-back decode / row+sha re-count must fail
          await storage.partStore.upload(
            key,
            Readable.from(body.subarray(0, Math.max(1, body.length - 12)))
          );
        },
        download: (key) => storage.partStore.download(key),
        delete: (key) => storage.partStore.delete(key),
      };
      const writer = new PartWriter({
        store: tamper,
        rootDir: storage.rootDir,
        tableId: 'tblBad',
        reason: 'archived',
        bucket: { yyyymm: '202605', kind: 'month' },
        partUncompressedBytes: 1024 * 1024,
      });
      await writer.add(makeRow({ id: 'rms01' }));
      await expect(writer.finish()).rejects.toThrow();
      // readers discover parts by listing: the corrupt part must not survive
      expect([...fake.objects.keys()].filter((key) => parsePartKey(ROOT, key))).toEqual([]);
    });

    it('stats entries carry removal-time bounds and the optional record-meta dims', async () => {
      const rows = [
        makeRow({
          id: 'rms03',
          removedTime: '2026-05-12T10:00:00.000Z',
          recordCreatedTime: '2026-01-05T00:00:00.000Z',
          recordCreatedBy: 'usrC1',
          recordLastModifiedTime: '2026-04-01T00:00:00.000Z',
          recordLastModifiedBy: 'usrM2',
        }),
        // carries no record-meta dims: contributes nothing to those bounds
        makeRow({ id: 'rms02', removedTime: '2026-05-11T10:00:00.000Z' }),
        makeRow({
          id: 'rms01',
          removedTime: '2026-05-10T10:00:00.000Z',
          recordCreatedTime: '2026-02-01T00:00:00.000Z',
          recordCreatedBy: 'usrC2',
          recordLastModifiedTime: '2026-03-01T00:00:00.000Z',
          recordLastModifiedBy: 'usrM1',
        }),
      ];
      const entries = await seedParts(
        storage,
        'tblS',
        'deleted',
        { yyyymm: '202605', kind: 'month' },
        rows
      );
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        rows: 3,
        minRemovedTime: '2026-05-10T10:00:00.000Z',
        maxRemovedTime: '2026-05-12T10:00:00.000Z',
        minRecordCreatedTime: '2026-01-05T00:00:00.000Z',
        maxRecordCreatedTime: '2026-02-01T00:00:00.000Z',
        minRecordLastModifiedTime: '2026-03-01T00:00:00.000Z',
        maxRecordLastModifiedTime: '2026-04-01T00:00:00.000Z',
        recordCreatedBys: ['usrC1', 'usrC2'],
        recordLastModifiedBys: ['usrM1', 'usrM2'],
      });
    });

    it('actor sets over the 500 cap collapse to null (must-scan), per dim independently', async () => {
      const rows = Array.from({ length: 501 }, (_, i) =>
        makeRow({
          id: `rms${String(i).padStart(4, '0')}`,
          recordCreatedBy: `usr${i}`,
          recordLastModifiedBy: 'usrSame',
        })
      );
      const entries = await seedParts(
        storage,
        'tblCap',
        'archived',
        { yyyymm: '202605', kind: 'month' },
        rows,
        64 * 1024 * 1024
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].rows).toBe(501);
      expect(entries[0].recordCreatedBys).toBeNull();
      expect(entries[0].recordLastModifiedBys).toEqual(['usrSame']);
    });

    it('counts DISTINCT record ids for the bloom under removedTime-major interleaving', async () => {
      // removal parts are removedTime-major, so a record's rows are NOT
      // adjacent — record-history's boundary trick would count 40 here
      const rows = Array.from({ length: 40 }, (_, i) =>
        makeRow({
          id: `rms${String(i).padStart(3, '0')}`,
          recordId: `rec${String(i % 10).padStart(2, '0')}`,
          removedTime: `2026-05-10T10:${String(59 - i).padStart(2, '0')}:00.000Z`,
        })
      );
      const entries = await seedParts(
        storage,
        'tblB',
        'archived',
        { yyyymm: '202605', kind: 'month' },
        rows
      );
      expect(entries).toHaveLength(1);
      const bloom = entries[0].recordBloom!;
      // sized from the 10 distinct ids (10 bits each, floor 64): over-counting
      // occurrences would give 400 bits, under-counting fewer than 100
      expect(bloom.m).toBe(100);
      for (let record = 0; record < 10; record++) {
        expect(bloomMightContain(bloom, `rec${String(record).padStart(2, '0')}`)).toBe(true);
      }
    });
  });

  describe('record bloom', () => {
    it('never yields false negatives — incl. high-bit hash ids — and prunes foreign ids', () => {
      const ids = [
        // h2 with the sign bit set: the `| 1`-without-`>>> 0` regression id
        'recZNamfOGgQuUXi2ez',
        ...Array.from(
          { length: 400 },
          (_, i) => `rec${i.toString(36)}${((i * 2654435761) % 4294967296).toString(36)}`
        ),
      ];
      const bloom = buildRecordBloom(ids, ids.length);
      for (const id of ids) {
        expect(bloomMightContain(bloom, id)).toBe(true);
      }
      const foreign = Array.from({ length: 1000 }, (_, i) => `recForeign${i}`);
      const falsePositives = foreign.filter((id) => bloomMightContain(bloom, id)).length;
      expect(falsePositives).toBeLessThan(30); // ~0.8% target, generous bound
    });

    it('prunes ids that were never added', () => {
      const bloom = buildRecordBloom(['recOnlyOne'], 1);
      // tiny bloom (64-bit floor): a definite miss must return false
      const misses = Array.from({ length: 50 }, (_, i) => `recMiss${i}`).filter((id) =>
        bloomMightContain(bloom, id)
      );
      expect(misses.length).toBeLessThan(10);
      expect(bloomMightContain(bloom, 'recOnlyOne')).toBe(true);
    });
  });

  describe('canonical sort order', () => {
    it('orders removedTime DESC with an id byte-order DESC tiebreak', () => {
      const t = '2026-05-10T10:00:00.000Z';
      const newer = { removedTime: '2026-05-10T11:00:00.000Z', id: 'rms01' };
      const older = { removedTime: t, id: 'rms99' };
      expect(compareRemovalRowDesc(newer, older)).toBeLessThan(0);
      expect(compareRemovalRowDesc(older, newer)).toBeGreaterThan(0);
      // byte order, never a collation: lowercase 'a' (0x61) > uppercase 'Z'
      // (0x5a), so 'recaAA' sorts FIRST under id DESC
      const lower = { removedTime: t, id: 'recaAA' };
      const upper = { removedTime: t, id: 'recZZZ' };
      expect(compareRemovalRowDesc(lower, upper)).toBeLessThan(0);
      expect(compareRemovalRowDesc(upper, lower)).toBeGreaterThan(0);
      expect(compareRemovalRowDesc(lower, { ...lower })).toBe(0);
    });

    it('the sorter emits an id exactly once when duplicates share a removedTime', async () => {
      const sorter = new ExternalRowSorter();
      const dup = makeRow({ id: 'rms02', removedTime: '2026-05-10T10:02:00.000Z' });
      await sorter.add(makeRow({ id: 'rms01', removedTime: '2026-05-10T10:01:00.000Z' }));
      await sorter.add(dup);
      await sorter.add({ ...dup });
      await sorter.add(makeRow({ id: 'rms03', removedTime: '2026-05-10T10:03:00.000Z' }));
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual(['rms03', 'rms02', 'rms01']);
    });
  });

  describe('oversized snapshot truncation', () => {
    it('replaces a field value over the cap with a marker and keeps the rest', () => {
      const big = 'x'.repeat(300);
      const row = makeRow({
        snapshot: JSON.stringify({ id: 'recA', fields: { fldBig: big, fldSmall: 'ok' } }),
      });
      const capped = truncateRemovalRow(row, 256, 0);
      expect(capped).not.toBe(row);
      const parsed = JSON.parse(capped.snapshot) as {
        fields: Record<string, IColdTruncationMarker | string>;
      };
      expect(parsed.fields.fldBig).toEqual({ _truncated: true, units: JSON.stringify(big).length });
      expect(parsed.fields.fldSmall).toBe('ok');
      // only the snapshot changed
      expect(capped.id).toBe(row.id);
      expect(capped.removedTime).toBe(row.removedTime);
    });

    it('falls back to a whole-snapshot marker when the row cap is exceeded', () => {
      // every field under the field cap, but the row total over the row cap
      const fields = Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [`fld${i}`, 'y'.repeat(150)])
      );
      const row = makeRow({ snapshot: JSON.stringify({ id: 'recA', fields }) });
      const originalLength = row.snapshot.length;
      const capped = truncateRemovalRow(row, 300, 600);
      // the marker keeps a restorable record shell — id from the row column
      expect(JSON.parse(capped.snapshot)).toEqual({
        id: row.recordId,
        fields: {},
        _truncated: true,
        units: originalLength,
      });
    });

    it('returns the same ref when nothing changed', () => {
      const row = makeRow({ id: 'rmsSmall' });
      expect(truncateRemovalRow(row, 256, 1024)).toBe(row);
    });

    it('caps of 0 disable truncation', () => {
      const row = makeRow({ id: 'rmsHuge', snapshot: 'z'.repeat(5_000_000) });
      expect(truncateRemovalRow(row, 0, 0)).toBe(row);
    });

    it('a non-JSON snapshot skips the field pass but still honors the row cap', () => {
      // under the row cap: unchanged, same ref
      const smallish = makeRow({ snapshot: 'x'.repeat(400) });
      expect(truncateRemovalRow(smallish, 300, 600)).toBe(smallish);
      // over the row cap: whole-snapshot marker despite being unparseable
      const oversized = makeRow({ snapshot: 'x'.repeat(700) });
      const capped = truncateRemovalRow(oversized, 300, 600);
      expect(JSON.parse(capped.snapshot)).toEqual({
        id: oversized.recordId,
        fields: {},
        _truncated: true,
        units: 700,
      });
    });
  });

  describe('external row sorter', () => {
    it('drains newest-first and deduped across gzip-spilled runs', async () => {
      const sorter = new ExternalRowSorter(3); // tiny run size => several spill files
      const at = (minute: number) => `2026-05-10T10:0${minute}:00.000Z`;
      const rows = [
        makeRow({ id: 'rms05', removedTime: at(5) }),
        makeRow({ id: 'rms01', removedTime: at(1) }),
        makeRow({ id: 'rms04', removedTime: at(4) }),
        makeRow({ id: 'rms02', removedTime: at(2) }),
        makeRow({ id: 'rms03', removedTime: at(3) }),
        makeRow({ id: 'rms03', removedTime: at(3) }), // duplicate id straddling runs
        makeRow({ id: 'rms00', removedTime: at(0) }),
      ];
      for (const row of rows) {
        await sorter.add(row);
      }
      const out: IColdRemovalRow[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row);
      });
      expect(out.map((r) => r.id)).toEqual(['rms05', 'rms04', 'rms03', 'rms02', 'rms01', 'rms00']);
      // rows survive the gzip spill byte-for-byte
      expect(out[5]).toEqual(rows[6]);
    });

    it('a shared budget evicts the largest run while smaller ones stay in memory', async () => {
      const budget = new SortMemoryBudget(2700);
      const fat = new ExternalRowSorter(undefined, budget);
      const thin = new ExternalRowSorter(undefined, budget);
      await fat.add(makeRow({ id: 'rmsfat', recordId: 'recB', snapshot: 'x'.repeat(2500) }));
      expect(fat.pendingBytes).toBeGreaterThan(0); // fits alone
      await thin.add(makeRow({ id: 'rmsthin' }));
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
      expect(fatOut).toEqual(['rmsfat']);
      expect(thinOut).toEqual(['rmsthin']);
      expect(budget.usedBytes).toBe(0); // drains released every charge
    });

    it('multi-pass merge stays correct when runs exceed the fan-in', async () => {
      // fan-in 2 with a tiny run size forces several spilled runs and >1 pass
      const sorter = new ExternalRowSorter(2, undefined, 2);
      const at = (minute: number) => `2026-05-10T10:${String(minute).padStart(2, '0')}:00.000Z`;
      const order = [7, 2, 5, 0, 9, 3, 6, 1, 8, 4];
      for (const n of order) {
        await sorter.add(makeRow({ id: `rms0${n}`, removedTime: at(n) }));
      }
      // a duplicate id in a separate run must dedup across passes
      await sorter.add(makeRow({ id: 'rms04', removedTime: at(4) }));
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual(Array.from({ length: 10 }, (_, i) => `rms0${9 - i}`));
    });

    it('a fan-in of 1 is clamped so the multi-pass merge still converges', async () => {
      // env allows FAN_IN=1; without the floor the pass groups 1->1 forever
      const sorter = new ExternalRowSorter(2, undefined, 1);
      const at = (minute: number) => `2026-05-10T10:0${minute}:00.000Z`;
      for (const n of [3, 1, 4, 0, 2]) {
        await sorter.add(makeRow({ id: `rms0${n}`, removedTime: at(n) }));
      }
      const out: string[] = [];
      await sorter.drainTo(async (row) => {
        out.push(row.id);
      });
      expect(out).toEqual(['rms04', 'rms03', 'rms02', 'rms01', 'rms00']);
    });
  });

  describe('NDJSON line splitting', () => {
    it('splits a multi-MB single line without readline', async () => {
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

  describe('bucket merge feeder', () => {
    it('re-flushing a bucket folds existing parts in without loss and exposes consumedKeys', async () => {
      const tableId = 'tblF';
      const reason: ColdRemovalReason = 'archived';
      const bucket: IPartBucket = { yyyymm: '202607', kind: 'day', dd: '07' };
      const at = (hour: number) => `2026-07-07T0${hour}:00:00.000Z`;
      const firstBatch = Array.from({ length: 5 }, (_, i) =>
        makeRow({ id: `rms0${i}`, removedTime: at(i) })
      );
      await seedParts(storage, tableId, reason, bucket, firstBatch);

      // second run: only 2 new rows remain in the buffer (first 5 already
      // deleted); one of them duplicates an existing row (overlap window)
      const existing = (await storage.listMonthParts(tableId, reason, '202607')).filter(
        (part) => part.kind === 'day' && part.dd === '07'
      );
      expect(existing.length).toBeGreaterThan(0);
      const writer = new PartWriter({
        store: storage.partStore,
        rootDir: storage.rootDir,
        tableId,
        reason,
        bucket,
        partUncompressedBytes: 1024 * 1024,
        startSeq: existing.reduce((max, part) => Math.max(max, part.seq + 1), 0),
      });
      const feeder = new BucketMergeFeeder(writer, existing, storage);
      await feeder.push(makeRow({ id: 'rms04', removedTime: at(4) })); // dup
      await feeder.push(makeRow({ id: 'rms05', removedTime: at(5) }));
      await feeder.push(makeRow({ id: 'rms06', removedTime: at(6) }));
      const entries = await feeder.finish();

      expect(feeder.mergedExistingRows).toBe(5);
      // exactly the folded pre-existing keys — the only healable set
      expect(feeder.consumedKeys).toEqual(new Set(existing.map((part) => part.key)));
      for (const entry of entries) {
        expect(feeder.consumedKeys.has(entry.key)).toBe(false);
      }

      // no row lost, overlap deduped, canonical (removedTime DESC) order kept
      const decoded = await decodeParts(
        storage,
        entries.map((entry) => entry.key)
      );
      expect(decoded.map((r) => r.id)).toEqual([
        'rms06',
        'rms05',
        'rms04',
        'rms03',
        'rms02',
        'rms01',
        'rms00',
      ]);
    });
  });

  describe('archive cold read (collectArchivedRows)', () => {
    const tableId = 'tblRead';
    const reason: ColdRemovalReason = 'archived';
    let readService: RecordRemovalColdReadService;
    let downloadedPartKeys: string[];

    beforeEach(() => {
      readService = new RecordRemovalColdReadService(storage);
      downloadedPartKeys = [];
      const original = fake.downloadFile.bind(fake);
      fake.downloadFile = async (bucket: string, path: string) => {
        if (path.includes('.ndjson.')) downloadedPartKeys.push(path);
        return original(bucket, path);
      };
    });

    const collect = (overrides: Partial<ICollectArchivedRowsInput>) =>
      readService.collectArchivedRows({
        tableId,
        reason,
        limit: 10,
        orderBy: 'removedTime',
        direction: 'desc',
        seenIds: new Set<string>(),
        ...overrides,
      });

    const writeStatsFor = async (...entryLists: Awaited<ReturnType<typeof seedParts>>[]) => {
      const flat = entryLists.flat();
      await storage.writeStats(tableId, reason, {
        version: 1,
        tableId,
        reason,
        parts: Object.fromEntries(flat.map((entry) => [entry.key, entry])),
      });
    };

    it('fills desc pages across months with stats pruning and reason isolation', async () => {
      const mayNew = await seedParts(
        storage,
        tableId,
        reason,
        { yyyymm: '202605', kind: 'day', dd: '20' },
        [
          makeRow({
            id: 'rmsB1',
            removedTime: '2026-05-20T01:00:00.000Z',
            recordCreatedBy: 'usrB',
          }),
          makeRow({
            id: 'rmsB2',
            removedTime: '2026-05-20T02:00:00.000Z',
            recordCreatedBy: 'usrB',
          }),
        ]
      );
      const mayOld = await seedParts(
        storage,
        tableId,
        reason,
        { yyyymm: '202605', kind: 'day', dd: '10' },
        [
          makeRow({
            id: 'rmsA1',
            removedTime: '2026-05-10T01:00:00.000Z',
            recordCreatedBy: 'usrA',
          }),
          makeRow({
            id: 'rmsA2',
            removedTime: '2026-05-10T02:00:00.000Z',
            recordCreatedBy: 'usrA',
          }),
          makeRow({
            id: 'rmsA3',
            removedTime: '2026-05-10T03:00:00.000Z',
            recordCreatedBy: 'usrA',
          }),
        ]
      );
      const april = await seedParts(storage, tableId, reason, { yyyymm: '202604', kind: 'month' }, [
        makeRow({ id: 'rmsC1', removedTime: '2026-04-05T01:00:00.000Z', recordCreatedBy: 'usrA' }),
        makeRow({ id: 'rmsC2', removedTime: '2026-04-05T02:00:00.000Z', recordCreatedBy: 'usrA' }),
      ]);
      // deleted-reason rows in the same months must never be touched by the archive read
      await seedParts(storage, tableId, 'deleted', { yyyymm: '202605', kind: 'day', dd: '20' }, [
        makeRow({ id: 'rmsD1', reason: 'deleted', removedTime: '2026-05-20T03:00:00.000Z' }),
      ]);
      await writeStatsFor(mayNew, mayOld, april);
      // drop the writer's own post-upload verification downloads: only the
      // READ path's downloads matter below
      downloadedPartKeys.length = 0;

      const page1 = await collect({ limit: 4 });
      expect(page1.rows.map((r) => r.id)).toEqual(['rmsB2', 'rmsB1', 'rmsA3', 'rmsA2']);
      expect(page1.nextCursor).toMatch(/^rms1:/);

      const page2 = await collect({
        limit: 4,
        boundary: decodeRemovalColdCursor(page1.nextCursor!)?.boundary,
      });
      expect(page2.rows.map((r) => r.id)).toEqual(['rmsA1', 'rmsC2', 'rmsC1']);
      expect(page2.nextCursor).toBeNull();
      expect(downloadedPartKeys.every((key) => key.includes('/archived/'))).toBe(true);

      // stats actor-set pruning: a usrB filter downloads ONLY the day-20 part
      downloadedPartKeys.length = 0;
      const filtered = await collect({ filters: { recordCreatedBys: ['usrB'] } });
      expect(filtered.rows.map((r) => r.id)).toEqual(['rmsB2', 'rmsB1']);
      expect(filtered.nextCursor).toBeNull();
      expect(new Set(downloadedPartKeys)).toEqual(new Set(mayNew.map((entry) => entry.key)));
    });

    it('seenIds dedups the PG overlap window without consuming quota and releases the probe row', async () => {
      const at = '2026-05-10T10:00:00.000Z';
      await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'day', dd: '10' }, [
        makeRow({ id: 'rmsS1', removedTime: at }),
        makeRow({ id: 'rmsS2', removedTime: at }),
        makeRow({ id: 'rmsS3', removedTime: at }),
        makeRow({ id: 'rmsS4', removedTime: at }),
        makeRow({ id: 'rmsS5', removedTime: at }),
      ]);

      // PG served s5/s4 (the boundary) and — simulating a collation-order
      // divergence in the overlap window — also s3, which byte order places
      // after the boundary; it must be skipped WITHOUT eating page quota
      const seenIds = new Set(['rmsS5', 'rmsS4', 'rmsS3']);
      const page = await collect({ limit: 2, boundary: { k: at, id: 'rmsS4' }, seenIds });
      expect(page.rows.map((r) => r.id)).toEqual(['rmsS2', 'rmsS1']);
      expect(page.nextCursor).toBeNull();
      expect(seenIds.has('rmsS2') && seenIds.has('rmsS1')).toBe(true);

      // the limit+1 probe row is served on the NEXT page: its id must leave
      // the seen set when it is popped
      const probeSeen = new Set(['rmsS5', 'rmsS4']);
      const probePage = await collect({
        limit: 1,
        boundary: { k: at, id: 'rmsS4' },
        seenIds: probeSeen,
      });
      expect(probePage.rows.map((r) => r.id)).toEqual(['rmsS3']);
      expect(decodeRemovalColdCursor(probePage.nextCursor!)?.boundary).toEqual({
        k: at,
        id: 'rmsS3',
      });
      expect(probeSeen.has('rmsS3')).toBe(true);
      expect(probeSeen.has('rmsS2')).toBe(false);
    });

    it('serves secondary-sort pages via bounded top-K with missing-dim exclusion and cursor handoff', async () => {
      const may = await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'month' }, [
        makeRow({
          id: 'rmsR1',
          removedTime: '2026-05-10T00:00:00.000Z',
          recordCreatedTime: '2026-01-05T00:00:00.000Z',
        }),
        // no recordCreatedTime → excluded from this sort entirely
        makeRow({ id: 'rmsR3', removedTime: '2026-05-11T00:00:00.000Z' }),
        makeRow({
          id: 'rmsR5',
          removedTime: '2026-05-01T00:00:00.000Z',
          recordCreatedTime: '2026-02-01T00:00:00.000Z',
        }),
      ]);
      const april = await seedParts(storage, tableId, reason, { yyyymm: '202604', kind: 'month' }, [
        makeRow({
          id: 'rmsR2',
          removedTime: '2026-04-15T00:00:00.000Z',
          recordCreatedTime: '2026-03-01T00:00:00.000Z',
        }),
        makeRow({
          id: 'rmsR4',
          removedTime: '2026-04-01T00:00:00.000Z',
          recordCreatedTime: '2026-02-01T00:00:00.000Z',
        }),
      ]);
      await writeStatsFor(may, april);

      const page1 = await collect({ limit: 2, orderBy: 'recordCreatedTime' });
      // r2 (03-01), then the 02-01 tie broken by id byte order desc (R5 > R4)
      expect(page1.rows.map((r) => r.id)).toEqual(['rmsR2', 'rmsR5']);
      const boundary = decodeRemovalColdCursor(page1.nextCursor!)?.boundary;
      expect(boundary).toEqual({ k: '2026-02-01T00:00:00.000Z', id: 'rmsR5' });

      const page2 = await collect({ limit: 2, orderBy: 'recordCreatedTime', boundary });
      expect(page2.rows.map((r) => r.id)).toEqual(['rmsR4', 'rmsR1']);
      expect(page2.nextCursor).toBeNull();
    });

    it('round-trips rms1 cursors including the boundary-less form and rejects garbage', () => {
      const boundary = { k: '2026-05-01T00:00:00.000Z', id: 'rmsX' };
      const cursor = encodeRemovalColdCursor(boundary);
      expect(cursor.startsWith('rms1:')).toBe(true);
      expect(decodeRemovalColdCursor(cursor)?.boundary).toEqual(boundary);

      // { k: null, id: null } = cold zone from the top (EE seam/retry cursor)
      const topCursor = encodeRemovalColdCursor(undefined);
      const decodedTop = decodeRemovalColdCursor(topCursor);
      expect(decodedTop).toBeDefined();
      expect(decodedTop?.boundary).toBeUndefined();

      // a PG row-id cursor and malformed payloads are "not a cold cursor"
      expect(decodeRemovalColdCursor('cl9xyzrowid')).toBeUndefined();
      expect(decodeRemovalColdCursor('rms1:%%%not-base64%%%')).toBeUndefined();
      expect(
        decodeRemovalColdCursor(`rms1:${Buffer.from('{"k":5,"id":true}').toString('base64url')}`)
      ).toBeUndefined();
    });

    it('returns a partial page plus retry cursor on mid-scan timeout and fails loudly with zero rows', async () => {
      await seedParts(storage, tableId, reason, { yyyymm: '202606', kind: 'day', dd: '05' }, [
        makeRow({ id: 'rmsM1', removedTime: '2026-06-05T01:00:00.000Z' }),
        makeRow({ id: 'rmsM2', removedTime: '2026-06-05T02:00:00.000Z' }),
      ]);
      await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'day', dd: '05' }, [
        makeRow({ id: 'rmsO1', removedTime: '2026-05-05T01:00:00.000Z' }),
      ]);

      // the SECOND month's part listing stalls past the deadline: June is
      // already collected atomically, May contributes nothing → partial page
      let partListCalls = 0;
      const slowStorage = new Proxy(storage, {
        get(target, prop, receiver) {
          if (prop === 'listMonthParts') {
            return async (...args: [string, ColdRemovalReason, string]) => {
              partListCalls += 1;
              if (partListCalls > 1) await new Promise((resolve) => setTimeout(resolve, 600));
              return target.listMonthParts(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const partialService = new RecordRemovalColdReadService(slowStorage as never);
      const partial = await partialService.collectArchivedRows({
        tableId,
        reason,
        limit: 10,
        orderBy: 'removedTime',
        direction: 'desc',
        seenIds: new Set(),
        deadlineMs: 400,
      });
      expect(partial.rows.map((r) => r.id)).toEqual(['rmsM2', 'rmsM1']);
      expect(decodeRemovalColdCursor(partial.nextCursor!)?.boundary?.id).toBe('rmsM1');

      // budget spent before anything was collected → loud failure, never an
      // empty "no more archives" page
      const stalledStorage = new Proxy(storage, {
        get(target, prop, receiver) {
          if (prop === 'listMonths') {
            return async (...args: [string, ColdRemovalReason]) => {
              await new Promise((resolve) => setTimeout(resolve, 600));
              return target.listMonths(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const stalledService = new RecordRemovalColdReadService(stalledStorage as never);
      await expect(
        stalledService.collectArchivedRows({
          tableId,
          reason,
          limit: 10,
          orderBy: 'removedTime',
          direction: 'desc',
          seenIds: new Set(),
          deadlineMs: 400,
        })
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('tombstoned rows vanish from cold pages while newer re-archived rows survive', async () => {
      await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'day', dd: '10' }, [
        makeRow({ id: 'rmsT1', recordId: 'recTomb', removedTime: '2026-05-10T01:00:00.000Z' }),
        makeRow({ id: 'rmsK1', recordId: 'recKeep', removedTime: '2026-05-10T02:00:00.000Z' }),
      ]);
      // the tombstoned record re-archived AFTER the tombstone: its new sunk row
      // is live data and must keep surfacing
      await seedParts(storage, tableId, reason, { yyyymm: '202607', kind: 'day', dd: '01' }, [
        makeRow({ id: 'rmsT2', recordId: 'recTomb', removedTime: '2026-07-01T00:00:00.000Z' }),
      ]);
      const tombstones = new Map([['recTomb', '2026-06-01T00:00:00.000Z']]);

      const page = await collect({
        isTombstoned: (recordId, removedTime) => isTombstonedAt(tombstones, recordId, removedTime),
      });
      expect(page.rows.map((r) => r.id)).toEqual(['rmsT2', 'rmsK1']);
      expect(page.nextCursor).toBeNull();
    });

    it('point lookup returns the latest row per record with bloom pruning and month early stop', async () => {
      const june = await seedParts(storage, tableId, reason, { yyyymm: '202606', kind: 'month' }, [
        makeRow({ id: 'rmsZ1', recordId: 'recZ', removedTime: '2026-06-10T00:00:00.000Z' }),
      ]);
      const may = await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'month' }, [
        makeRow({ id: 'rmsX2', recordId: 'recX', removedTime: '2026-05-10T00:00:00.000Z' }),
        makeRow({ id: 'rmsY1', recordId: 'recY', removedTime: '2026-05-12T00:00:00.000Z' }),
      ]);
      const april = await seedParts(storage, tableId, reason, { yyyymm: '202604', kind: 'month' }, [
        makeRow({ id: 'rmsX1', recordId: 'recX', removedTime: '2026-04-05T00:00:00.000Z' }),
      ]);
      await writeStatsFor(june, may, april);
      downloadedPartKeys.length = 0;

      const found = await readService.lookupArchivedRowsByRecordIds({
        tableId,
        reason,
        recordIds: ['recX', 'recY'],
      });
      // the newest month containing each record wins — the April copy of recX
      // is older by construction and never consulted
      expect(found.get('recX')?.id).toBe('rmsX2');
      expect(found.get('recY')?.id).toBe('rmsY1');
      // bloom pruned the June part (both ids definitely absent)…
      expect(downloadedPartKeys).not.toContain(june[0].key);
      // …and the month walk stopped before April (all ids resolved in May)
      expect(downloadedPartKeys).not.toContain(april[0].key);
      expect(downloadedPartKeys).toContain(may[0].key);

      // an id that never existed prunes every part via the blooms
      downloadedPartKeys.length = 0;
      const none = await readService.lookupArchivedRowsByRecordIds({
        tableId,
        reason,
        recordIds: ['recNever'],
      });
      expect(none.size).toBe(0);
      expect(downloadedPartKeys).toEqual([]);
    });

    it('point lookup skips tombstoned rows and fails loudly past the deadline', async () => {
      const may = await seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'month' }, [
        makeRow({ id: 'rmsX1', recordId: 'recX', removedTime: '2026-05-10T00:00:00.000Z' }),
      ]);
      await writeStatsFor(may);

      // every cold row of recX predates the tombstone → "not found"
      const tombstones = new Map([['recX', '2026-06-01T00:00:00.000Z']]);
      const found = await readService.lookupArchivedRowsByRecordIds({
        tableId,
        reason,
        recordIds: ['recX'],
        isTombstoned: (recordId, removedTime) => isTombstonedAt(tombstones, recordId, removedTime),
      });
      expect(found.size).toBe(0);

      // all-or-nothing under the budget: a stalled metadata read throws
      // instead of returning a partial (possibly stale) result
      const stalledStorage = new Proxy(storage, {
        get(target, prop, receiver) {
          if (prop === 'listMonths') {
            return async (...args: [string, ColdRemovalReason]) => {
              await new Promise((resolve) => setTimeout(resolve, 600));
              return target.listMonths(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      const stalledService = new RecordRemovalColdReadService(stalledStorage as never);
      await expect(
        stalledService.lookupArchivedRowsByRecordIds({
          tableId,
          reason,
          recordIds: ['recX'],
          deadlineMs: 400,
        })
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    // a month lists oldest-day-first, so without ordering every part would be
    // streamed in full before the page could be trimmed
    const seedThreeDays = async () => {
      const day = (dd: string, id: string, at: string, recordCreatedTime: string) =>
        seedParts(storage, tableId, reason, { yyyymm: '202605', kind: 'day', dd }, [
          makeRow({ id, recordId: `rec${dd}`, removedTime: at, recordCreatedTime }),
        ]);
      // every row carries recordCreatedTime so the secondary-sort case survives
      // the existing stats pruning and actually reaches the parts
      const d10 = await day('10', 'rmsD10', '2026-05-10T08:00:00.000Z', '2026-04-01T00:00:00.000Z');
      const d20 = await day('20', 'rmsD20', '2026-05-20T08:00:00.000Z', '2026-04-02T00:00:00.000Z');
      const d30 = await day('30', 'rmsD30', '2026-05-30T08:00:00.000Z', '2026-04-03T00:00:00.000Z');
      await writeStatsFor(d10, d20, d30);
      downloadedPartKeys.length = 0;
      return { d10, d20, d30 };
    };

    // a page probes one row past its limit to learn whether another exists, so
    // it always stops one part later than the limit alone would suggest
    it('stops a desc month once the page outranks every part left', async () => {
      const { d20, d30 } = await seedThreeDays();

      const page = await collect({ limit: 1 });

      expect(page.rows.map((r) => r.id)).toEqual(['rmsD30']);
      expect(downloadedPartKeys).toEqual([d30[0].key, d20[0].key]);
    });

    it('stops an asc month from the other end', async () => {
      const { d10, d20 } = await seedThreeDays();

      const page = await collect({ limit: 1, direction: 'asc' });

      expect(page.rows.map((r) => r.id)).toEqual(['rmsD10']);
      expect(downloadedPartKeys).toEqual([d10[0].key, d20[0].key]);
    });

    it('keeps a secondary sort on the full-scan path', async () => {
      const { d10, d20, d30 } = await seedThreeDays();

      // recordCreatedTime bounds are optional on the entry, so those parts are
      // never reordered or pruned — every candidate still streams
      const page = await collect({ limit: 1, orderBy: 'recordCreatedTime' });

      expect(page.rows.map((r) => r.id)).toEqual(['rmsD30']);
      expect(downloadedPartKeys.sort()).toEqual([d10[0].key, d20[0].key, d30[0].key].sort());
    });
  });

  describe('tombstones', () => {
    interface IFakeTombstoneRow {
      id: string;
      tableId: string;
      recordId: string;
      type: string;
      createdTime: Date;
    }

    // fake of the prisma recordRemovalTombstone delegate surface the service uses
    class FakeTombstoneDb {
      rows: IFakeTombstoneRow[] = [];

      client = {
        recordRemovalTombstone: {
          createMany: async ({ data }: { data: Omit<IFakeTombstoneRow, 'createdTime'>[] }) => {
            for (const row of data) {
              this.rows.push({ createdTime: new Date(), ...row });
            }
            return { count: data.length };
          },
          findMany: async ({ where }: { where: { tableId: string } }) =>
            this.rows
              .filter((row) => row.tableId === where.tableId)
              .map(({ recordId, createdTime }) => ({ recordId, createdTime })),
        },
      };
    }

    it('marks write prefixed rows and the load keeps the newest time per record', async () => {
      const db = new FakeTombstoneDb();
      const service = new RecordRemovalTombstoneService();

      await service.markRestored(db.client as never, 'tblT', ['recA', 'recB']);
      await service.markPurged(db.client as never, 'tblT', ['recB']);
      await service.markPurged(db.client as never, 'tblT', []); // no-op, no empty createMany
      expect(db.rows).toHaveLength(3);
      expect(db.rows.every((row) => /^rmt[0-9a-zA-Z]{16}$/.test(row.id))).toBe(true);
      expect(db.rows.map((row) => row.type)).toEqual(['restored', 'restored', 'purged']);

      // load keeps the LATEST tombstone per record and stays table-scoped
      db.rows[0].createdTime = new Date('2026-07-01T00:00:00.000Z'); // recA restored
      db.rows[1].createdTime = new Date('2026-07-01T00:00:00.000Z'); // recB restored
      db.rows[2].createdTime = new Date('2026-07-05T00:00:00.000Z'); // recB purged later
      db.rows.push({
        id: 'rmtOtherTable0000000',
        tableId: 'tblOther',
        recordId: 'recC',
        type: 'purged',
        createdTime: new Date(),
      });
      const map = await service.loadTombstonedRecordIds(db.client as never, 'tblT');
      expect(map.get('recA')).toBe('2026-07-01T00:00:00.000Z');
      expect(map.get('recB')).toBe('2026-07-05T00:00:00.000Z');
      expect(map.has('recC')).toBe(false);

      // the time-qualified rule: only rows REMOVED BEFORE the tombstone are hidden
      expect(isTombstonedAt(map, 'recA', '2026-06-30T00:00:00.000Z')).toBe(true);
      expect(isTombstonedAt(map, 'recA', '2026-07-01T00:00:00.000Z')).toBe(true); // boundary inclusive
      expect(isTombstonedAt(map, 'recA', '2026-07-02T00:00:00.000Z')).toBe(false);
      expect(isTombstonedAt(map, 'recUnknown', '2026-01-01T00:00:00.000Z')).toBe(false);
    });

    it('compaction physically drops tombstoned rows and leaves the tombstones in place', async () => {
      const tombstoneDb = new FakeTombstoneDb();
      const compactor = new RecordRemovalCompactorService(
        storage,
        { dataPrismaForTable: async () => tombstoneDb.client } as never,
        new RecordRemovalTombstoneService()
      );
      await seedParts(storage, 'tblC', 'archived', { yyyymm: '202605', kind: 'day', dd: '10' }, [
        makeRow({ id: 'rmsG1', recordId: 'recGone', removedTime: '2026-05-10T01:00:00.000Z' }),
        makeRow({ id: 'rmsS1', recordId: 'recStay', removedTime: '2026-05-10T02:00:00.000Z' }),
      ]);
      await seedParts(storage, 'tblC', 'archived', { yyyymm: '202605', kind: 'day', dd: '20' }, [
        makeRow({ id: 'rmsG2', recordId: 'recGone', removedTime: '2026-05-20T01:00:00.000Z' }),
        // re-archived AFTER its purge tombstone: the newer row is live data
        makeRow({ id: 'rmsB1', recordId: 'recBack', removedTime: '2026-05-25T00:00:00.000Z' }),
      ]);
      tombstoneDb.rows.push(
        {
          id: 'rmtGone000000000000',
          tableId: 'tblC',
          recordId: 'recGone',
          type: 'restored',
          createdTime: new Date('2026-06-01T00:00:00.000Z'),
        },
        {
          id: 'rmtBack000000000000',
          tableId: 'tblC',
          recordId: 'recBack',
          type: 'purged',
          createdTime: new Date('2026-05-24T00:00:00.000Z'),
        }
      );

      const result = await compactor.compactMonth('tblC', 'archived', '202605');
      expect(result.tombstonedRows).toBe(2);
      expect(result.rows).toBe(2);

      // the rewritten month parts hold only the surviving rows; day parts healed away
      const parts = await storage.listMonthParts('tblC', 'archived', '202605');
      expect(parts.every((part) => part.kind === 'month')).toBe(true);
      const decoded = await decodeParts(
        storage,
        parts.map((part) => part.key)
      );
      expect(decoded.map((row) => row.id)).toEqual(['rmsB1', 'rmsS1']);

      // stats (and the bloom) rebuilt without the dropped record
      const stats = await storage.readStats('tblC', 'archived');
      expect(Object.keys(stats!.parts).sort()).toEqual(parts.map((part) => part.key).sort());
      const bloom = stats!.parts[parts[0].key].recordBloom!;
      expect(bloomMightContain(bloom, 'recStay')).toBe(true);
      expect(bloomMightContain(bloom, 'recGone')).toBe(false);

      // tombstones are NOT GC'd here: day parts of the current month or other
      // months may still hold copies — GC needs an "all parts confirmed clean"
      // check, deferred
      expect(tombstoneDb.rows).toHaveLength(2);
    });

    it('re-compacts a month left with multiple month generations by a failed heal', async () => {
      const compactor = new RecordRemovalCompactorService(
        storage,
        {
          dataPrismaForTable: async () => {
            throw new Error('tenant binding down');
          },
        } as never,
        new RecordRemovalTombstoneService()
      );
      await seedParts(storage, 'tblG', 'archived', { yyyymm: '202601', kind: 'month' }, [
        makeRow({ id: 'rmsGA', recordId: 'recA', removedTime: '2026-01-10T01:00:00.000Z' }),
        makeRow({ id: 'rmsGB', recordId: 'recB', removedTime: '2026-01-11T01:00:00.000Z' }),
      ]);
      await seedParts(storage, 'tblG', 'archived', { yyyymm: '202601', kind: 'month' }, [
        makeRow({ id: 'rmsGA', recordId: 'recA', removedTime: '2026-01-10T01:00:00.000Z' }),
      ]);

      const result = await compactor.compactMonth('tblG', 'archived', '202601');
      expect(result).toMatchObject({ rows: 2, outputParts: 1 });

      // converged: the follow-up pass sees a single generation and skips again
      const again = await compactor.compactMonth('tblG', 'archived', '202601');
      expect(again.skippedReason).toBe('no-day-parts');
    });

    it('an unreachable data db compacts without the drop (fail open)', async () => {
      const compactor = new RecordRemovalCompactorService(
        storage,
        {
          dataPrismaForTable: async () => {
            throw new Error('tenant binding down');
          },
        } as never,
        new RecordRemovalTombstoneService()
      );
      await seedParts(storage, 'tblC2', 'archived', { yyyymm: '202605', kind: 'day', dd: '10' }, [
        makeRow({ id: 'rmsF1', recordId: 'recF', removedTime: '2026-05-10T01:00:00.000Z' }),
      ]);

      const result = await compactor.compactMonth('tblC2', 'archived', '202605');
      expect(result.tombstonedRows).toBe(0);
      expect(result.rows).toBe(1);
      expect(result.outputParts).toBe(1);
    });
  });

  describe('flusher', () => {
    interface IFakeTrashRow {
      id: string;
      tableId: string;
      recordId: string;
      snapshot: string;
      reason: ColdRemovalReason;
      createdTime: Date;
      createdBy: string;
      operationId?: string;
      recordCreatedTime?: Date;
      recordCreatedBy?: string;
      recordLastModifiedTime?: Date;
      recordLastModifiedBy?: string;
    }

    const trashRow = (
      overrides: Partial<IFakeTrashRow> &
        Pick<IFakeTrashRow, 'id' | 'tableId' | 'reason' | 'createdTime'>
    ): IFakeTrashRow => ({
      recordId: 'recA',
      snapshot: JSON.stringify({ id: 'recA', fields: { fldA: 'v' } }),
      createdBy: 'usr1',
      ...overrides,
    });

    class FakeTrashDb {
      rows: IFakeTrashRow[] = [];
      // one-shot hook before the reconcile count (straggler injection)
      onReconcileCount?: () => void;

      insert(row: IFakeTrashRow) {
        this.rows.push(row);
      }

      countFor(tableId: string, reason: string, cutoff: Date): number {
        return this.rows.filter(
          (r) => r.tableId === tableId && r.reason === reason && r.createdTime < cutoff
        ).length;
      }

      deleteFor(tableId: string, reason: string, cutoff: Date): number {
        const before = this.rows.length;
        this.rows = this.rows.filter(
          (r) => !(r.tableId === tableId && r.reason === reason && r.createdTime < cutoff)
        );
        return before - this.rows.length;
      }
    }

    // mini interpreters for the flusher's raw queries against the fake buffer;
    // JS Date/ordinal-string compares match the COLLATE "C" + UTC semantics
    // the SQL pins
    const makeFlusherHarness = (
      db: FakeTrashDb,
      opts: {
        liveTables?: { id: string; binding?: { mode: string; state: string } | null }[];
      } = {}
    ) => {
      const orphanDeletes: { sql: string; params: unknown[] }[] = [];
      const prismaService = {
        tableMeta: {
          findMany: async ({ where }: any) => {
            const ids: string[] = where.id.in;
            return (opts.liveTables ?? [])
              .filter((table) => ids.includes(table.id))
              .map((table) => ({
                id: table.id,
                base: { space: { dataDbBinding: table.binding ?? null } },
              }));
          },
        },
        spaceDataDbBinding: {
          findMany: async () => [],
          updateMany: async () => ({ count: 0 }),
        },
      };
      const metaFallbackDataPrismaService = {
        $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
          if (sql.includes('count(*)')) {
            // the backlog count: one (reason, cutoff) pair per removal reason
            const [tableIds, ...pairs] = params as [string[], ...unknown[]];
            let count = 0;
            for (let i = 0; i < pairs.length; i += 2) {
              const reason = pairs[i] as string;
              const cutoff = pairs[i + 1] as Date;
              count += db.rows.filter(
                (r) => tableIds.includes(r.tableId) && r.reason === reason && r.createdTime < cutoff
              ).length;
            }
            return [{ count: String(count) }];
          }
          // the recursive-CTE distinct table listing
          return [...new Set(db.rows.map((r) => r.tableId))].sort().map((tableId) => ({ tableId }));
        },
        // the orphan sweep delete
        $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
          orphanDeletes.push({ sql, params });
          const [tableIds, cutoff] = params as [string[], Date];
          const before = db.rows.length;
          db.rows = db.rows.filter(
            (r) => !(tableIds.includes(r.tableId) && r.createdTime < cutoff)
          );
          return before - db.rows.length;
        },
      };
      const dataDbClientManager = {
        getDataDatabaseUrlForTable: async () =>
          'postgresql://user:pass@localhost:5432/teable?schema=public',
        // the keyset buffer read on the native pg client, executed through the
        // leased per-table connection (? binds, UTC naive timestamp strings
        // both ways)
        withDataKnexConnectionForTable: async (
          _tableId: string,
          fn: (knex: unknown, connection: unknown) => Promise<unknown>
        ) =>
          fn(
            {
              raw: (sql: string, bindings: unknown[]) => ({
                connection: async () => {
                  let i = 0;
                  const next = () => bindings[i++];
                  const tableId = next() as string;
                  const reason = next() as string;
                  const cutoff = new Date(`${next()}Z`);
                  const rangeCount = (sql.match(/"created_time" >= \?/g) ?? []).length;
                  const ranges = Array.from({ length: rangeCount }, () => ({
                    lo: new Date(`${next()}Z`),
                    hi: new Date(`${next()}Z`),
                  }));
                  let after: { t: number; id: string } | undefined;
                  if (sql.includes('COLLATE "C") > (')) {
                    after = { t: new Date(`${next()}Z`).getTime(), id: next() as string };
                  }
                  const limit = Number(/LIMIT (\d+)/.exec(sql)![1]);
                  const selected = db.rows
                    .filter((r) => {
                      if (r.tableId !== tableId || r.reason !== reason) return false;
                      if (!(r.createdTime < cutoff)) return false;
                      if (
                        ranges.length > 0 &&
                        !ranges.some(
                          (range) => r.createdTime >= range.lo && r.createdTime < range.hi
                        )
                      ) {
                        return false;
                      }
                      if (after) {
                        const t = r.createdTime.getTime();
                        if (t < after.t || (t === after.t && r.id <= after.id)) return false;
                      }
                      return true;
                    })
                    .sort((a, b) => {
                      const delta = a.createdTime.getTime() - b.createdTime.getTime();
                      if (delta !== 0) return delta;
                      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
                    })
                    .slice(0, limit);
                  return {
                    rows: selected.map((r) => ({
                      id: r.id,
                      recordId: r.recordId,
                      snapshot: r.snapshot,
                      createdTime: r.createdTime.toISOString(),
                      createdBy: r.createdBy,
                      operationId: r.operationId ?? null,
                      recordCreatedTime: r.recordCreatedTime?.toISOString() ?? null,
                      recordCreatedBy: r.recordCreatedBy ?? null,
                      recordLastModifiedTime: r.recordLastModifiedTime?.toISOString() ?? null,
                      recordLastModifiedBy: r.recordLastModifiedBy ?? null,
                    })),
                  };
                },
              }),
            },
            {}
          ),
        dataPrismaForTable: async () => ({
          // snapshot-consistent delete: count latch + delete in one "transaction"
          $transaction: async (fn: (tx: any) => Promise<unknown>) =>
            fn({
              $queryRawUnsafe: async (_sql: string, ...params: unknown[]) => {
                const [tableId, reason, cutoff] = params as [string, string, Date];
                return [{ count: db.countFor(tableId, reason, cutoff) }];
              },
              $executeRawUnsafe: async (_sql: string, ...params: unknown[]) => {
                const [tableId, reason, cutoff] = params as [string, string, Date];
                return db.deleteFor(tableId, reason, cutoff);
              },
            }),
        }),
      };
      const databaseRouter = {
        queryDataPrismaForTable: async (_tableId: string, sql: string, ...params: unknown[]) => {
          if (sql.includes('GROUP BY')) {
            // planBucketCoverage: per-bucket count + created_time bounds
            const [tableId, reason, cutoff, dayWindowStart] = params as [
              string,
              string,
              Date,
              Date,
            ];
            const groups = new Map<
              string,
              { yyyymm: string; dd: string | null; count: number; min: Date; max: Date }
            >();
            for (const r of db.rows) {
              if (r.tableId !== tableId || r.reason !== reason || !(r.createdTime < cutoff)) {
                continue;
              }
              const yyyymm = `${r.createdTime.getUTCFullYear()}${String(
                r.createdTime.getUTCMonth() + 1
              ).padStart(2, '0')}`;
              const dd =
                r.createdTime >= dayWindowStart
                  ? String(r.createdTime.getUTCDate()).padStart(2, '0')
                  : null;
              const key = `${yyyymm}/${dd ?? 'm'}`;
              const group = groups.get(key) ?? {
                yyyymm,
                dd,
                count: 0,
                min: r.createdTime,
                max: r.createdTime,
              };
              group.count += 1;
              if (r.createdTime < group.min) group.min = r.createdTime;
              if (r.createdTime > group.max) group.max = r.createdTime;
              groups.set(key, group);
            }
            return [...groups.values()].map((g) => ({ ...g, count: String(g.count) }));
          }
          if (sql.includes('count(*)')) {
            // the reconcile pre-check count
            db.onReconcileCount?.();
            db.onReconcileCount = undefined;
            const [tableId, reason, cutoff] = params as [string, string, Date];
            return [{ count: String(db.countFor(tableId, reason, cutoff)) }];
          }
          throw new Error(`unhandled queryDataPrismaForTable sql: ${sql}`);
        },
      };
      const flusher = new RecordRemovalFlusherService(
        prismaService as any,
        metaFallbackDataPrismaService as any,
        dataDbClientManager as any,
        databaseRouter as any,
        storage
      );
      return { flusher, orphanDeletes };
    };

    it('flushes rows past each reason horizon while young rows stay buffered', async () => {
      const now = Date.now();
      const db = new FakeTrashDb();
      db.insert(
        trashRow({
          id: 'trsArchOld',
          tableId: 'tblA',
          reason: 'archived',
          createdTime: new Date(now - 60 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsArchYoung',
          tableId: 'tblA',
          reason: 'archived',
          createdTime: new Date(now - 1 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsDelYoung',
          tableId: 'tblA',
          reason: 'deleted',
          createdTime: new Date(now - 1 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsDelOld',
          tableId: 'tblA',
          reason: 'deleted',
          createdTime: new Date(now - 100 * DAY_MS),
        })
      );
      const { flusher } = makeFlusherHarness(db, { liveTables: [{ id: 'tblA' }] });

      const result = await flusher.runFlush({ mode: 'incremental' });

      // per-reason horizons, both 30d by default (recycle-bin reads merge PG + S3
      // exactly like the archive UI)
      const started = new Date(result.startedAt).getTime();
      expect(started - new Date(result.cutoffs.archived).getTime()).toBe(30 * DAY_MS);
      expect(started - new Date(result.cutoffs.deleted).getTime()).toBe(30 * DAY_MS);

      const archived = result.tables.find((t) => t.reason === 'archived')!;
      const deleted = result.tables.find((t) => t.reason === 'deleted')!;
      expect(archived).toMatchObject({ tableId: 'tblA', rows: 1, deletedRows: 1 });
      expect(deleted).toMatchObject({ tableId: 'tblA', rows: 1, deletedRows: 1 });

      // the young side of each horizon survives in the buffer, and is not backlog
      expect(db.rows.map((r) => r.id).sort()).toEqual(['trsArchYoung', 'trsDelYoung']);
      expect(result.backlogRows).toBe(0);

      // each reason landed under its own prefix, with its own stats file
      const parts = [...fake.objects.keys()]
        .map((key) => parsePartKey(ROOT, key))
        .filter((part): part is IParsedPartKey => Boolean(part));
      const archivedKeys = parts.filter((p) => p.reason === 'archived').map((p) => p.key);
      const deletedKeys = parts.filter((p) => p.reason === 'deleted').map((p) => p.key);
      expect((await decodeParts(storage, archivedKeys)).map((r) => r.id)).toEqual(['trsArchOld']);
      expect((await decodeParts(storage, deletedKeys)).map((r) => r.id)).toEqual(['trsDelOld']);
      expect(fake.objects.has(statsKey(ROOT, 'tblA', 'archived'))).toBe(true);
      expect(fake.objects.has(statsKey(ROOT, 'tblA', 'deleted'))).toBe(true);
    });

    it('reports the rows an upload-only run leaves behind as backlog', async () => {
      const now = Date.now();
      const db = new FakeTrashDb();
      db.insert(
        trashRow({
          id: 'trsArchOld',
          tableId: 'tblA',
          reason: 'archived',
          createdTime: new Date(now - 60 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsDelOld',
          tableId: 'tblA',
          reason: 'deleted',
          createdTime: new Date(now - 100 * DAY_MS),
        })
      );
      const { flusher } = makeFlusherHarness(db, { liveTables: [{ id: 'tblA' }] });

      const result = await flusher.runFlush({ mode: 'incremental', deleteEnabled: false });

      // uploaded but not deleted, so both rows stay archivable
      expect(result.totalRows).toBe(2);
      expect(result.backlogRows).toBe(2);
    });

    it('expands each table into independent (table, reason) work items', async () => {
      const now = Date.now();
      const db = new FakeTrashDb();
      // tblB has ONLY archived rows; the deleted-reason item still runs (and
      // reports zero) instead of being silently dropped
      db.insert(
        trashRow({
          id: 'trsB1',
          tableId: 'tblB',
          reason: 'archived',
          createdTime: new Date(now - 90 * DAY_MS),
        })
      );
      const { flusher } = makeFlusherHarness(db, { liveTables: [{ id: 'tblB' }] });

      const result = await flusher.runFlush({ mode: 'incremental' });

      expect(result.tables.map((t) => `${t.tableId}/${t.reason}`).sort()).toEqual([
        'tblB/archived',
        'tblB/deleted',
      ]);
      const idle = result.tables.find((t) => t.reason === 'deleted')!;
      expect(idle).toMatchObject({ rows: 0, parts: 0, deletedRows: 0 });
      expect(idle.error).toBeUndefined();
      expect(result.tables.find((t) => t.reason === 'archived')!.rows).toBe(1);
    });

    it('a count-latch mismatch defers the delete instead of losing the straggler', async () => {
      const now = Date.now();
      const cutoff = new Date(now - 30 * DAY_MS);
      const db = new FakeTrashDb();
      db.insert(
        trashRow({
          id: 'trs01',
          tableId: 'tblL',
          reason: 'archived',
          createdTime: new Date(now - 60 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trs02',
          tableId: 'tblL',
          reason: 'archived',
          createdTime: new Date(now - 59 * DAY_MS),
        })
      );
      const { flusher } = makeFlusherHarness(db);
      // a straggler write lands BELOW the cutoff between the stream and the count
      db.onReconcileCount = () => {
        db.insert(
          trashRow({
            id: 'trs00straggler',
            tableId: 'tblL',
            reason: 'archived',
            createdTime: new Date(now - 45 * DAY_MS),
          })
        );
      };

      const result = await flusher.flushTable('tblL', 'archived', cutoff, 'incremental', true);

      expect(result.rows).toBe(2);
      expect(result.deletedRows).toBe(0);
      expect(result.deleteSkippedReason).toContain('count-mismatch');
      // nothing was deleted — the straggler is re-flushed by the next run
      expect(db.rows).toHaveLength(3);
    });

    it('the coverage plan skips fully-persisted buckets and only reconciles + deletes', async () => {
      const now = Date.now();
      const cutoff = new Date(now - 40 * DAY_MS);
      const db = new FakeTrashDb();
      for (let i = 0; i < 3; i++) {
        db.insert(
          trashRow({
            id: `trsCov${i}`,
            tableId: 'tblCov',
            reason: 'archived',
            createdTime: new Date(now - 100 * DAY_MS + i * 60 * 60 * 1000),
          })
        );
      }
      const { flusher } = makeFlusherHarness(db);

      // run 1: upload-only (delete gate off) — parts + stats land, buffer intact
      const run1 = await flusher.flushTable('tblCov', 'archived', cutoff, 'incremental', false);
      expect(run1.rows).toBe(3);
      expect(run1.parts).toBeGreaterThan(0);
      expect(run1.deletedRows).toBe(0);
      expect(db.rows).toHaveLength(3);
      const keysAfterRun1 = [...fake.objects.keys()].sort();

      // run 2 (delete-enabled): the buckets are already fully persisted, so
      // nothing streams or uploads — the run only reconciles and deletes
      const run2 = await flusher.flushTable('tblCov', 'archived', cutoff, 'incremental', true);
      expect(run2.rows).toBe(0);
      expect(run2.parts).toBe(0);
      expect(run2.reconciledRows).toBe(3);
      expect(run2.deletedRows).toBe(3);
      expect([...fake.objects.keys()].sort()).toEqual(keysAfterRun1); // no rewrite
      expect(db.rows).toHaveLength(0);
    });

    it('the orphan sweep clears hard-deleted tables and spares live and byodb-routed ones', async () => {
      const now = Date.now();
      const db = new FakeTrashDb();
      db.insert(
        trashRow({
          id: 'trsLive',
          tableId: 'tblLive',
          reason: 'archived',
          createdTime: new Date(now - 90 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsOrphan',
          tableId: 'tblOrphan',
          reason: 'deleted',
          createdTime: new Date(now - 90 * DAY_MS),
        })
      );
      db.insert(
        trashRow({
          id: 'trsByodb',
          tableId: 'tblByodb',
          reason: 'archived',
          createdTime: new Date(now - 90 * DAY_MS),
        })
      );
      const { flusher, orphanDeletes } = makeFlusherHarness(db, {
        liveTables: [
          { id: 'tblLive' },
          { id: 'tblByodb', binding: { mode: 'byodb', state: 'ready' } },
        ],
      });
      const cutoffs = {
        archived: new Date(now - 30 * DAY_MS),
        deleted: new Date(now - 1200 * DAY_MS),
      };
      const orphanCleanup = { enabled: true, deletedRows: 0 };

      const groups = await (flusher as any).discoverGroups(
        { mode: 'incremental' },
        cutoffs,
        orphanCleanup
      );

      // only the live shared table is flushed; the byodb-routed one is served
      // elsewhere and the orphan appears in no group
      expect(groups).toEqual([{ kind: 'shared', tableIds: ['tblLive'] }]);
      // exactly one delete, scoped to the orphan id, bounded by the ARCHIVED
      // (newer) cutoff, both reasons at once
      expect(orphanDeletes).toHaveLength(1);
      expect(orphanDeletes[0].sql).toContain('DELETE FROM "record_trash"');
      expect(orphanDeletes[0].params[0]).toEqual(['tblOrphan']);
      expect(orphanDeletes[0].params[1]).toBe(cutoffs.archived);
      expect(orphanCleanup.deletedRows).toBe(1);
      expect(db.rows.map((r) => r.tableId).sort()).toEqual(['tblByodb', 'tblLive']);
    });

    describe('deep-read assertions', () => {
      // `count` archived buffer rows spanning ~4 months of removedTimes: the
      // young side lands in day buckets, the old side in month buckets,
      // groups of 3 share a removedTime (the id byte-order tiebreak lands on
      // many page boundaries) and ids mix cases (byte order ≠ a ci collation)
      const seedDeepArchivedRows = (db: FakeTrashDb, tableId: string, count: number) => {
        const now = Date.now();
        for (let i = 0; i < count; i++) {
          const suffix = String(i).padStart(5, '0');
          db.insert(
            trashRow({
              id: `rms${i % 2 === 0 ? 'A' : 'a'}${suffix}`,
              tableId,
              reason: 'archived',
              createdTime: new Date(now - 2 * DAY_MS - Math.floor(i / 3) * 3 * 60 * 60 * 1000),
              recordId: `rec${suffix}`,
              snapshot: JSON.stringify({
                id: `rec${suffix}`,
                fields: { fldA: `值-ünïq-${suffix}` },
              }),
            })
          );
        }
      };

      // the canonical serving order the parts are written in: removedTime
      // DESC, id DESC in byte order
      const expectedServingIds = (rows: { id: string; createdTime: Date }[]) =>
        rows
          .map((row) => ({ id: row.id, removedTime: row.createdTime.toISOString() }))
          .sort(compareRemovalRowDesc)
          .map((row) => row.id);

      // page the cold archive top-to-bottom, decoding each rms1: cursor into
      // the next page's boundary exactly like the EE seam does
      const pageThroughArchived = async (tableId: string, limit: number) => {
        const readService = new RecordRemovalColdReadService(storage);
        const rows: IColdRemovalRow[] = [];
        let pages = 0;
        let boundary: { k: string; id: string } | undefined;
        for (;;) {
          const page = await readService.collectArchivedRows({
            tableId,
            reason: 'archived',
            limit,
            orderBy: 'removedTime',
            direction: 'desc',
            boundary,
            seenIds: new Set<string>(),
          });
          pages += 1;
          rows.push(...page.rows);
          if (!page.nextCursor) return { rows, pages };
          const decoded = decodeRemovalColdCursor(page.nextCursor)?.boundary;
          if (!decoded) throw new Error(`page ${pages} handed back a boundary-less cursor`);
          boundary = decoded;
          if (pages > 1000) throw new Error('cursor traversal did not converge');
        }
      };

      it('100-page deep cursor traversal is duplicate-free and gap-free over 3000 rows', async () => {
        const db = new FakeTrashDb();
        seedDeepArchivedRows(db, 'tblDeep', 3000);
        const inserted = [...db.rows];
        const { flusher } = makeFlusherHarness(db, { liveTables: [{ id: 'tblDeep' }] });

        const result = await flusher.runFlush({
          mode: 'incremental',
          archiveHorizonMs: 60 * 60 * 1000,
        });
        const archived = result.tables.find((t) => t.reason === 'archived')!;
        expect(archived).toMatchObject({ tableId: 'tblDeep', rows: 3000, deletedRows: 3000 });
        expect(db.rows).toHaveLength(0);
        // several months and many parts: pages cross bucket/part seams constantly
        expect((await storage.listMonths('tblDeep', 'archived')).length).toBeGreaterThanOrEqual(4);
        expect(result.totalParts).toBeGreaterThanOrEqual(10);

        const { rows, pages } = await pageThroughArchived('tblDeep', 30);
        expect(pages).toBe(100);
        const ids = rows.map((row) => row.id);
        expect(new Set(ids).size).toBe(3000); // no duplicates
        // exact total order end to end — no gaps, no reordering anywhere in
        // the 100-page traversal
        expect(ids).toEqual(expectedServingIds(inserted));
      });

      it('point lookups return rows byte-identical to what deep paging surfaces', async () => {
        const db = new FakeTrashDb();
        seedDeepArchivedRows(db, 'tblBytes', 900);
        const { flusher } = makeFlusherHarness(db, { liveTables: [{ id: 'tblBytes' }] });
        await flusher.runFlush({ mode: 'incremental', archiveHorizonMs: 60 * 60 * 1000 });

        const { rows } = await pageThroughArchived('tblBytes', 100);
        expect(rows).toHaveLength(900);
        const byRecordId = new Map(rows.map((row) => [row.recordId, row]));

        // sample across the whole range: both ends, the middle, tie-group mates
        const sample = [0, 1, 2, 449, 450, 451, 897, 898, 899].map(
          (i) => `rec${String(i).padStart(5, '0')}`
        );
        const readService = new RecordRemovalColdReadService(storage);
        const found = await readService.lookupArchivedRowsByRecordIds({
          tableId: 'tblBytes',
          reason: 'archived',
          recordIds: sample,
        });
        expect(found.size).toBe(sample.length);
        for (const recordId of sample) {
          const paged = byRecordId.get(recordId)!;
          const looked = found.get(recordId)!;
          // byte-identical snapshot across the two entry points…
          expect(looked.snapshot).toBe(paged.snapshot);
          // …and the whole row agrees field for field
          expect(looked).toEqual(paged);
        }
      });

      it('a second flush into the same bucket folds A∪B losslessly and heals superseded parts', async () => {
        const now = Date.now();
        const cutoff = new Date(now - DAY_MS);
        const dayBase = new Date(now - 5 * DAY_MS);
        dayBase.setUTCHours(2, 0, 0, 0);
        const at = (minute: number) => new Date(dayBase.getTime() + minute * 60_000);
        // small parts force each flush to cut several files in the ONE bucket
        const smallParts = { ...recordRemovalColdConfig(), partUncompressedBytes: 2048 };
        const db = new FakeTrashDb();
        const { flusher } = makeFlusherHarness(db);
        const insertBatch = (batch: 'A' | 'B') => {
          for (let i = 0; i < 40; i++) {
            const suffix = String(i).padStart(3, '0');
            db.insert(
              trashRow({
                id: `rms${batch}${suffix}`,
                tableId: 'tblTwice',
                reason: 'archived',
                // even B rows TIE an A row's removedTime exactly; odd ones
                // interleave between A rows (and push the bucket max past A's)
                createdTime: batch === 'A' || i % 2 === 0 ? at(i * 2) : at(i * 2 + 1),
                recordId: `rec${batch}${suffix}`,
                snapshot: JSON.stringify({
                  id: `rec${batch}${suffix}`,
                  fields: { fldA: `${batch}-${suffix}-${'x'.repeat(120)}` },
                }),
              })
            );
          }
        };

        insertBatch('A');
        const inserted = [...db.rows];
        const run1 = await flusher.flushTable(
          'tblTwice',
          'archived',
          cutoff,
          'incremental',
          true,
          smallParts
        );
        expect(run1).toMatchObject({ rows: 40, deletedRows: 40 });
        expect(run1.parts).toBeGreaterThan(1);
        const partKeysA = [...fake.objects.keys()].filter((key) => parsePartKey(ROOT, key));
        expect(partKeysA).toHaveLength(run1.parts);

        insertBatch('B');
        inserted.push(...db.rows);
        const run2 = await flusher.flushTable(
          'tblTwice',
          'archived',
          cutoff,
          'incremental',
          true,
          smallParts
        );
        // the bucket was NOT judged covered (B changed its aggregate): the
        // whole bucket re-streamed, folding A's parts through the feeder
        expect(run2).toMatchObject({ rows: 40, deletedRows: 40, reconciledRows: 0 });
        expect(db.rows).toHaveLength(0);

        // every superseded first-run key healed away; stats track exactly the
        // live keys of the single (yyyymm, dd) bucket
        for (const key of partKeysA) {
          expect(fake.objects.has(key)).toBe(false);
        }
        const yyyymm = `${dayBase.getUTCFullYear()}${String(dayBase.getUTCMonth() + 1).padStart(2, '0')}`;
        const dd = String(dayBase.getUTCDate()).padStart(2, '0');
        const liveParts = await storage.listMonthParts('tblTwice', 'archived', yyyymm);
        expect(liveParts.every((part) => part.kind === 'day' && part.dd === dd)).toBe(true);
        const stats = await storage.readStats('tblTwice', 'archived');
        expect(Object.keys(stats!.parts).sort()).toEqual(liveParts.map((p) => p.key).sort());

        // A∪B exactly once each, in canonical order, via a full page-through
        const { rows } = await pageThroughArchived('tblTwice', 7);
        expect(new Set(rows.map((row) => row.id)).size).toBe(80);
        expect(rows.map((row) => row.id)).toEqual(expectedServingIds(inserted));
      });
    });
  });

  describe('flush byte budget', () => {
    it('defers remaining work items once the byte budget is spent', async () => {
      const flusher = new RecordRemovalFlusherService(
        ...([null, null, null, null, null] as unknown as ConstructorParameters<
          typeof RecordRemovalFlusherService
        >)
      );
      (flusher as unknown as { flushTable: unknown }).flushTable = async (
        tableId: string,
        reason: ColdRemovalReason
      ): Promise<ITableFlushResult> => ({
        tableId,
        reason,
        rows: 1,
        parts: 1,
        uncompressedBytes: 8 * 1024,
        compressedBytes: 1024,
        deletedRows: 1,
        reconciledRows: 0,
        truncatedRows: 0,
        durationMs: 1,
      });

      // 2 tables × 2 reasons at concurrency 1: the first item spends the whole byte budget
      const result = await flusher.runFlush({
        mode: 'incremental',
        tableIds: ['tblA', 'tblB'],
        tableConcurrency: 1,
        maxBytes: 8 * 1024,
      });

      expect(result.budgetExhausted).toBe(true);
      expect(result.leftoverTables).toBe(3);
      expect(result.tables).toHaveLength(1);
    });
  });

  describe('cold maintenance processor', () => {
    class FakeColdQueue {
      jobs: { id?: string; name: string; data: unknown; state: string; opts?: unknown }[] = [];
      schedulers: { key: string }[] = [];

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
        // record-history catch-up chain tripped over in production
        if (opts?.jobId?.includes(':')) {
          throw new Error('Custom Id cannot contain :');
        }
        // mirrors BullMQ's dedupe: a custom id matching ANY still-stored job
        // returns the EXISTING job instead of adding
        const existing = opts?.jobId && this.jobs.find((job) => job.id === opts.jobId);
        if (existing) {
          return existing;
        }
        const job = { id: opts?.jobId, name, data, state: 'delayed', opts };
        this.jobs.push(job);
        return job;
      }
    }

    const makeProcessor = (
      queue: FakeColdQueue,
      flushResult: Partial<IColdFlushRunResult> = {},
      runFlushCalls?: unknown[]
    ) => {
      const flusher = {
        runFlush: async (options: unknown): Promise<IColdFlushRunResult> => {
          runFlushCalls?.push(options);
          return {
            startedAt: '2026-07-17T00:00:00.000Z',
            cutoffs: {
              archived: '2026-06-17T00:00:00.000Z',
              deleted: '2023-04-04T00:00:00.000Z',
            },
            mode: 'incremental',
            tables: [],
            totalRows: 0,
            totalParts: 0,
            totalCompressedBytes: 0,
            totalTruncatedRows: 0,
            orphanRowsDeleted: 0,
            durationMs: 1,
            leftoverTables: 0,
            budgetExhausted: false,
            backlogRows: 0,
            ...flushResult,
          };
        },
      };
      return new RecordRemovalColdProcessor(
        flusher as never,
        {} as never,
        {} as never,
        queue as never
      );
    };

    beforeEach(() => {
      delete process.env.BACKEND_STORAGE_COLD_ARCHIVE_DISABLED;
    });

    afterEach(() => {
      delete process.env.BACKEND_STORAGE_COLD_ARCHIVE_DISABLED;
    });

    it('chains a catch-up job with a colon-free id when the budget is exhausted', async () => {
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue, { budgetExhausted: true, leftoverTables: 3 });

      await processor.process({ name: 'record-removal-cold:flush', data: {} } as any);

      const chained = queue.jobs.filter((job) =>
        job.id?.startsWith('record-removal-cold-flush-catchup')
      );
      expect(chained).toHaveLength(1);
      expect(chained[0].id).toBe('record-removal-cold-flush-catchup-1');
      expect(chained[0].data).toEqual({ catchupHop: 1 });
    });

    it('increments the hop id along the chain', async () => {
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue, { budgetExhausted: true });

      await processor.process({
        id: 'record-removal-cold-flush-catchup-2',
        name: 'record-removal-cold:flush',
        data: { catchupHop: 2 },
      } as any);

      expect(queue.jobs.map((job) => job.id)).toEqual(['record-removal-cold-flush-catchup-3']);
    });

    it('stops chaining once the hop budget is spent', async () => {
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue, { budgetExhausted: true });

      // hop 3 is the last one the default budget (3) allows
      await processor.process({
        id: 'record-removal-cold-flush-catchup-3',
        name: 'record-removal-cold:flush',
        data: { catchupHop: 3 },
      } as any);

      expect(queue.jobs).toHaveLength(0);
    });

    it('registers both schedulers at bootstrap and queues nothing else', async () => {
      const queue = new FakeColdQueue();
      await makeProcessor(queue).onApplicationBootstrap();
      expect(queue.schedulers.map((scheduler) => scheduler.key)).toEqual([
        'record-removal-cold:flush',
        'record-removal-cold:compact',
      ]);
      // deliberately no boot-time kick (see the 2026-07-08 record-history stalls)
      expect(queue.jobs).toHaveLength(0);
    });

    it('does not start a second chain while one is pending', async () => {
      const queue = new FakeColdQueue();
      queue.jobs.push({
        id: 'record-removal-cold-flush-catchup-9',
        name: 'record-removal-cold:flush',
        data: { catchupHop: 9 },
        state: 'delayed',
      });
      const processor = makeProcessor(queue, { budgetExhausted: true });

      await processor.process({ name: 'record-removal-cold:flush', data: {} } as any);

      expect(queue.jobs).toHaveLength(1);
    });

    it('a kill-switched process skips cold jobs instead of consuming them', async () => {
      process.env.BACKEND_STORAGE_COLD_ARCHIVE_DISABLED = 'true';
      const queue = new FakeColdQueue();
      const runFlushCalls: unknown[] = [];
      const processor = makeProcessor(queue, { budgetExhausted: true }, runFlushCalls);

      const result = await processor.process({
        name: 'record-removal-cold:flush',
        data: {},
      } as any);

      expect(result).toBeUndefined();
      expect(runFlushCalls).toHaveLength(0);
      expect(queue.jobs).toHaveLength(0); // no catch-up chained either
    });

    it('a kill-switched process pauses its worker and registers no schedulers', async () => {
      process.env.BACKEND_STORAGE_COLD_ARCHIVE_DISABLED = 'true';
      const queue = new FakeColdQueue();
      const processor = makeProcessor(queue);
      const paused: boolean[] = [];
      // WorkerHost's `worker` getter reads _worker (set by the Bull explorer in
      // a real process); the pause(true) path is what a kill-switched pod takes
      (processor as any)._worker = {
        pause: async (force: boolean) => {
          paused.push(force);
        },
      };

      await processor.onApplicationBootstrap();

      expect(paused).toEqual([true]);
      expect(queue.schedulers).toEqual([]);
    });
  });
});
