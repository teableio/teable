import type { IGridRef } from '@teable/sdk';
import { GRID_DEFAULT } from '@teable/sdk/components/grid/configs';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'teable_grid_scroll';
const DEBOUNCE_MS = 500;
// Treat "within one row of the end" as the bottom, so appended rows keep us pinned there.
const BOTTOM_THRESHOLD = GRID_DEFAULT.rowHeight;

interface IStoredScroll {
  top: number;
  atBottom: boolean;
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
 * Remembers the grid's vertical scroll position per (user, view) in localStorage and
 * restores it every time the view is (re)opened, once its rows have loaded. If the previous
 * position was at the very bottom, it stays at the bottom even after new rows are appended,
 * so freshly added rows remain visible.
 *
 * The grid instance is shared across a table's views (it is not remounted when you switch
 * views/tabs), so restoration keys off each transition to a new active view rather than a
 * one-time mount.
 */
export const useGridScrollPosition = (props: {
  gridRef: RefObject<IGridRef>;
  containerRef: RefObject<HTMLDivElement>;
  userId?: string;
  viewId?: string;
  rowCount: number;
  rowHeight: number;
  ready: boolean;
}) => {
  const { gridRef, containerRef, userId, viewId, rowCount, rowHeight, ready } = props;
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const restoreFramesRef = useRef<number[]>([]);
  const restoredViewIdRef = useRef<string | undefined>(undefined);

  const getMaxScrollTop = useCallback(() => {
    const viewportHeight =
      (containerRef.current?.clientHeight ?? 0) - GRID_DEFAULT.columnHeadHeight;
    return Math.max(0, rowCount * rowHeight - viewportHeight);
  }, [containerRef, rowCount, rowHeight]);

  const onScrollChanged = useCallback(
    (scrollTop: number) => {
      const key = getStorageKey(userId, viewId);
      if (key == null) return;
      // Compute "at bottom" synchronously against the current view, then debounce the write.
      const maxScrollTop = getMaxScrollTop();
      const atBottom = maxScrollTop > 0 && scrollTop >= maxScrollTop - BOTTOM_THRESHOLD;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => writeStored(key, { top: scrollTop, atBottom }),
        DEBOUNCE_MS
      );
    },
    [userId, viewId, getMaxScrollTop]
  );

  useEffect(() => {
    const key = getStorageKey(userId, viewId);
    if (key == null || !ready || rowCount === 0) return;
    // Restore once per activation of a given view; switching away and back re-triggers it.
    if (restoredViewIdRef.current === viewId) return;
    restoredViewIdRef.current = viewId;

    const saved = readStored(key);
    if (saved == null) return;

    const apply = () => {
      // When new rows were appended below, restoring the raw offset would miss them; if we
      // were sitting at the bottom, land on the (new) bottom instead.
      const target = saved.atBottom ? getMaxScrollTop() : saved.top;
      gridRef.current?.scrollTo(undefined, target);
    };
    // Apply after the grid has laid out its rows, then reassert on the next frame in case
    // the initial layout settled the scroll position back to the top.
    restoreFramesRef.current.forEach(cancelAnimationFrame);
    const frame1 = requestAnimationFrame(() => {
      apply();
      const frame2 = requestAnimationFrame(apply);
      restoreFramesRef.current = [frame2];
    });
    restoreFramesRef.current = [frame1];
  }, [userId, viewId, ready, rowCount, gridRef, getMaxScrollTop]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      restoreFramesRef.current.forEach(cancelAnimationFrame);
    },
    []
  );

  return onScrollChanged;
};
