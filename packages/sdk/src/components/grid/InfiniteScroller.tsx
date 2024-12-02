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
import { cancelTimeout, isWindowsOS, requestTimeout } from './utils/utils';

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
        const el = verticalScrollRef.current;
        const scrollableHeight = el.scrollHeight - el.clientHeight;
        let virtaulOffsetY = 0;
        if (scrollableHeight > 0 && scrollHeight > el.scrollHeight + 5) {
          const prog = st / (scrollHeight - el.clientHeight);
          const actualScrollTop = scrollableHeight * prog;
          virtaulOffsetY = actualScrollTop - st;
        }
        verticalScrollRef.current.scrollTop = st + virtaulOffsetY;
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
      const { deltaX, deltaY, shiftKey } = event as WheelEvent;
      const fixedDeltaY = shiftKey && isWindowsOS() ? 0 : deltaY;
      const fixedDeltaX = shiftKey && isWindowsOS() ? deltaY : deltaX;
      scrollHandler(fixedDeltaX, fixedDeltaY);
    },
    [scrollEnable, scrollHandler]
  );

  const onTouchStart = useCallback((e: TouchEvent) => {
    if (scrollerRef.current) {
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
          'scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-h-[10px] absolute bottom-[2px] left-0 h-4 cursor-pointer overflow-y-hidden overflow-x-scroll will-change-transform',
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
          'scrollbar scrollbar-thumb-foreground/40 scrollbar-thumb-rounded-md scrollbar-w-[10px] scrollbar-min-thumb absolute right-[2px] w-4 cursor-pointer overflow-x-hidden overflow-y-scroll will-change-transform',
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
