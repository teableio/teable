import type { UrlObject } from 'url';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft } from '@teable/icons';
import type { IBaseEntryMapVo } from '@teable/openapi';
import { Skeleton } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TeableLogo } from '@/components/TeableLogo';
import { Emoji } from '../../components/emoji/Emoji';
import { PlainPageSkeleton } from '../../components/PlainPageSkeleton';
import { TableSkeleton } from '../table/TableSkeleton';

/**
 * The subset of a base the transition shell can render; name/icon may be
 * unknown when entering through a table or view link (e.g. pinned items)
 */
export interface IEnterBaseTarget {
  id: string;
  name?: string;
  icon?: string | null;
}

/**
 * 'table' mocks the table page (header/toolbar/view skeleton); 'plain' keeps the
 * sidebar shell but shows a neutral main area, for dashboard/workflow/app targets
 * whose layout the shell cannot know
 */
export type IEnterBaseVariant = 'table' | 'plain';

/**
 * A full-screen shell shown instantly on click, mirroring the base page layout:
 * real chrome where content is already known (logo, base name), the same loading
 * skeletons its blocks natively render elsewhere, so the transition into the
 * real page is seamless.
 *
 * Exported for exits that own their navigation (the onboarding finish): without
 * `onCancel` the icon is plain chrome — those flows have already committed
 * server-side, so there is no page behind the overlay worth going back to.
 */
export const EnterBaseOverlay = ({
  base,
  variant,
  onCancel,
}: {
  base: IEnterBaseTarget;
  variant: IEnterBaseVariant;
  onCancel?: () => void;
}) => {
  const { t } = useTranslation(['common']);
  return createPortal(
    // Portal events bubble through the React tree to the clickable card that
    // rendered us — swallow them so clicking the overlay can't restart navigation
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="fixed inset-0 z-50 flex bg-background duration-150 animate-in fade-in-0"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Sidebar — real header, then BaseNodeTree-style loading skeleton */}
      <div
        className="group/sidebar hidden h-full shrink-0 flex-col border-e sm:flex"
        style={{ width: 'var(--sidebar-width, 288px)' }}
      >
        <div className="flex h-12 shrink-0 items-center gap-2 px-4">
          {/* Mirrors BaseSidebarHeaderLeft: icon swaps to a back chevron on sidebar hover */}
          {onCancel ? (
            <button
              type="button"
              title={t('common:actions.back')}
              aria-label={t('common:actions.back')}
              className="relative size-6 shrink-0 cursor-pointer"
              onClick={onCancel}
            >
              <div className="absolute top-0 size-6 transition-all group-hover/sidebar:opacity-0">
                {base.icon ? (
                  <Emoji emoji={base.icon} size={'1.5rem'} />
                ) : (
                  <TeableLogo className="size-6 text-black" />
                )}
              </div>
              <ChevronsLeft className="absolute top-0 size-6 opacity-0 transition-all group-hover/sidebar:opacity-100" />
            </button>
          ) : (
            <div className="size-6 shrink-0">
              {base.icon ? (
                <Emoji emoji={base.icon} size={'1.5rem'} />
              ) : (
                <TeableLogo className="size-6 text-black" />
              )}
            </div>
          )}
          {base.name ? (
            <span className="truncate text-sm font-medium">{base.name}</span>
          ) : (
            <Skeleton className="h-5 w-24" />
          )}
        </div>
        <div className="space-y-3 px-4 py-2">
          {['w-24', 'w-16', 'w-20'].map((width, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="size-4" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
        <div className="border-t px-2 pt-3">
          <Skeleton className="h-8 w-full" />
        </div>
        <div className="mt-3 flex flex-col gap-2 px-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </div>
      {/* Main area — table variant mocks the table page; plain shows a neutral frame */}
      {variant === 'table' ? <TableSkeleton /> : <PlainPageSkeleton />}
    </div>,
    document.body
  );
};

/**
 * Navigate into a base with immediate full-screen feedback
 * while the server resolves the target page
 */
export const useEnterBase = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [entering, setEntering] = useState<{
    base: IEnterBaseTarget;
    variant: IEnterBaseVariant;
  } | null>(null);
  const enteringRef = useRef(false);

  // Upgrade a bare /base/{id} destination to the prefetched final URL (last
  // visited table/view) — the click then pays a single SSR round instead of
  // the redirect chain. Pull only: read at click time, nothing navigates on
  // data arrival; no entry → undefined → the bare URL and its redirect chain
  // remain the fallback.
  const resolveEntryUrl = useCallback(
    (baseId: string): string | undefined => {
      // prefix-matches ReactQueryKeys.baseEntryMap(spaceId); freshest map
      // wins. The map refetches on every list mount, so at worst a click that
      // races the refetch lands on the previous entry — the same staleness
      // class as the redirect chain itself, and it self-heals next time.
      const queries = queryClient
        .getQueryCache()
        .findAll({ queryKey: ['base-entry-map'] })
        .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      for (const query of queries) {
        const url = (query.state.data as IBaseEntryMapVo | undefined)?.[baseId];
        if (url) return url;
      }
      return undefined;
    },
    [queryClient]
  );

  const enterBase = useCallback(
    async (
      base: IEnterBaseTarget,
      url?: string | UrlObject,
      variant: IEnterBaseVariant = 'table'
    ) => {
      // Ignore re-entry (double clicks, clicks landing on the overlay) so an
      // in-flight navigation is never aborted and restarted
      if (enteringRef.current) return;
      const isBareBaseUrl =
        !url ||
        (typeof url === 'string' && url === `/base/${base.id}`) ||
        (typeof url === 'object' && url.pathname === '/base/[baseId]');
      const destination =
        (isBareBaseUrl ? resolveEntryUrl(base.id) : undefined) ?? url ?? `/base/${base.id}`;
      enteringRef.current = true;
      setEntering({ base, variant });
      try {
        await router.push(destination);
      } catch {
        // Navigation cancelled or failed — restore the page
      } finally {
        enteringRef.current = false;
        setEntering(null);
      }
    },
    [router, resolveEntryUrl]
  );

  // Clicking the overlay's logo returns to the base list underneath: starting a
  // new navigation to the current URL aborts the in-flight route load, and the
  // aborted push's finally block clears the overlay state
  const cancelEnter = useCallback(() => {
    router.replace(router.asPath);
  }, [router]);

  const enterBaseOverlay = entering ? (
    <EnterBaseOverlay base={entering.base} variant={entering.variant} onCancel={cancelEnter} />
  ) : null;

  return { enterBase, enterBaseOverlay };
};
