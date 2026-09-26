import type { TransformCallback } from 'node:stream';
import { Transform } from 'node:stream';

export class BatchProcessor<T> extends Transform {
  private buffer: T[] = [];
  private totalProcessed = 0;
  public static readonly BATCH_SIZE = 1000;

  constructor(private readonly handler: (chunk: T[]) => Promise<void>) {
    super({ objectMode: true });
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _transform(chunk: T, encoding: BufferEncoding, callback: TransformCallback): void {
    this.transformAsync(chunk, encoding, callback).catch((error) => callback(error as Error));
  }

  private async transformAsync(chunk: T, encoding: BufferEncoding, callback: TransformCallback) {
    this.buffer.push(chunk);
    this.totalProcessed++;

    if (this.buffer.length >= BatchProcessor.BATCH_SIZE) {
      const currentBatch = [...this.buffer];
      this.buffer = [];

      try {
        await this.handler(currentBatch);
        this.emit('progress', { processed: this.totalProcessed });
        callback();
      } catch (err: unknown) {
        callback(err as Error);
      }
    } else {
      callback();
    }
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  _flush(callback: TransformCallback): void {
    this.flushAsync(callback).catch((error) => callback(error as Error));
  }

  private async flushAsync(callback: TransformCallback) {
    if (this.buffer.length > 0) {
      try {
        await this.handler(this.buffer);
        this.emit('progress', { processed: this.totalProcessed });
        callback();
      } catch (err: unknown) {
        callback(err as Error);
      }
    } else {
      callback();
    }
  }
}
