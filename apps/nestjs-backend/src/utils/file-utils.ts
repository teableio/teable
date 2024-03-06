import crypto from 'crypto';
import { createReadStream } from 'node:fs';
import { pipeline, Readable as ReadableStream } from 'node:stream';
import { promisify } from 'node:util';

const pipelineAsync = promisify(pipeline);

export class FileUtils {
  static async getHash(path: string): Promise<string>;
  static async getHash(stream: ReadableStream): Promise<string>;
  static async getHash(buffer: Buffer): Promise<string>;
  /**
   * Implements the overloaded method. Uses argument type checking to determine the logic to execute.
   * @param input A file path, ReadStream, or Buffer.
   * @returns A promise that resolves with the hex-encoded hash.
   */
  static async getHash(input: string | ReadableStream | Buffer): Promise<string> {
    let stream: ReadableStream;

    if (typeof input === 'string') {
      // If input is a file path, create a read stream.
      stream = createReadStream(input);
    } else if (Buffer.isBuffer(input)) {
      // If input is a Buffer, convert it to a stream.
      stream = ReadableStream.from(input);
    } else {
      // If input is already a stream, use it as is.
      stream = input;
    }

    const hash = crypto.createHash('sha256');

    await pipelineAsync(stream, hash);

    return hash.digest('hex');
  }
}
