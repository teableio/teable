import { randomBytes } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import archiver from 'archiver';
import * as unzipper from 'unzipper';
import { describe, expect, it } from 'vitest';

// A stored entry written from a stream has a data descriptor, so a streaming parser only finds
// its end by scanning for the descriptor signature. Zip-based attachments (docx/pptx/xlsx)
// contain that signature in their own bytes. unzipper is patched (patches/unzipper@0.12.3.patch)
// to accept a match only when the descriptor's size equals the bytes read; without the patch
// the parser stops inside the entry and fails with "invalid signature" / "write after end".
const dataDescriptorSignature = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

const embeddedZipLikeBytes = () =>
  Buffer.concat([
    randomBytes(1000),
    dataDescriptorSignature,
    randomBytes(12),
    randomBytes(1000),
    dataDescriptorSignature,
    randomBytes(500),
  ]);

const buildZip = async (entries: { name: string; data: Buffer; store?: boolean }[]) => {
  const archive = archiver('zip');
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  archive.pipe(output);
  for (const { name, data, store } of entries) {
    archive.append(Readable.from([data]), { name, store });
  }
  await archive.finalize();
  return Buffer.concat(chunks);
};

const streamParse = async (zip: Buffer, chunkSize: number) => {
  const parsed: Record<string, Buffer> = {};
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < zip.length; offset += chunkSize) {
    chunks.push(zip.subarray(offset, offset + chunkSize));
  }
  await new Promise<void>((resolve, reject) => {
    const parser = unzipper.Parse();
    parser.on('entry', (entry: unzipper.Entry) => {
      entry
        .buffer()
        .then((buffer) => {
          parsed[entry.path] = buffer;
        })
        .catch(reject);
    });
    parser.on('error', reject);
    parser.on('close', resolve);
    Readable.from(chunks).pipe(parser);
  });
  return parsed;
};

describe('streaming .tea parse', () => {
  it.each([65536, 7])(
    'reads stored entries containing the descriptor signature (chunk size %i)',
    async (chunkSize) => {
      const pptx = embeddedZipLikeBytes();
      const docx = embeddedZipLikeBytes();
      const zip = await buildZip([
        { name: 'structure.json', data: Buffer.from('{"tables":[]}') },
        { name: 'attachments/a.pptx', data: pptx, store: true },
        { name: 'attachments/b.docx', data: docx },
        { name: 'tables/tbl.csv', data: Buffer.from('a,b\n1,2\n') },
      ]);

      const parsed = await streamParse(zip, chunkSize);

      expect(Object.keys(parsed)).toEqual([
        'structure.json',
        'attachments/a.pptx',
        'attachments/b.docx',
        'tables/tbl.csv',
      ]);
      expect(parsed['attachments/a.pptx'].equals(pptx)).toBe(true);
      expect(parsed['attachments/b.docx'].equals(docx)).toBe(true);
      expect(parsed['tables/tbl.csv'].toString()).toBe('a,b\n1,2\n');
    }
  );
});
