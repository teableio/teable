import * as React from 'react';

const canUseMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

const getMatches = (query: string, fallback: boolean) => {
  if (!canUseMatchMedia()) {
    return fallback;
  }
  return window.matchMedia(query).matches;
};

export interface IUseMediaQueryOptions {
  /** Value returned when `matchMedia` is unavailable (SSR). Defaults to false. */
  fallback?: boolean;
  /**
   * Resolve the query in an effect instead of during render.
   *
   * The default (`false`) resolves the query as soon as the browser can —
   * immediately on client-side renders, and right after hydration on hydrated
   * ones (the server snapshot is kept during hydration so the tree never
   * mismatches). Pass `true` to keep the pre-existing "false until mounted"
   * behaviour of a call site.
   */
  deferToEffect?: boolean;
}

/**
 * The single media-query implementation for the design system.
 *
 * Everything that needs to know "is this a narrow viewport" goes through
 * here, so there is exactly one place where matching semantics live.
 */
export function useMediaQuery(query: string, options: IUseMediaQueryOptions = {}): boolean {
  const { fallback = false, deferToEffect = false } = options;

  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      if (!canUseMatchMedia()) {
        return () => undefined;
      }

      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  const getSnapshot = React.useCallback(() => getMatches(query, fallback), [query, fallback]);

  // During hydration React reads the server snapshot, so the markup matches the
  // SSR output; it re-renders with the real query right after, before paint.
  const getServerSnapshot = React.useCallback(() => fallback, [fallback]);

  const matches = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [deferredMatches, setDeferredMatches] = React.useState(fallback);

  React.useEffect(() => {
    if (!deferToEffect || !canUseMatchMedia()) return;

    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setDeferredMatches(event.matches);

    // Re-sync on mount: the query may have changed, and deferred call sites
    // resolve for the first time here.
    setDeferredMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [deferToEffect, query]);

  return deferToEffect ? deferredMatches : matches;
}
