/**
 * Page-probe limit: a paginated record read asks for one row beyond the page
 * so an exactly full final page can be told apart from a page with successors
 * without paying for a `count(*)`.
 */
export const recordPageProbeLimit = (limit: number | undefined): number | undefined =>
  limit === undefined ? undefined : limit + 1;

export interface IRecordPageBoundary<T> {
  /** Page content; the probe row, when present, is dropped. */
  readonly page: ReadonlyArray<T>;
  /** Whether another page starts where this one ends. */
  readonly hasMore: boolean;
}

/**
 * Resolves the page boundary from an over-fetched row set. Callers must fetch
 * {@link recordPageProbeLimit} rows; `hasMore` is only ever true when the
 * fetched set carries at least one row past the page.
 */
export const resolveRecordPageBoundary = <T>(
  fetched: ReadonlyArray<T>,
  limit: number | undefined
): IRecordPageBoundary<T> => {
  if (limit === undefined) {
    return { page: fetched, hasMore: false };
  }
  const hasMore = fetched.length > limit;
  return { page: hasMore ? fetched.slice(0, limit) : fetched, hasMore };
};
