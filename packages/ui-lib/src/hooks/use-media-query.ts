import * as React from 'react';

const getMatches = (query: string, fallback: boolean) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return fallback;
  }
  return window.matchMedia(query).matches;
};

export interface IUseMediaQueryOptions {
  /** Value returned when `matchMedia` is unavailable (SSR). Defaults to false. */
  fallback?: boolean;
  /**
   * Resolve the query in an effect instead of during the first render.
   *
   * The default (`false`) matches the query during the initial render, so a
   * narrow viewport never paints the wide-viewport layout first. Pass `true`
   * to keep the pre-existing "false until mounted" behaviour of a call site.
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

  const [matches, setMatches] = React.useState<boolean>(() =>
    deferToEffect ? fallback : getMatches(query, fallback)
  );

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const mql = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Re-sync on mount: the query may have changed, and deferred call sites
    // resolve for the first time here.
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
