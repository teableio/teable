import { posix } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';

import { open, type ZipFile } from 'yauzl';

import { DiskStringMap, DiskStringTable } from './DiskStringTable';
import type { PhysicalExcelRow, StreamingWorkbook, TemporaryWorkbook } from './TemporaryWorkbook';
import {
  assertExcelIndex,
  attribute,
  excelDateSerial,
  excelText,
  formatCellValue,
  localName,
  parseXml,
} from './XmlStream';

async function entryStream(owner: TemporaryWorkbook, name: string): Promise<Readable | undefined> {
  return new Promise<Readable | undefined>((resolve, reject) => {
    open(owner.path, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error || !zip) {
        reject(error ?? new Error('Invalid ZIP workbook'));
        return;
      }
      let stream: Readable | undefined;
      owner.own(() => {
        stream?.destroy();
        zip.close();
      });
      zip.on('error', (cause: Error) => {
        stream?.destroy(cause);
        zip.close();
        reject(cause);
      });
      zip.on('end', () => {
        zip.close();
        resolve(undefined);
      });
      zip.on('entry', (entry: Parameters<ZipFile['openReadStream']>[0]) => {
        if (entry.fileName !== name) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (cause, opened) => {
          if (cause || !opened) {
            zip.close();
            reject(cause ?? new Error('Invalid ZIP entry'));
            return;
          }
          // yauzl's stored-entry FdSlicer marks itself destroyed before EOF. Pipe
          // into a modern bounded stream; directly async-iterating it can hang.
          const readable = new PassThrough({ highWaterMark: 65536 });
          stream = readable;
          opened.on('error', (error: Error) => readable.destroy(error));
          readable.once('close', () => {
            opened.destroy();
            zip.close();
          });
          opened.pipe(readable);
          resolve(readable);
        });
      });
      zip.readEntry();
    });
  });
}

const resolveTarget = (base: string, target: string) =>
  target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.join(posix.dirname(base), target);

function columnIndex(reference: string | undefined, fallback: number): number {
  if (!reference) {
    assertExcelIndex(fallback, 16384, 'column');
    return fallback;
  }
  const address = /^([A-Z]+)([1-9]\d*)$/i.exec(reference);
  if (!address) throw new Error('Invalid Excel cell reference');
  assertExcelIndex(Number(address[2]) - 1, 1048576, 'cell row');
  let column = 0;
  for (const letter of address[1]) column = column * 26 + letter.toUpperCase().charCodeAt(0) - 64;
  assertExcelIndex(column - 1, 16384, 'column');
  return column - 1;
}

export class ZipWorkbook implements StreamingWorkbook {
  readonly sheets: Array<{ name: string; index: number; id: string; path?: string }> = [];
  private readonly strings: DiskStringTable;
  private readonly formats: DiskStringMap;
  private readonly styles: DiskStringTable;
  private date1904 = false;

  private constructor(private readonly owner: TemporaryWorkbook) {
    this.strings = new DiskStringTable(owner, 'shared-strings');
    this.formats = new DiskStringMap(owner, 'number-formats');
    this.styles = new DiskStringTable(owner, 'cell-styles');
  }

  static async open(owner: TemporaryWorkbook): Promise<ZipWorkbook> {
    const workbook = new ZipWorkbook(owner);
    let workbookPath = 'xl/workbook.xml';
    const packageRels = await entryStream(owner, '_rels/.rels');
    if (packageRels) {
      for await (const target of parseXml<string>(packageRels, (parser, emit) => {
        parser.on('opentag', (tag) => {
          if (
            localName(tag.name) === 'Relationship' &&
            attribute(tag, 'Type')?.endsWith('/officeDocument')
          ) {
            const value = attribute(tag, 'Target');
            if (value) emit(value.startsWith('/') ? value.slice(1) : posix.normalize(value));
          }
        });
      }))
        workbookPath = target;
    }
    const metadata = await entryStream(owner, workbookPath);
    if (!metadata) throw new Error(`Missing Excel workbook XML: ${workbookPath}`);
    for await (const unused of parseXml<never>(metadata, (parser) => {
      parser.on('opentag', (tag) => {
        if (localName(tag.name) === 'workbookPr')
          workbook.date1904 = /^(?:1|true)$/.test(attribute(tag, 'date1904') ?? '');
        if (localName(tag.name) === 'sheet') {
          workbook.sheets.push({
            name: excelText(attribute(tag, 'name') ?? ''),
            index: workbook.sheets.length,
            id: attribute(tag, 'id') ?? '',
          });
        }
      });
    }))
      void unused;
    let stringsPath: string | undefined;
    let stylesPath: string | undefined;
    const relationships = await entryStream(
      owner,
      posix.join(posix.dirname(workbookPath), '_rels', `${posix.basename(workbookPath)}.rels`)
    );
    if (relationships) {
      for await (const unused of parseXml<never>(relationships, (parser) => {
        parser.on('opentag', (tag) => {
          if (localName(tag.name) !== 'Relationship' || attribute(tag, 'TargetMode') === 'External')
            return;
          const target = attribute(tag, 'Target');
          if (!target) return;
          const path = resolveTarget(workbookPath, target);
          const type = attribute(tag, 'Type');
          if (type?.endsWith('/sharedStrings')) stringsPath = path;
          else if (type?.endsWith('/styles')) stylesPath = path;
          const sheet = workbook.sheets.find((item) => item.id === attribute(tag, 'Id'));
          if (sheet) sheet.path = path;
        });
      }))
        void unused;
    }
    if (stylesPath) await workbook.readStyles(stylesPath);
    if (stringsPath) await workbook.readStrings(stringsPath);
    return workbook;
  }

  private async readStyles(path: string): Promise<void> {
    const stream = await entryStream(this.owner, path);
    if (!stream) return;
    let inCellXfs = false;
    for await (const unused of parseXml<never>(stream, (parser) => {
      parser.on('opentag', (tag) => {
        const name = localName(tag.name);
        if (name === 'numFmt')
          this.formats.set(
            attribute(tag, 'numFmtId') ?? '0',
            attribute(tag, 'formatCode') ?? 'General'
          );
        if (name === 'cellXfs') inCellXfs = true;
        if (name === 'xf' && inCellXfs) this.styles.append(attribute(tag, 'numFmtId') ?? '0');
      });
      parser.on('closetag', (tag) => {
        if (localName(tag.name) === 'cellXfs') inCellXfs = false;
      });
    }))
      void unused;
  }

  private async readStrings(path: string): Promise<void> {
    const stream = await entryStream(this.owner, path);
    if (!stream) throw new Error('Missing Excel shared strings');
    let text = '';
    let inText = false;
    let phonetic = false;
    for await (const value of parseXml<string>(stream, (parser, emit) => {
      parser.on('opentag', (tag) => {
        const name = localName(tag.name);
        if (name === 'si') text = '';
        if (name === 'rPh') phonetic = true;
        if (name === 't' && !phonetic) inText = true;
      });
      parser.on('text', (part) => {
        if (inText) text += part;
      });
      parser.on('cdata', (part) => {
        if (inText) text += part;
      });
      parser.on('closetag', (tag) => {
        const name = localName(tag.name);
        if (name === 't') inText = false;
        if (name === 'rPh') phonetic = false;
        if (name === 'si') {
          emit(excelText(text));
          text = '';
        }
      });
    }))
      this.strings.append(value);
  }

  private cellFormat(style: number): string | number {
    const formatId = Number(this.styles.get(style) ?? 0);
    return this.formats.get(String(formatId)) ?? formatId;
  }

  private formattedNumericCell(type: string, style: number, value: string): string | undefined {
    const format = this.cellFormat(style);
    if (type === 'd') {
      const timestamp = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
      const serial = excelDateSerial(timestamp, this.date1904);
      return formatCellValue(serial, format, this.date1904);
    }
    if (value !== '') return formatCellValue(Number(value), format, this.date1904);
  }

  private formattedCell(
    type: string,
    style: number,
    value: string,
    inline: string
  ): string | undefined {
    switch (type) {
      case 's': {
        const shared = value.trim() ? this.strings.get(Number(value)) : undefined;
        if (shared === undefined) throw new Error('Invalid Excel shared-string index');
        return formatCellValue(shared, this.cellFormat(style), this.date1904);
      }
      case 'inlineStr':
        return formatCellValue(excelText(inline), this.cellFormat(style), this.date1904);
      case 'b':
        return value === '1' || value === 'true' ? 'TRUE' : 'FALSE';
      case 'str':
        return formatCellValue(excelText(value), this.cellFormat(style), this.date1904);
      case 'e':
        return excelText(value);
      default:
        return this.formattedNumericCell(type, style, value);
    }
  }

  async *rows(name: string): AsyncGenerator<PhysicalExcelRow> {
    const sheet = this.sheets.find((item) => item.name === name);
    if (!sheet?.path) throw new Error(`Missing Excel worksheet: ${name}`);
    const stream = await entryStream(this.owner, sheet.path);
    if (!stream) throw new Error(`Missing Excel worksheet: ${sheet.path}`);
    let rowIndex = -1;
    let values: string[] = [];
    let column = -1;
    let type = '';
    let style = 0;
    let value = '';
    let inline = '';
    let capturing = '';
    let hasValue = false;
    let phonetic = false;
    let inCell = false;
    let lastRow = -1;
    yield* parseXml<PhysicalExcelRow>(stream, (parser, emit) => {
      parser.on('opentag', (tag) => {
        const name = localName(tag.name);
        if (name === 'row') {
          rowIndex = Number(attribute(tag, 'r') ?? rowIndex + 2) - 1;
          assertExcelIndex(rowIndex, 1048576, 'row');
          if (rowIndex <= lastRow) throw new Error('Invalid Excel row order');
          values = [];
          column = -1;
        } else if (name === 'c') {
          column = columnIndex(attribute(tag, 'r'), column + 1);
          type = attribute(tag, 't') ?? 'n';
          style = Number(attribute(tag, 's') ?? 0);
          value = inline = capturing = '';
          hasValue = false;
          inCell = true;
        } else if (inCell && name === 'rPh') phonetic = true;
        else if (inCell && (name === 'v' || (name === 't' && !phonetic))) {
          capturing = name;
          hasValue = true;
        }
      });
      const text = (part: string) => {
        if (capturing === 'v') value += part;
        else if (capturing === 't') inline += part;
      };
      parser.on('text', text);
      parser.on('cdata', text);
      parser.on('closetag', (tag) => {
        const name = localName(tag.name);
        if (name === 'v' || name === 't') capturing = '';
        else if (name === 'rPh') phonetic = false;
        else if (name === 'c') {
          if (hasValue) {
            const formatted = this.formattedCell(type, style, value, inline);
            if (formatted !== undefined) values[column] = formatted;
          }
          inCell = false;
        } else if (name === 'row' && values.length) {
          lastRow = rowIndex;
          emit({ index: rowIndex, values });
          values = [];
        }
      });
    });
  }
}
