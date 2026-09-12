import type { IScrollState } from '@teable/sdk';
import { GRID_DEFAULT } from '@teable/sdk/components/grid/configs';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

const STORAGE_PREFIX = 'teable_grid_scroll';
const DEBOUNCE_MS = 500;
// Treat "within one row of the end" as the bottom, so appended rows keep us pinned there.
const BOTTOM_THRESHOLD = GRID_DEFAULT.rowHeight;

interface IStoredScroll {
  top: number;
  atBottom: boolean;
  // Absent in positions saved before horizontal scroll was remembered.
  left?: number;
}

const getStorageKey = (userId?: string, viewId?: string) =>
  userId && viewId ? `${STORAGE_PREFIX}_${userId}_${viewId}` : null;

const readStored = (key: string): IStoredScroll | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as IStoredScroll) : null;
  } catch {
    return null;
  }
};

const writeStored = (key: string, value: IStoredScroll) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable or over quota — the feature is best-effort, ignore.
  }
};

/**
 * Remembers the grid's scroll position (vertical and horizontal) per (user, view) in localStorage
 * and restores it every time the view is (re)opened. If the previous position was at the very
 * bottom, it stays at the bottom even after new rows are appended, so freshly added rows remain
 * visible.
 *
 * The grid owns its scroll position in React state and seeds it from `initialScrollState` on mount
 * (GridViewBaseInner re-mounts the grid via a skeleton on every view/column reload, so switching
 * views and coming back re-seeds it). So instead of an imperative restore that races the async
 * layout, we compute the remembered offset here and hand it to the grid as its initial state, then
 * only persist afterwards.
 */
export const useGridScrollPosition = (props: {
  containerRef: RefObject<HTMLDivElement>;
  userId?: string;
  viewId?: string;
  rowCount: number;
  rowHeight: number;
}) => {
  const { containerRef, userId, viewId, rowCount, rowHeight } = props;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  // The view whose position we've observed the grid actually reach. Until then we ignore a
  // position of 0, so the transient zeros emitted while the grid lays out can't clobber the
  // saved position before it's restored.
  const settledViewIdRef = useRef<string | undefined>(undefined);

  const getMaxScrollTop = useCallback(() => {
    const viewportHeight =
      (containerRef.current?.clientHeight ?? 0) - GRID_DEFAULT.columnHeadHeight;
    return Math.max(0, rowCount * rowHeight - viewportHeight);
  }, [containerRef, rowCount, rowHeight]);

  // Seed value for the grid's initial scrollState. Read synchronously from localStorage so it's
  // available before the grid mounts; recomputed (and thus re-applied on re-mount) as rowCount and
  // the viewport settle, so "bottom" tracks the real end even after rows load or get appended.
  const initialScrollState = useMemo<IScrollState | undefined>(() => {
    const key = getStorageKey(userId, viewId);
    if (key == null) return undefined;
    const saved = readStored(key);
    const left = saved?.left ?? 0;
    if (saved == null || (saved.top <= 0 && !saved.atBottom && left <= 0)) return undefined;
    // Clamp to what's scrollable when the viewport is already measured; when it isn't yet
    // (the memo runs during render, before the freshly-mounted container is laid out) fall back
    // to the saved offset so the restore still applies. The grid clamps any excess itself on
    // mount, and a non-scrollable view is snapped back to the top there too, so we can't strand.
    const maxScrollTop = getMaxScrollTop();
    let top = saved.top;
    if (maxScrollTop > 0) top = saved.atBottom ? maxScrollTop : Math.min(saved.top, maxScrollTop);
    // The horizontal offset isn't clamped here: the column widths live in the grid, which clamps
    // it on mount (and snaps a view that no longer overflows back to the left edge).
    return { scrollTop: top, scrollLeft: left, isScrolling: false };
  }, [userId, viewId, getMaxScrollTop]);

  // A new view starts un-settled so its restore is protected from the initial zeros.
  useEffect(() => {
    settledViewIdRef.current = undefined;
  }, [viewId]);

  const onScrollChanged = useCallback(
    (scrollLeft: number, scrollTop: number) => {
      const key = getStorageKey(userId, viewId);
      if (key == null) return;
      if (settledViewIdRef.current !== viewId) {
        // Don't persist the transient zeros the grid emits while laying out — they'd overwrite
        // the position we're about to restore. Once we see it actually scrolled, persist freely.
        if (scrollTop <= 0 && scrollLeft <= 0) return;
        settledViewIdRef.current = viewId;
      }
      const maxScrollTop = getMaxScrollTop();
      // Nothing to remember while the grid isn't scrollable; skipping also avoids a transient
      // reflow (e.g. a resize) writing 0 over a good saved position.
      if (maxScrollTop <= 0) return;
      const atBottom = scrollTop >= maxScrollTop - BOTTOM_THRESHOLD;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => writeStored(key, { top: scrollTop, atBottom, left: scrollLeft }),
        DEBOUNCE_MS
      );
    },
    [userId, viewId, getMaxScrollTop]
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  return { initialScrollState, onScrollChanged };
};
