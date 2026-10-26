import { Buffer } from 'node:buffer';

import unzipper from 'unzipper';

/**
 * DotTea (`.tea`) is a zip archive whose only required entry is `structure.json`.
 *
 * Repro artifacts build that archive in memory. `unzipper` only reads, so the
 * writer below is a minimal store-only zip encoder (no compression, fixed
 * timestamp) that keeps artifacts byte-deterministic. It is not a new export
 * format: the payload is the same `structure.json` the base export writes.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
// 1980-01-01 00:00:00 keeps artifacts independent of the wall clock.
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = 0x21;
const UTF8_FLAG = 0x0800;

export const writeDotTeaZip = (structure: unknown): Buffer => {
  const name = Buffer.from('structure.json', 'utf8');
  const data = Buffer.from(JSON.stringify(structure, null, 2), 'utf8');
  const checksum = crc32(data);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(UTF8_FLAG, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(FIXED_DOS_TIME, 10);
  localHeader.writeUInt16LE(FIXED_DOS_DATE, 12);
  localHeader.writeUInt32LE(checksum, 14);
  localHeader.writeUInt32LE(data.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(UTF8_FLAG, 8);
  centralHeader.writeUInt16LE(0, 10);
  centralHeader.writeUInt16LE(FIXED_DOS_TIME, 12);
  centralHeader.writeUInt16LE(FIXED_DOS_DATE, 14);
  centralHeader.writeUInt32LE(checksum, 16);
  centralHeader.writeUInt32LE(data.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42);

  const localOffset = 0;
  const centralOffset = localHeader.length + name.length + data.length;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(1, 8);
  endRecord.writeUInt16LE(1, 10);
  endRecord.writeUInt32LE(centralHeader.length + name.length, 12);
  endRecord.writeUInt32LE(centralOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  centralHeader.writeUInt32LE(localOffset, 42);

  return Buffer.concat([localHeader, name, data, centralHeader, name, endRecord]);
};

export const readDotTeaStructure = async (
  source: { type: 'path'; path: string } | { type: 'buffer'; data: Uint8Array }
): Promise<unknown> => {
  const zip =
    source.type === 'path'
      ? await unzipper.Open.file(source.path)
      : await unzipper.Open.buffer(Buffer.from(source.data));
  const entry = zip.files.find((file: unzipper.File) => file.path === 'structure.json');
  if (!entry) throw new Error('structure.json not found in dottea file');
  return JSON.parse((await entry.buffer()).toString('utf-8')) as unknown;
};
