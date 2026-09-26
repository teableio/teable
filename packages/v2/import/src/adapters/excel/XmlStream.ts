import type { Readable } from 'node:stream';

import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { SSF } from 'xlsx';

export const localName = (name: string) => name.slice(name.indexOf(':') + 1);
export const attribute = (tag: SaxesTagPlain, name: string): string | undefined => {
  for (const key in tag.attributes) {
    if (localName(key) === name) return tag.attributes[key];
  }
};

export const excelText = (text: string) =>
  text.replace(/_x([\da-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

export const formatCellValue = (
  value: number | string,
  format: string | number = 0,
  date1904 = false
): string => {
  try {
    return String(SSF.format(format, value, { date1904 }));
  } catch {
    // SheetJS likewise falls back to the raw value on an invalid format.
    return String(value);
  }
};

export const excelDateSerial = (timestamp: number, date1904: boolean): number => {
  const serial = timestamp / 86400000 + 25569;
  if (date1904) return serial - 1462;
  // The 1900 epoch includes a fictional February 29 only from March 1 onward.
  return serial < 61 ? serial - 1 : serial;
};

export function workbookTextDecoder(bytes: Buffer): TextDecoder {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0))
    return new TextDecoder('utf-16le');
  if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c))
    return new TextDecoder('utf-16be');
  const declared = bytes
    .subarray(0, 512)
    .toString('latin1')
    .match(/(?:encoding\s*=\s*["']\s*|charset\s*=\s*["']?)([\w-]+)/i)?.[1];
  return new TextDecoder(declared ?? 'utf-8');
}

export function assertExcelIndex(index: number, limit: number, kind: string): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= limit)
    throw new Error(`Invalid Excel ${kind} index: ${index}`);
}

export async function* parseXml<T>(
  stream: Readable,
  configure: (parser: SaxesParser<{ xmlns: false }>, emit: (value: T) => void) => void
): AsyncGenerator<T> {
  const queue: T[] = [];
  const parser = new SaxesParser({ xmlns: false });
  configure(parser, (value) => queue.push(value));
  let decoder: TextDecoder | undefined;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decoder ??= workbookTextDecoder(bytes);
      for (let offset = 0; offset < bytes.length; offset += 65536) {
        parser.write(decoder.decode(bytes.subarray(offset, offset + 65536), { stream: true }));
        for (const value of queue) yield value;
        queue.length = 0;
      }
    }
    parser.write(decoder?.decode() ?? '').close();
    for (const value of queue) yield value;
  } finally {
    queue.length = 0;
    stream.destroy();
  }
}
