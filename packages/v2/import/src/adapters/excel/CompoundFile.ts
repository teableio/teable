import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';

import { DiskFile } from './DiskStringTable';
import type { TemporaryWorkbook } from './TemporaryWorkbook';

const endOfChain = 0xfffffffe;
type CompoundEntry = { start: number; size: number; name: string; type: number };

/** Disk-backed allocation tables and bounded sector access for an OLE compound file. */
class CompoundFile {
  private readonly header: Buffer;
  private readonly sectorSize: number;
  private readonly maxSectors: number;
  private readonly fat: DiskFile;

  constructor(
    private readonly input: DiskFile,
    private readonly owner: TemporaryWorkbook
  ) {
    this.header = input.read(0, 512);
    this.sectorSize = 2 ** this.header.readUInt16LE(30);
    if (![512, 4096].includes(this.sectorSize) || this.header.readUInt16LE(32) !== 6) {
      throw new Error('Invalid XLS compound-file sector size');
    }
    this.maxSectors = Math.floor(input.size / this.sectorSize) - 1;
    this.fat = new DiskFile(join(owner.directory, 'fat'), owner, true);
  }

  private sector(id: number): Buffer {
    if (id < 0 || id >= this.maxSectors) throw new Error('Invalid XLS compound-file sector');
    return this.input.read((id + 1) * this.sectorSize, this.sectorSize);
  }

  private appendFatSectors(data: Buffer, start: number, end: number, remaining: number): number {
    let written = 0;
    for (let offset = start; offset < end && written < remaining; offset += 4) {
      const id = data.readUInt32LE(offset);
      if (id >= 0xfffffffa) continue;
      this.fat.append(this.sector(id));
      written++;
    }
    return written;
  }

  async readFat(): Promise<void> {
    const fatCount = this.header.readUInt32LE(44);
    const difatCount = this.header.readUInt32LE(72);
    if (difatCount > this.maxSectors || fatCount > this.maxSectors)
      throw new Error('Invalid XLS FAT length');
    let written = this.appendFatSectors(this.header, 76, 512, fatCount);
    let difat = this.header.readUInt32LE(68);
    for (let index = 0; index < difatCount; index++) {
      const data = this.sector(difat);
      written += this.appendFatSectors(data, 0, this.sectorSize - 4, fatCount - written);
      difat = data.readUInt32LE(this.sectorSize - 4);
      if (index % 128 === 0) await setImmediate();
    }
    if (written !== fatCount) throw new Error('Truncated XLS FAT');
  }

  private *chain(start: number, table = this.fat, limit = this.maxSectors): Generator<number> {
    let id = start;
    let count = 0;
    while (id !== endOfChain) {
      if (++count > limit || id >= 0xfffffffa)
        throw new Error('Cyclic or invalid XLS sector chain');
      yield id;
      id = table.read(id * 4, 4).readUInt32LE(0);
    }
  }

  private directoryEntry(bytes: Buffer): CompoundEntry | undefined {
    const type = bytes[66];
    if (type !== 2 && type !== 5) return;
    const nameLength = bytes.readUInt16LE(64);
    if (nameLength < 2 || nameLength > 64) throw new Error('Invalid XLS directory name');
    const size =
      this.header.readUInt16LE(26) === 3
        ? bytes.readUInt32LE(120)
        : Number(bytes.readBigUInt64LE(120));
    if (!Number.isSafeInteger(size) || size > this.input.size)
      throw new Error('Invalid XLS stream length');
    return {
      type,
      size,
      start: bytes.readUInt32LE(116),
      name: bytes.subarray(0, nameLength - 2).toString('utf16le'),
    };
  }

  private *directory(): Generator<CompoundEntry> {
    for (const id of this.chain(this.header.readUInt32LE(48))) {
      const data = this.sector(id);
      for (let offset = 0; offset < this.sectorSize; offset += 128) {
        const entry = this.directoryEntry(data.subarray(offset, offset + 128));
        if (entry) yield entry;
      }
    }
  }

  private async copySectors(
    entry: CompoundEntry,
    output: DiskFile,
    truncatedMessage: string
  ): Promise<void> {
    let remaining = entry.size;
    let count = 0;
    for (const id of this.chain(entry.start)) {
      const length = Math.min(remaining, this.sectorSize);
      output.append(this.sector(id).subarray(0, length));
      remaining -= length;
      if (!remaining) break;
      if (++count % 128 === 0) await setImmediate();
    }
    if (remaining) throw new Error(truncatedMessage);
  }

  private async copyMiniStream(
    workbook: CompoundEntry,
    root: CompoundEntry,
    output: DiskFile
  ): Promise<void> {
    const miniFat = new DiskFile(join(this.owner.directory, 'mini-fat'), this.owner, true);
    for (const id of this.chain(this.header.readUInt32LE(60))) miniFat.append(this.sector(id));
    const miniStream = new DiskFile(join(this.owner.directory, 'mini-stream'), this.owner, true);
    await this.copySectors(root, miniStream, 'Truncated XLS mini-stream');
    let remaining = workbook.size;
    for (const id of this.chain(workbook.start, miniFat, Math.ceil(root.size / 64))) {
      const length = Math.min(remaining, 64);
      output.append(miniStream.read(id * 64, length));
      remaining -= length;
      if (!remaining) break;
    }
    if (remaining) throw new Error('Truncated XLS workbook mini-stream');
  }

  async workbook(): Promise<DiskFile> {
    let root: CompoundEntry | undefined;
    let workbook: CompoundEntry | undefined;
    for (const entry of this.directory()) {
      if (entry.type === 5) root = entry;
      else if (entry.name === 'Workbook' || (entry.name === 'Book' && !workbook)) workbook = entry;
    }
    if (!workbook) throw new Error('XLS compound file has no Workbook or Book stream');
    const output = new DiskFile(join(this.owner.directory, 'biff'), this.owner, true);
    if (workbook.size >= this.header.readUInt32LE(56)) {
      await this.copySectors(workbook, output, 'Truncated XLS workbook stream');
    } else {
      if (!root) throw new Error('Missing XLS root mini-stream');
      await this.copyMiniStream(workbook, root, output);
    }
    return output;
  }
}

/** Extracts only Workbook/Book, walking FAT and miniFAT through disk pages. */
export async function openBiffStream(owner: TemporaryWorkbook): Promise<DiskFile> {
  const input = new DiskFile(owner.path, owner);
  if (input.size < 8 || input.read(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') return input;
  const compound = new CompoundFile(input, owner);
  await compound.readFat();
  return compound.workbook();
}
