/** Coordinates readiness outside the cache lock. The loader owns lock acquisition/release. */
export async function provisionReadyCache<T>(options: {
  getCached: () => Promise<{ data: T } | null>;
  wait: (remainingMs: number) => Promise<void>;
  loadWithoutWait: () => Promise<T>;
  isPending: (error: unknown) => boolean;
  budgetMs: number;
}): Promise<T> {
  const cached = await options.getCached();
  if (cached !== null) return cached.data;
  const deadline = Date.now() + options.budgetMs;
  for (;;) {
    await options.wait(Math.max(0, deadline - Date.now()));
    try {
      return await options.loadWithoutWait();
    } catch (error) {
      if (!options.isPending(error) || Date.now() >= deadline) throw error;
    }
  }
}
