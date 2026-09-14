import { cn } from '@teable/ui-lib';
import type { ForwardRefRenderFunction, MutableRefObject, ReactNode, UIEvent } from 'react';
import { useMemo, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { Scroller } from 'scroller';
import { useIsTouchDevice } from '../../hooks';
import type { IGridProps } from './Grid';
import { getHorizontalRangeInfo, getVerticalRangeInfo, useEventListener } from './hooks';
import type { ILinearRow, IScrollState } from './interface';
import type { CoordinateManager } from './managers';
import type { ITimeoutID } from './utils';
import { getWheelDelta } from './utils';
import { cancelTimeout, requestTimeout } from './utils/utils';

export interface ScrollerProps
  extends Pick<
    IGridProps,
    | 'smoothScrollX'
    | 'smoothScrollY'
    | 'scrollBarVisible'
    | 'onScrollChanged'
    | 'onVisibleRegionChanged'
  > {
  coordInstance: CoordinateManager;
  containerWidth: number;
  containerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  left?: number;
  top?: number;
  scrollEnable?: boolean;
  scrollState: IScrollState;
  getLinearRow: (index: number) => ILinearRow;
  setScrollState: React.Dispatch<React.SetStateAction<IScrollState>>;
}

export interface ScrollerRef {
  scrollTo: (sl?: number, st?: number) => void;
  scrollBy: (deltaX: number, deltaY: number) => void;
}

// Maps a virtual (unclamped) vertical offset to the real DOM scrollTop of the scrollbar element,
// which is capped for very tall grids (the placeholder is chunked). Shared by the imperative
// scrollTo and the initial-position sync so both stay in agreement.
const getVerticalDomScrollTop = (el: HTMLElement, virtualScrollHeight: number, st: number) => {
  const scrollableHeight = el.scrollHeight - el.clientHeight;
  if (scrollableHeight > 0 && virtualScrollHeight > el.scrollHeight + 5) {
    const prog = st / (virtualScrollHeight - el.clientHeight);
    return scrollableHeight * prog;
  }
  return st;
};

const InfiniteScrollerBase: ForwardRefRenderFunction<ScrollerRef, ScrollerProps> = (props, ref) => {
  const {
    coordInstance,
    containerWidth,
    containerHeight,
    scrollWidth,
    scrollHeight,
    left = 0,
    top = 0,
    containerRef,
    smoothScrollX,
    smoothScrollY,
    scrollBarVisible,
    scrollEnable = true,
    scrollState,
    getLinearRow,
    setScrollState,
    onScrollChanged,
    onVisibleRegionChanged,
  } = props;

  useImperativeHandle(ref, () => ({
    scrollTo: (sl?: number, st?: number) => {
      if (horizontalScrollRef.current && sl != null) {
        horizontalScrollRef.current.scrollLeft = sl;
      }
      if (verticalScrollRef.current && st != null) {
        verticalScrollRef.current.scrollTop = getVerticalDomScrollTop(
          verticalScrollRef.current,
          scrollHeight,
          st
        );
      }
    },
    scrollBy: (deltaX: number, deltaY: number) => {
      horizontalScrollRef.current?.scrollBy(deltaX, 0);
      verticalScrollRef.current?.scrollBy(0, deltaY);
    },
  }));

  const isTouchDevice = useIsTouchDevice();

  const scrollerRef = useRef<Scroller | null>(null);
  const horizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const verticalScrollRef = useRef<HTMLDivElement | null>(null);
  const resetScrollingTimeoutID = useRef<ITimeoutID | null>(null);
  const offsetY = useRef(0);
  const lastScrollTop = useRef(0);
  // The mount scroll offset (from Grid's initialScrollState) and whether we've synced the DOM
  // scrollbar to it yet. The canvas already paints from scrollState; this only aligns the
  // scrollbar thumb / wheel baseline once the element is actually scrollable.
  const initialScrollTop = useRef(scrollState.scrollTop);
  const initialScrollLeft = useRef(scrollState.scrollLeft);
  const didSyncInitialScrollTop = useRef(false);
  const didSyncInitialScrollLeft = useRef(false);

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const onScroll = (e: UIEvent<HTMLDivElement>, direction: 'horizontal' | 'vertical') => {
    if (!verticalScrollRef.current || !horizontalScrollRef.current) {
      return;
    }
    const el = e.target as HTMLElement;
    const { scrollTop: newScrollTop, scrollLeft } = el;
    const { rowInitSize, columnInitSize } = coordInstance;

    let scrollProps: { [key: string]: number } = {};

    if (direction === 'vertical') {
      const delta = lastScrollTop.current - newScrollTop;
      const scrollableHeight = el.scrollHeight - el.clientHeight;
      lastScrollTop.current = newScrollTop;

      if (
        scrollableHeight > 0 &&
        (Math.abs(delta) > 2000 || newScrollTop === 0 || newScrollTop === scrollableHeight) &&
        scrollHeight > el.scrollHeight + 5
      ) {
        const prog = newScrollTop / scrollableHeight;
        const recomputed = (scrollHeight - el.clientHeight) * prog;
        offsetY.current = recomputed - newScrollTop;
      }
      const scrollTop = newScrollTop + offsetY.current;
      const rowIndex = coordInstance.getRowStartIndex(scrollTop);
      const rowOffset = coordInstance.getRowOffset(rowIndex);

      scrollProps = {
        scrollTop: !smoothScrollY ? rowOffset - rowInitSize : scrollTop,
      };
    }

    if (direction === 'horizontal') {
      const colIndex = coordInstance.getColumnStartIndex(scrollLeft);
      const colOffset = coordInstance.getColumnOffset(colIndex);
      scrollProps = {
        scrollLeft: !smoothScrollX ? colOffset - columnInitSize : scrollLeft,
      };
    }

    const { startRowIndex, stopRowIndex } = getVerticalRangeInfo(
      coordInstance,
      scrollProps.scrollTop ?? scrollState.scrollTop
    );
    const { startColumnIndex, stopColumnIndex } = getHorizontalRangeInfo(
      coordInstance,
      scrollProps.scrollLeft ?? scrollState.scrollLeft
    );

    const realStartRowIndex = getLinearRow(startRowIndex).realIndex;
    const realStopRowIndex = getLinearRow(stopRowIndex).realIndex;

    onVisibleRegionChanged?.({
      x: startColumnIndex,
      y: realStartRowIndex,
      width: stopColumnIndex - startColumnIndex,
      height: realStopRowIndex - realStartRowIndex,
    });
    onScrollChanged?.(
      scrollProps.scrollLeft ?? scrollState.scrollLeft,
      scrollProps.scrollTop ?? scrollState.scrollTop
    );

    setScrollState((prev) => {
      return {
        ...prev,
        ...scrollProps,
        isScrolling: true,
      };
    });
    resetScrollingDebounced();
  };

  const resetScrolling = useCallback(() => {
    setScrollState((prev) => ({ ...prev, isScrolling: false }));
    resetScrollingTimeoutID.current = null;
  }, [setScrollState]);

  const resetScrollingDebounced = useCallback(() => {
    if (resetScrollingTimeoutID.current !== null) {
      cancelTimeout(resetScrollingTimeoutID.current);
    }
    resetScrollingTimeoutID.current = requestTimeout(resetScrolling, 200);
  }, [resetScrolling]);

  const scrollHandler = useCallback((deltaX: number, deltaY: number) => {
    if (horizontalScrollRef.current) {
      horizontalScrollRef.current.scrollLeft = horizontalScrollRef.current.scrollLeft + deltaX;
    }
    if (verticalScrollRef.current) {
      const realDeltaY = deltaY;
      verticalScrollRef.current.scrollTop = verticalScrollRef.current.scrollTop + realDeltaY;
    }
  }, []);

  const mobileScrollHandler = useCallback((scrollLeft: number, scrollTop: number) => {
    if (horizontalScrollRef.current) {
      horizontalScrollRef.current.scrollLeft = scrollLeft;
    }
    if (verticalScrollRef.current) {
      verticalScrollRef.current.scrollTop = scrollTop;
    }
  }, []);

  const onWheel = useCallback(
    (event: Event) => {
      if (!scrollEnable) return;
      event.preventDefault();
      const [fixedDeltaX, fixedDeltaY] = getWheelDelta({
        event: event as WheelEvent,
        pageHeight: coordInstance.containerHeight - coordInstance.rowInitSize - 1,
        lineHeight: coordInstance.rowHeight,
      });
      scrollHandler(fixedDeltaX, fixedDeltaY);
    },
    [scrollEnable, scrollHandler, coordInstance]
  );

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (scrollerRef.current) {
      // The touch scroller tracks its own offset; start the gesture from where the grid actually
      // is (a restored position, a wheel/scrollbar scroll), otherwise it jumps back to its stale one.
      if (horizontalScrollRef.current && verticalScrollRef.current) {
        scrollerRef.current.scrollTo(
          horizontalScrollRef.current.scrollLeft,
          verticalScrollRef.current.scrollTop
        );
      }
      scrollerRef.current.doTouchStart(e.changedTouches, e.timeStamp);
    }
  }, []);

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (scrollerRef.current) {
      scrollerRef.current.doTouchMove(e.changedTouches, e.timeStamp);
    }
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (scrollerRef.current) {
      if (horizontalScrollRef.current && verticalScrollRef.current) {
        scrollerRef.current?.scrollTo(
          horizontalScrollRef.current.scrollLeft,
          verticalScrollRef.current.scrollTop
        );
      }
      scrollerRef.current.doTouchEnd(e.timeStamp);
    }
  }, []);

  useEffect(() => {
    if (!isTouchDevice) return;

    const options = {
      scrollingX: true,
      scrollingY: true,
      animationDuration: 200,
    };

    scrollerRef.current = new Scroller(mobileScrollHandler, options);
  }, [mobileScrollHandler, isTouchDevice]);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollTo({});
      scrollerRef.current.setDimensions(containerWidth, containerHeight, scrollWidth, scrollHeight);
    }
  }, [containerHeight, containerWidth, scrollWidth, scrollHeight]);

  // Align the DOM scrollbar with the initial scroll offset once the grid has laid out enough to
  // be scrollable. Re-runs as the layout settles (dimensions change) until it lands, then stops.
  useEffect(() => {
    if (didSyncInitialScrollTop.current) return;
    const st = initialScrollTop.current;
    if (st <= 0) {
      didSyncInitialScrollTop.current = true;
      return;
    }
    const el = verticalScrollRef.current;
    if (el == null || el.scrollHeight - el.clientHeight <= 0) return;
    el.scrollTop = getVerticalDomScrollTop(el, scrollHeight, st);
    lastScrollTop.current = el.scrollTop;
    // On touch devices the scroller republishes its own offset on every resize, so it must start
    // from the restored position too, or it would drag the scrollbar back to the top.
    scrollerRef.current?.scrollTo(horizontalScrollRef.current?.scrollLeft ?? 0, el.scrollTop);
    didSyncInitialScrollTop.current = true;
  }, [containerHeight, scrollHeight]);

  // Same for the horizontal scrollbar.
  useEffect(() => {
    if (didSyncInitialScrollLeft.current) return;
    const sl = initialScrollLeft.current;
    if (sl <= 0) {
      didSyncInitialScrollLeft.current = true;
      return;
    }
    const el = horizontalScrollRef.current;
    // Wait until the scrollbar has its real width: before layout it's 0 wide and looks scrollable.
    if (el == null || el.clientWidth <= 0 || el.scrollWidth - el.clientWidth <= 0) return;
    el.scrollLeft = sl;
    scrollerRef.current?.scrollTo(el.scrollLeft, verticalScrollRef.current?.scrollTop ?? 0);
    didSyncInitialScrollLeft.current = true;
  }, [containerWidth, scrollWidth]);

  // A layout change (resize, data load, a restored offset seeded into a view that now fits on
  // screen) can leave the content no longer overflowing the viewport while the virtual position
  // is still non-zero. With nothing scrollable, there's no scrollbar to bring it back and the
  // first rows get stranded above the top, so snap the position back to the top in that case.
  // The scrollable case self-corrects: the browser clamps the DOM scrollbar and onScroll follows.
  useEffect(() => {
    if (coordInstance.totalHeight - containerHeight <= 0 && scrollState.scrollTop > 0) {
      setScrollState((prev) => ({ ...prev, scrollTop: 0 }));
    }
  }, [coordInstance, containerHeight, scrollState.scrollTop, setScrollState]);

  // Same for columns: if they no longer overflow horizontally, snap back to the left edge.
  useEffect(() => {
    if (scrollWidth - containerWidth <= 0 && scrollState.scrollLeft > 0) {
      setScrollState((prev) => ({ ...prev, scrollLeft: 0 }));
    }
  }, [scrollWidth, containerWidth, scrollState.scrollLeft, setScrollState]);

  const placeholderElements: ReactNode[] = useMemo(() => {
    let h = 0;
    let key = 0;
    const res = [];

    while (h < scrollHeight) {
      const curH = Math.min(5000000, scrollHeight - h);
      res.push(<div key={key++} style={{ width: 0, height: curH }} />);
      h += curH;
    }
    return res;
  }, [scrollHeight]);

  useEventListener('wheel', onWheel, containerRef.current, false);
  useEventListener('touchstart', onTouchStart, containerRef.current, false);
  useEventListener('touchmove', onTouchMove, containerRef.current, false);
  useEventListener('touchend', onTouchEnd, containerRef.current, false);

  return (
    <>
      <div
        ref={horizontalScrollRef}
        className={cn(
          'scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-h-[10px] absolute bottom-[2px] start-0 h-4 cursor-pointer overflow-y-hidden overflow-x-scroll will-change-transform',
          !scrollBarVisible && 'opacity-0 pointer-events-none'
        )}
        style={{
          left,
          width: containerWidth - left,
        }}
        onScroll={(e) => onScroll(e, 'horizontal')}
      >
        <div
          className="absolute"
          style={{
            width: scrollWidth,
            height: 1,
          }}
        />
      </div>
      <div
        ref={verticalScrollRef}
        className={cn(
          'scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-w-[10px] scrollbar-min-thumb absolute end-[2px] w-4 cursor-pointer overflow-x-hidden overflow-y-scroll will-change-transform',
          !scrollBarVisible && 'opacity-0 pointer-events-none'
        )}
        style={{
          top,
          height: containerHeight - top,
        }}
        onScroll={(e) => onScroll(e, 'vertical')}
      >
        <div className="flex w-px shrink-0 flex-col">{placeholderElements}</div>
      </div>
    </>
  );
};

export const InfiniteScroller = forwardRef(InfiniteScrollerBase);
