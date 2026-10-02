import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import type { TemporaryWorkbook } from './TemporaryWorkbook';

const pageSize = 64 * 1024;

/** A single read page and a single append page, regardless of file size. */
export class DiskFile {
  private readonly fd: number;
  private readPage = Buffer.allocUnsafe(pageSize);
  private readStart = -1;
  private readLength = 0;
  private writePage = Buffer.allocUnsafe(pageSize);
  private pending = 0;
  private closed = false;
  size: number;

  constructor(path: string, owner: TemporaryWorkbook, writable = false) {
    this.fd = openSync(path, writable ? 'w+' : 'r', 0o600);
    this.size = fstatSync(this.fd).size;
    owner.own(() => this.close());
  }

  read(position: number, length: number): Buffer {
    if (!Number.isSafeInteger(position) || position < 0 || position + length > this.size) {
      throw new Error('Truncated Excel file');
    }
    this.flush();
    const result = Buffer.allocUnsafe(length);
    let copied = 0;
    while (copied < length) {
      const at = position + copied;
      if (this.readStart < 0 || at < this.readStart || at >= this.readStart + this.readLength) {
        this.readStart = Math.floor(at / pageSize) * pageSize;
        this.readLength = readSync(this.fd, this.readPage, 0, pageSize, this.readStart);
      }
      const available = Math.min(length - copied, this.readLength - (at - this.readStart));
      if (available <= 0) throw new Error('Truncated Excel file');
      this.readPage.copy(result, copied, at - this.readStart, at - this.readStart + available);
      copied += available;
    }
    return result;
  }

  append(bytes: Uint8Array): number {
    const start = this.size;
    let offset = 0;
    while (offset < bytes.length) {
      const length = Math.min(pageSize - this.pending, bytes.length - offset);
      this.writePage.set(bytes.subarray(offset, offset + length), this.pending);
      this.pending += length;
      this.size += length;
      offset += length;
      if (this.pending === pageSize) this.flush();
    }
    return start;
  }

  write(position: number, bytes: Uint8Array): void {
    this.flush();
    this.writeAll(bytes, position);
    this.size = Math.max(this.size, position + bytes.length);
    this.readStart = -1;
  }

  flush(): void {
    if (!this.pending) return;
    this.writeAll(this.writePage.subarray(0, this.pending), this.size - this.pending);
    this.pending = 0;
    this.readStart = -1;
  }

  private writeAll(bytes: Uint8Array, position: number): void {
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(this.fd, bytes, written, bytes.length - written, position + written);
      if (!count) throw new Error('Unable to write temporary Excel file');
      written += count;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.flush();
    } finally {
      closeSync(this.fd);
      this.readPage = Buffer.alloc(0);
      this.writePage = Buffer.alloc(0);
    }
  }
}

/** Fixed-width disk offsets, not an array of offsets or a shared-string cache. */
export class DiskStringTable {
  private readonly data: DiskFile;
  private readonly index: DiskFile;
  private count = 0;

  constructor(owner: TemporaryWorkbook, name: string) {
    this.data = new DiskFile(join(owner.directory, `${name}.data`), owner, true);
    this.index = new DiskFile(join(owner.directory, `${name}.index`), owner, true);
  }

  append(value: string): number {
    const index = this.count++;
    this.set(index, value);
    return index;
  }

  set(index: number, value: string): void {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid Excel string index');
    const bytes = Buffer.from(value, 'utf8');
    const entry = Buffer.allocUnsafe(12);
    // Offset + 1 distinguishes a missing sparse entry from an empty string.
    entry.writeDoubleLE(this.data.append(bytes) + 1, 0);
    entry.writeUInt32LE(bytes.length, 8);
    if (index * 12 === this.index.size) this.index.append(entry);
    else this.index.write(index * 12, entry);
  }

  get(index: number): string | undefined {
    if (!Number.isSafeInteger(index) || index < 0 || index * 12 + 12 > this.index.size) return;
    const entry = this.index.read(index * 12, 12);
    const position = entry.readDoubleLE(0) - 1;
    if (position < 0) return;
    return this.data.read(position, entry.readUInt32LE(8)).toString('utf8');
  }
}

/** Disk hash chains keep arbitrary SpreadsheetML style IDs out of a growing Map. */
export class DiskStringMap {
  private readonly buckets: DiskStringTable;
  private readonly entries: DiskStringTable;

  constructor(owner: TemporaryWorkbook, name: string) {
    this.buckets = new DiskStringTable(owner, `${name}-buckets`);
    this.entries = new DiskStringTable(owner, `${name}-entries`);
  }

  private bucket(key: string): number {
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++)
      hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
    return hash & 0xffff;
  }

  set(key: string, value: string): void {
    const bucket = this.bucket(key);
    const next = this.buckets.get(bucket);
    const index = this.entries.append(JSON.stringify({ key, value, next }));
    this.buckets.set(bucket, String(index));
  }

  get(key: string): string | undefined {
    let index = this.buckets.get(this.bucket(key));
    while (index !== undefined) {
      const raw = this.entries.get(Number(index));
      if (raw === undefined) throw new Error('Invalid temporary Excel style index');
      const entry: { key: string; value: string; next?: string } = JSON.parse(raw);
      if (entry.key === key) return entry.value;
      index = entry.next;
    }
  }
}
