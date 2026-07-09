import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { PassThrough, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import type { IColdHistoryRow, IPartBucket, IPartStatsEntry } from './part-codec';
import {
  buildPartKey,
  buildRecordBloom,
  createPartCompressor,
  createRowHasher,
  iteratePartRows,
  serializeFooter,
  serializeHeader,
  serializeRow,
  STATS_SET_CAP,
} from './part-codec';

/** minimal storage surface so the writer is unit-testable without a real bucket */
export interface IPartStore {
  upload(key: string, stream: Readable): Promise<void>;
  download(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

export interface IPartWriterOptions {
  store: IPartStore;
  rootDir: string;
  tableId: string;
  bucket: IPartBucket;
  /** cut a new part once this many uncompressed bytes are written */
  partUncompressedBytes: number;
  startSeq?: number;
}

export interface IPartWriteMetrics {
  parts: number;
  rows: number;
  uncompressedBytes: number;
  compressedBytes: number;
}

interface IOpenPart {
  key: string;
  seq: number;
  input: PassThrough;
  uploadPromise: Promise<void>;
  hasher: ReturnType<typeof createRowHasher>;
  rows: number;
  uncompressedBytes: number;
  compressedBytes: { value: number };
  minRecordId: string;
  maxRecordId: string;
  minCreatedTime: string;
  maxCreatedTime: string;
  fieldIds: Set<string> | null;
  createdBys: Set<string> | null;
  /** distinct record ids (input is record-major sorted, so boundaries suffice) */
  recordIds: string[];
}

/**
 * Streams rows (already sorted by recordId, createdTime, id) into ~fixed-size
 * compressed NDJSON parts: open upload on first row, cut on the uncompressed
 * threshold, verify each uploaded part by re-downloading and re-counting.
 * Memory stays O(stream buffers), independent of table size.
 */
export class PartWriter {
  private seq: number;
  private current: IOpenPart | undefined;
  private readonly entries: IPartStatsEntry[] = [];
  /** per-writer key component: concurrent same-bucket runs never collide */
  private readonly runToken = randomBytes(3).toString('hex');
  readonly metrics: IPartWriteMetrics = {
    parts: 0,
    rows: 0,
    uncompressedBytes: 0,
    compressedBytes: 0,
  };

  constructor(private readonly options: IPartWriterOptions) {
    this.seq = options.startSeq ?? 0;
  }

  get bucket() {
    return this.options.bucket;
  }

  get maxWrittenSeq(): number {
    return this.seq - 1;
  }

  async add(row: IColdHistoryRow): Promise<void> {
    if (!this.current) {
      this.current = this.openPart(row);
    }
    const part = this.current;
    const line = serializeRow(row);
    part.hasher.update(line);
    part.rows += 1;
    part.uncompressedBytes += Buffer.byteLength(line) + 1;
    if (row.recordId !== part.maxRecordId) {
      part.recordIds.push(row.recordId);
    }
    part.maxRecordId = row.recordId;
    if (row.createdTime < part.minCreatedTime) part.minCreatedTime = row.createdTime;
    if (row.createdTime > part.maxCreatedTime) part.maxCreatedTime = row.createdTime;
    if (part.fieldIds) {
      part.fieldIds.add(row.fieldId);
      if (part.fieldIds.size > STATS_SET_CAP) part.fieldIds = null;
    }
    if (part.createdBys) {
      part.createdBys.add(row.createdBy);
      if (part.createdBys.size > STATS_SET_CAP) part.createdBys = null;
    }
    await this.write(part, `${line}\n`);
    if (part.uncompressedBytes >= this.options.partUncompressedBytes) {
      await this.closeCurrent();
    }
  }

  /** flush the open part (if any) and return the stats entries of all parts written */
  async finish(): Promise<IPartStatsEntry[]> {
    await this.closeCurrent();
    return this.entries;
  }

  private openPart(firstRow: IColdHistoryRow): IOpenPart {
    const { store, rootDir, tableId, bucket } = this.options;
    const seq = this.seq++;
    const key = buildPartKey(rootDir, tableId, bucket, seq, firstRow.recordId, this.runToken);
    const input = new PassThrough();
    const compressor = createPartCompressor();
    const compressedBytes = { value: 0 };
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        compressedBytes.value += chunk.length;
        callback(null, chunk);
      },
    });
    const uploadPromise = store.upload(key, input.pipe(compressor).pipe(counter));
    // surface upload failures at closeCurrent() while unblocking any writer
    // currently awaiting backpressure drain on the input stream
    uploadPromise.catch((error) => {
      input.destroy(error instanceof Error ? error : new Error(String(error)));
    });
    const part: IOpenPart = {
      key,
      seq,
      input,
      uploadPromise,
      hasher: createRowHasher(),
      rows: 0,
      uncompressedBytes: 0,
      compressedBytes,
      minRecordId: firstRow.recordId,
      maxRecordId: firstRow.recordId,
      minCreatedTime: firstRow.createdTime,
      maxCreatedTime: firstRow.createdTime,
      fieldIds: new Set<string>(),
      createdBys: new Set<string>(),
      recordIds: [firstRow.recordId],
    };
    // header is not part of the row hash
    part.input.write(`${serializeHeader(tableId, bucket)}\n`);
    return part;
  }

  private async write(part: IOpenPart, chunk: string): Promise<void> {
    if (!part.input.write(chunk)) {
      await once(part.input, 'drain');
    }
  }

  private async closeCurrent(): Promise<void> {
    const part = this.current;
    if (!part) return;
    this.current = undefined;
    const sha256 = part.hasher.digest();
    part.input.end(`${serializeFooter(part.rows, sha256)}\n`);
    await part.uploadPromise;
    try {
      await this.verifyPart(part.key, part.rows, sha256);
    } catch (error) {
      // readers and rewrites discover parts by listing keys, so a part that
      // failed verification must not stay under the live prefix
      await this.options.store.delete(part.key).catch(() => undefined);
      throw error;
    }
    this.entries.push({
      key: part.key,
      rows: part.rows,
      minCreatedTime: part.minCreatedTime,
      maxCreatedTime: part.maxCreatedTime,
      minRecordId: part.minRecordId,
      maxRecordId: part.maxRecordId,
      fieldIds: part.fieldIds ? [...part.fieldIds].sort() : null,
      createdBys: part.createdBys ? [...part.createdBys].sort() : null,
      recordBloom: buildRecordBloom(part.recordIds, part.recordIds.length),
    });
    this.metrics.parts += 1;
    this.metrics.rows += part.rows;
    this.metrics.uncompressedBytes += part.uncompressedBytes;
    this.metrics.compressedBytes += part.compressedBytes.value;
  }

  private async verifyPart(key: string, expectedRows: number, expectedSha: string): Promise<void> {
    const stream = await this.options.store.download(key);
    const hasher = createRowHasher();
    let rows = 0;
    let footerRows: number | undefined;
    let footerSha: string | undefined;
    for await (const item of iteratePartRows(key, stream)) {
      if (item.footer) {
        footerRows = item.footer.rows;
        footerSha = item.footer.sha256;
        continue;
      }
      if (item.rowLine !== undefined) {
        rows += 1;
        hasher.update(item.rowLine);
      }
    }
    const sha = hasher.digest();
    if (rows !== expectedRows || sha !== expectedSha || footerRows !== rows || footerSha !== sha) {
      throw new Error(
        `record-history cold part verification failed for ${key}: ` +
          `rows local=${expectedRows} remote=${rows} footer=${footerRows}, ` +
          `sha local=${expectedSha.slice(0, 12)} remote=${sha.slice(0, 12)} footer=${footerSha?.slice(0, 12)}`
      );
    }
  }
}
