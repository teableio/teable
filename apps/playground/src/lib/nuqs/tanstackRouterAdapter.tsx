import { useLocation, useNavigate } from '@tanstack/react-router';
import { startTransition, useCallback, useMemo } from 'react';
import {
  renderQueryString,
  unstable_createAdapterProvider,
  type unstable_AdapterInterface,
  type unstable_UpdateUrlFunction,
} from 'nuqs/adapters/custom';

const getSafePathname = (pathname: string) => pathname.split(/[?#]/)[0] ?? '';

function useNuqsTanstackRouterAdapter(watchKeys: string[]): unstable_AdapterInterface {
  const pathname = useLocation({ select: (state) => state.pathname });
  const locationSearch = useLocation({ select: (state) => state.search });
  const safePathname = useMemo(() => getSafePathname(pathname), [pathname]);
  const navigate = useNavigate();

  const watchKeySet = useMemo(() => new Set(watchKeys), [watchKeys]);
  const searchSnapshotKey = useMemo(() => JSON.stringify(locationSearch ?? {}), [locationSearch]);

  const searchParams = useMemo(() => {
    void searchSnapshotKey;
    if (typeof window === 'undefined') {
      return new URLSearchParams();
    }
    const params = new URLSearchParams(window.location.search);
    for (const key of Array.from(params.keys())) {
      if (!watchKeySet.has(key)) {
        params.delete(key);
      }
    }
    return params;
  }, [searchSnapshotKey, watchKeySet]);

  const updateUrl: unstable_UpdateUrlFunction = useCallback(
    (nextSearch, options) => {
      startTransition(() => {
        navigate({
          from: '/',
          to: safePathname + renderQueryString(nextSearch),
          replace: options.history === 'replace',
          resetScroll: options.scroll,
          hash: (prevHash) => prevHash ?? '',
          state: (state) => state,
        });
      });
    },
    [navigate, safePathname]
  );

  return {
    searchParams,
    getSearchParamsSnapshot: () =>
      typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    updateUrl,
    rateLimitFactor: 1,
  };
}

export const NuqsAdapter = unstable_createAdapterProvider(useNuqsTanstackRouterAdapter);
