import crypto from 'crypto';
import * as fs from 'fs';
import { Readable as ReadableStream } from 'node:stream';
import { FileUtils } from './file-utils';

vi.mock('fs');

describe('FileUtils', () => {
  it('should generate hash from file path', async () => {
    vi.spyOn(fs, 'createReadStream').mockReturnValueOnce(
      new ReadableStream({
        read() {
          this.push('file content');
          this.push(null);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any
    );

    const hash = await FileUtils.getHash('test/to/file.txt');
    const expectedHash = crypto.createHash('sha256').update('file content').digest('hex');
    expect(hash).toBe(expectedHash);
  });

  it('should generate hash from ReadableStream', async () => {
    const stream = new ReadableStream({
      read() {
        this.push('stream content');
        this.push(null);
      },
    });
    const hash = await FileUtils.getHash(stream);
    const expectedHash = crypto.createHash('sha256').update('stream content').digest('hex');
    expect(hash).toBe(expectedHash);
  });

  it('should generate hash from Buffer', async () => {
    const buffer = Buffer.from('buffer content');
    const hash = await FileUtils.getHash(buffer);
    const expectedHash = crypto.createHash('sha256').update('buffer content').digest('hex');
    expect(hash).toBe(expectedHash);
  });
});
