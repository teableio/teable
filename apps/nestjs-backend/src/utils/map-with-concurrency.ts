/** Maps items with bounded concurrency while preserving input order. */
export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
