import { setImmediate } from 'node:timers/promises';

import { openBiffStream } from './CompoundFile';
import { DiskStringTable, type DiskFile } from './DiskStringTable';
import type { PhysicalExcelRow, StreamingWorkbook, TemporaryWorkbook } from './TemporaryWorkbook';
import { assertExcelIndex, formatCellValue } from './XmlStream';

type BiffRecord = { id: number; bytes: Buffer; next: number };
type BiffRowsState = {
  row: number;
  values: string[];
  pendingString?: number;
  pendingStringStyle: number;
};

function recordAt(file: DiskFile, offset: number): BiffRecord {
  const header = file.read(offset, 4);
  const length = header.readUInt16LE(2);
  return {
    id: header.readUInt16LE(0),
    bytes: file.read(offset + 4, length),
    next: offset + 4 + length,
  };
}

/** CONTINUE has a character-width byte only while continuing string characters. */
class BiffStringCursor {
  private offset: number;
  constructor(
    private readonly file: DiskFile,
    private record: BiffRecord,
    offset = 0
  ) {
    this.offset = offset;
  }
  get next(): number {
    return this.record.next;
  }

  private continuation(): void {
    this.record = recordAt(this.file, this.record.next);
    if (this.record.id !== 0x3c) throw new Error('Missing BIFF string continuation');
    this.offset = 0;
  }

  take(length: number): Buffer {
    const result = Buffer.allocUnsafe(length);
    let copied = 0;
    while (copied < length) {
      if (this.offset === this.record.bytes.length) this.continuation();
      const size = Math.min(length - copied, this.record.bytes.length - this.offset);
      this.record.bytes.copy(result, copied, this.offset, this.offset + size);
      this.offset += size;
      copied += size;
    }
    return result;
  }

  skip(length: number): void {
    while (length > 0) {
      if (this.offset === this.record.bytes.length) this.continuation();
      const size = Math.min(length, this.record.bytes.length - this.offset);
      this.offset += size;
      length -= size;
    }
  }

  unicode(): string {
    const count = this.take(2).readUInt16LE(0);
    const flags = this.take(1)[0];
    const runs = flags & 8 ? this.take(2).readUInt16LE(0) : 0;
    const extended = flags & 4 ? this.take(4).readUInt32LE(0) : 0;
    let wide = Boolean(flags & 1);
    let remaining = count;
    let text = '';
    while (remaining > 0) {
      if (this.offset === this.record.bytes.length) {
        this.continuation();
        wide = Boolean(this.take(1)[0] & 1);
      }
      const characters = Math.min(
        remaining,
        Math.floor((this.record.bytes.length - this.offset) / (wide ? 2 : 1))
      );
      if (!characters) throw new Error('Invalid BIFF string character boundary');
      const length = characters * (wide ? 2 : 1);
      text += this.record.bytes
        .subarray(this.offset, this.offset + length)
        .toString(wide ? 'utf16le' : 'latin1');
      this.offset += length;
      remaining -= characters;
    }
    this.skip(runs * 4 + extended);
    return text;
  }
}

const errorValues: Record<number, string> = {
  [0]: '#NULL!',
  [7]: '#DIV/0!',
  [15]: '#VALUE!',
  [23]: '#REF!',
  [29]: '#NAME?',
  [36]: '#NUM!',
  [42]: '#N/A',
  [43]: '#GETTING_DATA',
};

const codepageLabels: Record<number, string> = {
  [1200]: 'utf-16le',
  [65001]: 'utf-8',
  [874]: 'windows-874',
  [932]: 'shift_jis',
  [936]: 'gbk',
  [949]: 'euc-kr',
  [950]: 'big5',
  [10000]: 'macintosh',
  [28591]: 'iso-8859-1',
};

// Match SheetJS's CodePage record overrides before selecting a decoder.
const codepageAliases: Record<number, number> = {
  [0x5212]: 1200,
  [0x8000]: 10000,
  [0x8001]: 1252,
};

const cellRecordIds = [2, 3, 4, 5, 6, 0x203, 0x204, 0x205, 0x206, 0x406, 0x27e, 0xbd, 0xfd, 0xd6];

function rkNumber(bytes: Buffer, offset: number): number {
  const raw = bytes.readInt32LE(offset);
  let value: number;
  if (raw & 2) value = raw >> 2;
  else {
    const double = Buffer.alloc(8);
    double.writeInt32LE(raw & ~3, 4);
    value = double.readDoubleLE(0);
  }
  return raw & 1 ? value / 100 : value;
}

export class BiffWorkbook implements StreamingWorkbook {
  readonly sheets: Array<{ name: string; index: number; offset: number }> = [];
  private readonly strings: DiskStringTable;
  private readonly styles: DiskStringTable;
  private readonly formats: DiskStringTable;
  private version = 8;
  private date1904 = false;
  private decoder = new TextDecoder('windows-1252');
  private legacyFormatIndex = 0;

  private constructor(
    private readonly file: DiskFile,
    owner: TemporaryWorkbook
  ) {
    this.strings = new DiskStringTable(owner, 'shared-strings');
    this.styles = new DiskStringTable(owner, 'cell-styles');
    this.formats = new DiskStringTable(owner, 'number-formats');
  }

  static async open(owner: TemporaryWorkbook): Promise<BiffWorkbook> {
    const file = await openBiffStream(owner);
    const workbook = new BiffWorkbook(file, owner);
    const first = recordAt(file, 0);
    workbook.readVersion(first);
    await workbook.readGlobals();
    if (!workbook.sheets.length && first.bytes.readUInt16LE(2) === 0x10) {
      workbook.sheets.push({ name: 'Sheet1', index: 0, offset: 0 });
    }
    return workbook;
  }

  private readVersion(first: BiffRecord): void {
    switch (first.id) {
      case 9:
        this.version = 2;
        break;
      case 0x209:
        this.version = 3;
        break;
      case 0x409:
        this.version = 4;
        break;
      case 0x809:
        this.version = first.bytes.readUInt16LE(0) === 0x500 ? 5 : 8;
        break;
      default:
        throw new Error('Unrecognized XLS BIFF signature');
    }
  }

  private async readGlobals(): Promise<void> {
    let offset = 0;
    let records = 0;
    while (offset + 4 <= this.file.size) {
      const record = recordAt(this.file, offset);
      if (record.id === 0xa) break;
      await this.readGlobalRecord(record);
      offset = record.next;
      if (++records % 1024 === 0) await setImmediate();
    }
  }

  private async readGlobalRecord(record: BiffRecord): Promise<void> {
    const bytes = record.bytes;
    switch (record.id) {
      case 0x2f:
        throw new Error('Password-protected Excel workbooks are not supported');
      case 0x42: {
        const declaredCodepage = bytes.readUInt16LE(0);
        const codepage = codepageAliases[declaredCodepage] ?? declaredCodepage;
        this.decoder = new TextDecoder(codepageLabels[codepage] ?? `windows-${codepage}`);
        break;
      }
      case 0x22:
        this.date1904 = bytes.readUInt16LE(0) !== 0;
        break;
      case 0x85:
        this.readBoundSheet(bytes);
        break;
      case 0xfc:
        await this.readSharedStrings(record);
        break;
      case 0xe0:
        this.styles.append(String(bytes.readUInt16LE(2)));
        break;
      case 0x43:
        this.styles.append(String(bytes[2] & 0x3f));
        break;
      case 0x243:
      case 0x443:
        this.styles.append(String(bytes[1]));
        break;
      case 0x41e:
        this.readNumberFormat(record);
        break;
      case 0x1e:
        this.formats.set(
          this.legacyFormatIndex++,
          this.decoder.decode(bytes.subarray(1, 1 + bytes[0]))
        );
        break;
    }
  }

  private readBoundSheet(bytes: Buffer): void {
    const length = bytes[6];
    const name =
      this.version >= 8
        ? bytes
            .subarray(8, 8 + length * (bytes[7] & 1 ? 2 : 1))
            .toString(bytes[7] & 1 ? 'utf16le' : 'latin1')
        : this.decoder.decode(bytes.subarray(7, 7 + length));
    this.sheets.push({
      name: name || 'Sheet1',
      index: this.sheets.length,
      offset: bytes.readUInt32LE(0),
    });
  }

  private async readSharedStrings(record: BiffRecord): Promise<void> {
    const cursor = new BiffStringCursor(this.file, record, 8);
    const count = record.bytes.readUInt32LE(4);
    for (let index = 0; index < count; index++) {
      this.strings.append(cursor.unicode());
      if (index % 1024 === 0) await setImmediate();
    }
    record.next = cursor.next;
  }

  private readNumberFormat(record: BiffRecord): void {
    const bytes = record.bytes;
    const id = this.version <= 4 ? this.legacyFormatIndex++ : bytes.readUInt16LE(0);
    const value =
      this.version >= 8
        ? new BiffStringCursor(this.file, record, 2).unicode()
        : this.decoder.decode(bytes.subarray(3, 3 + bytes[2]));
    this.formats.set(id, value);
  }

  private formatted(value: number | string, style: number): string {
    const format = Number(this.styles.get(style) ?? 0);
    return formatCellValue(value, this.formats.get(format) ?? format, this.date1904);
  }

  private async *worksheetRecords(offset: number): AsyncGenerator<BiffRecord> {
    let depth = 0;
    let records = 0;
    while (offset + 4 <= this.file.size) {
      const record = recordAt(this.file, offset);
      if ([9, 0x209, 0x409, 0x809].includes(record.id)) depth++;
      else if (record.id === 0xa) {
        if (--depth <= 0) break;
      } else if (depth <= 1) {
        if (++records % 1024 === 0) await setImmediate();
        yield record;
      }
      // String decoders advance this over any consumed CONTINUE records.
      offset = record.next;
    }
  }

  private readText(record: BiffRecord, offset: number, countBytes: number): string {
    if (this.version >= 8) {
      const cursor = new BiffStringCursor(this.file, record, offset);
      const value = cursor.unicode();
      record.next = cursor.next;
      return value;
    }
    const count = countBytes === 1 ? record.bytes[offset] : record.bytes.readUInt16LE(offset);
    const start = offset + countBytes;
    if (start + count > record.bytes.length) throw new Error('Truncated XLS label');
    return this.decoder.decode(record.bytes.subarray(start, start + count));
  }

  private readMultipleNumbers(bytes: Buffer, column: number, values: string[]): void {
    const lastColumn = bytes.readUInt16LE(bytes.length - 2);
    assertExcelIndex(lastColumn, 256, 'column');
    if (bytes.length !== 6 + (lastColumn - column + 1) * 6)
      throw new Error('Invalid XLS multiple-number record');
    for (let at = 4, col = column; at + 6 <= bytes.length - 2; at += 6, col++) {
      values[col] = this.formatted(rkNumber(bytes, at + 2), bytes.readUInt16LE(at));
    }
  }

  private readFormula(
    bytes: Buffer,
    offset: number,
    style: number,
    column: number,
    values: string[]
  ): boolean {
    if (bytes.readUInt16LE(offset + 6) !== 0xffff) {
      values[column] = this.formatted(bytes.readDoubleLE(offset), style);
      return false;
    }
    switch (bytes[offset]) {
      case 0:
        return true;
      case 1:
        values[column] = bytes[offset + 2] ? 'TRUE' : 'FALSE';
        break;
      case 2:
        values[column] = errorValues[bytes[offset + 2]] ?? '';
        break;
      default:
        values[column] = '';
    }
    return false;
  }

  private readCell(record: BiffRecord, column: number, values: string[]): boolean {
    const bytes = record.bytes;
    // Old BIFF2 record IDs retain their seven-byte header even inside BIFF3/4.
    const legacy = this.version === 2 || (record.id >= 2 && record.id <= 5);
    const header = legacy ? 7 : 6;
    const style = legacy ? bytes[4] & 0x3f : bytes.readUInt16LE(4);
    switch (record.id) {
      case 2:
        values[column] = this.formatted(bytes.readUInt16LE(header), style);
        break;
      case 3:
      case 0x203:
        values[column] = this.formatted(bytes.readDoubleLE(header), style);
        break;
      case 0xfd: {
        const value = this.strings.get(bytes.readUInt32LE(6));
        if (value === undefined) throw new Error('Invalid XLS shared-string index');
        values[column] = this.formatted(value, style);
        break;
      }
      case 0x27e:
        values[column] = this.formatted(rkNumber(bytes, 6), style);
        break;
      case 0xbd:
        this.readMultipleNumbers(bytes, column, values);
        break;
      case 5:
      case 0x205:
        if (bytes[header + 1]) {
          values[column] = errorValues[bytes[header]] ?? '';
          break;
        }
        values[column] = bytes[header] ? 'TRUE' : 'FALSE';
        break;
      case 4:
      case 0x204:
      case 0xd6:
        values[column] = this.formatted(
          this.readText(record, header, record.id === 4 || this.version === 2 ? 1 : 2),
          style
        );
        break;
      default:
        return this.readFormula(bytes, header, style, column, values);
    }
    return false;
  }

  private advanceRow(state: BiffRowsState, nextRow: number): PhysicalExcelRow | undefined {
    if (nextRow < state.row) throw new Error('Invalid XLS row ordering');
    if (nextRow === state.row) return;
    const completed =
      state.row >= 0 && state.values.length
        ? { index: state.row, values: state.values }
        : undefined;
    state.row = nextRow;
    state.values = [];
    return completed;
  }

  private consumeRowRecord(record: BiffRecord, state: BiffRowsState): PhysicalExcelRow | undefined {
    if (record.id === 7 || record.id === 0x207) {
      if (state.pendingString !== undefined) {
        const countBytes = record.id === 7 || this.version === 2 ? 1 : 2;
        state.values[state.pendingString] = this.formatted(
          this.readText(record, 0, countBytes),
          state.pendingStringStyle
        );
        state.pendingString = undefined;
      }
      return;
    }
    if (!cellRecordIds.includes(record.id)) return;
    const nextRow = record.bytes.readUInt16LE(0);
    const column = record.bytes.readUInt16LE(2);
    assertExcelIndex(nextRow, this.version >= 8 ? 65536 : 16384, 'row');
    assertExcelIndex(column, 256, 'column');
    const completed = this.advanceRow(state, nextRow);
    if (this.readCell(record, column, state.values)) {
      state.pendingString = column;
      state.pendingStringStyle =
        this.version === 2 ? record.bytes[4] & 0x3f : record.bytes.readUInt16LE(4);
    }
    return completed;
  }

  async *rows(name: string): AsyncGenerator<PhysicalExcelRow> {
    const sheet = this.sheets.find((item) => item.name === name);
    if (!sheet) throw new Error(`Missing XLS sheet: ${name}`);
    const state: BiffRowsState = { row: -1, values: [], pendingStringStyle: 0 };
    for await (const record of this.worksheetRecords(sheet.offset)) {
      const completed = this.consumeRowRecord(record, state);
      if (completed) yield completed;
    }
    if (state.pendingString !== undefined) throw new Error('Missing XLS formula string cache');
    if (state.row >= 0 && state.values.length) yield { index: state.row, values: state.values };
  }
}
