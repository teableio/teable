export type ExportPageReader<T> = (offset: number, limit: number) => Promise<readonly T[]>;

export interface PaginatedExportStreamOptions<T> {
  /** Number of records requested from each page. */
  readonly pageSize: number;
  /**
   * Read an authorized page in stable order. Filtering and permissions must be
   * applied before pagination, and offset counts returned records. An empty page
   * means the result is exhausted; do not return empty pages for filtered records.
   */
  readonly getPage: ExportPageReader<T>;
  /** Cancels before a query or after an in-flight query settles. */
  readonly signal?: AbortSignal;
}

/**
 * Lazily reads ordered export pages. Each iterator requests its first page at
 * offset zero. A page is requested only when the consumer advances the iterator;
 * the first empty page ends the stream. Cancellation does not interrupt an
 * in-flight query: the reader must provide its own database cancellation.
 * The reader is responsible for authorization, visibility and stable ordering.
 */
export async function* createPaginatedExportStream<T>(
  options: PaginatedExportStreamOptions<T>
): AsyncIterable<readonly T[]> {
  const { pageSize, getPage, signal } = options;
  let offset = 0;

  while (true) {
    signal?.throwIfAborted();
    const page = await getPage(offset, pageSize);
    signal?.throwIfAborted();

    if (page.length === 0) {
      return;
    }

    const nextOffset = offset + page.length;
    yield page;
    offset = nextOffset;
  }
}
