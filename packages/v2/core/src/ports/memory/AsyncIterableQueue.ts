export interface AsyncIterableQueueOptions {
  /**
   * Maximum buffered items retained when the consumer is slower than the
   * producer. Oldest buffered items are dropped first to cap memory growth.
   */
  readonly maxBufferedItems?: number;
}

export class AsyncIterableQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  constructor(private readonly options: AsyncIterableQueueOptions = {}) {}

  push(value: T): boolean {
    if (this.closed) {
      return false;
    }

    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return true;
    }

    const maxBufferedItems = this.options.maxBufferedItems;
    if (
      maxBufferedItems !== undefined &&
      maxBufferedItems > 0 &&
      this.values.length >= maxBufferedItems
    ) {
      this.values.shift();
    }

    this.values.push(value);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    while (this.resolvers.length) {
      this.resolvers.shift()?.({ value: undefined as T, done: true });
    }
  }

  abort(): void {
    this.values.length = 0;
    this.close();
  }

  isClosed(): boolean {
    return this.closed;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        if (this.values.length) {
          return { value: this.values.shift() as T, done: false };
        }

        if (this.closed) {
          return { value: undefined as T, done: true };
        }

        return await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: async () => {
        this.abort();
        return { value: undefined as T, done: true };
      },
      throw: async (error?: unknown) => {
        this.abort();
        throw error;
      },
    };
  }
}
