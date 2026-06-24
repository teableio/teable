import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export interface ISpilledLinkRow {
  teableRecordId: string;
  cells: Array<{ airtableFieldId: string; ids: string[] }>;
}

/**
 * Minimal IO the spill needs; the importer backs it with the deployment's
 * StorageAdapter (local, S3 or MinIO) — the same staging pattern the .tea
 * import uses, no container-local temp files.
 */
export interface ISpillStorage {
  upload(path: string, data: Buffer): Promise<void>;
  download(path: string): Promise<Readable>;
  /** Removes everything under the given directory prefix. */
  cleanup(dir: string): Promise<void>;
}

const defaultSpillMaxBytes = 2 * 1024 * 1024 * 1024; // 2 GiB
const partMaxBytes = 4 * 1024 * 1024; // 4 MiB per uploaded part

const getSpillMaxBytes = () => {
  const fromEnv = Number(process.env.TEABLE_IMPORT_SPILL_MAX_BYTES);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : defaultSpillMaxBytes;
};

/**
 * Staging area for the link cells collected during record import. Link values
 * can only be written after every table's records exist (the old->new record
 * id mapping must be complete), so rows are buffered — as JSONL parts in the
 * blob storage, keeping the importer's memory flat for large bases.
 */
export class AirtableLinkRowSpill {
  private readonly dir = `airtable-import/${randomUUID()}`;
  private readonly pending = new Map<string, { lines: string[]; bytes: number }>();
  private readonly parts = new Map<string, string[]>();
  private readonly maxBytes: number;
  private bytesWritten = 0;
  private uploadedAnything = false;

  constructor(
    private readonly storage: ISpillStorage,
    maxBytes = getSpillMaxBytes()
  ) {
    this.maxBytes = maxBytes;
  }

  async append(airtableTableId: string, rows: ISpilledLinkRow[]): Promise<void> {
    if (rows.length === 0) return;
    let pending = this.pending.get(airtableTableId);
    if (!pending) {
      pending = { lines: [], bytes: 0 };
      this.pending.set(airtableTableId, pending);
    }
    let addedBytes = 0;
    for (const row of rows) {
      const line = `${JSON.stringify(row)}\n`;
      pending.lines.push(line);
      addedBytes += Buffer.byteLength(line);
    }
    pending.bytes += addedBytes;
    this.bytesWritten += addedBytes;
    if (this.bytesWritten > this.maxBytes) {
      throw new Error(
        `The import link buffer exceeded ${this.maxBytes} bytes of staging storage; ` +
          'raise TEABLE_IMPORT_SPILL_MAX_BYTES to import this base'
      );
    }
    if (pending.bytes >= partMaxBytes) {
      await this.flushPart(airtableTableId);
    }
  }

  private async flushPart(airtableTableId: string): Promise<void> {
    const pending = this.pending.get(airtableTableId);
    if (!pending || pending.lines.length === 0) return;
    const parts = this.parts.get(airtableTableId) ?? [];
    const partPath = `${this.dir}/${airtableTableId}.part-${String(parts.length).padStart(5, '0')}.jsonl`;
    await this.storage.upload(partPath, Buffer.from(pending.lines.join('')));
    parts.push(partPath);
    this.parts.set(airtableTableId, parts);
    this.pending.delete(airtableTableId);
    this.uploadedAnything = true;
  }

  /** Streams the table's rows back, part by part, line by line. */
  async *read(airtableTableId: string): AsyncGenerator<ISpilledLinkRow> {
    await this.flushPart(airtableTableId);
    for (const partPath of this.parts.get(airtableTableId) ?? []) {
      const stream = await this.storage.download(partPath);
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        if (line.trim()) {
          yield JSON.parse(line) as ISpilledLinkRow;
        }
      }
    }
  }

  async cleanup(): Promise<void> {
    this.pending.clear();
    this.parts.clear();
    if (this.uploadedAnything) {
      await this.storage.cleanup(this.dir);
    }
  }
}
