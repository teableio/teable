import { useQuery } from '@tanstack/react-query';
import type { ShortLinkType } from '@teable/openapi';
import { createShortLink } from '@teable/openapi';
import { useMemo } from 'react';
import { useOrigin } from './useOrigin';

/**
 * Create (or reuse) the short link of a resource and return its full short URL,
 * e.g. `{origin}/s/xxxxxxxxx`.
 *
 * Pass `undefined` to disable. `shortUrl` is `undefined` while loading;
 * `isFallback` turns true only when creation failed, so callers can fall back
 * to the original long URL instead of flashing it during loading.
 */
export const useShortLink = (params?: { type: ShortLinkType; resourceId: string }) => {
  const { type, resourceId } = params ?? {};
  const origin = useOrigin();
  const { data, isError } = useQuery({
    queryKey: ['short-link', type, resourceId],
    queryFn: () =>
      createShortLink({ type: type as ShortLinkType, resourceId: resourceId as string }).then(
        (res) => res.data
      ),
    enabled: Boolean(type && resourceId),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const shortUrl = useMemo(() => {
    if (!data || !origin) {
      return undefined;
    }
    return `${origin}/s/${data.code}`;
  }, [data, origin]);

  return { shortUrl, isFallback: isError };
};
