import type { ForwardRefRenderFunction, MutableRefObject, ReactNode, UIEvent } from 'react';
import { useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { IGridProps } from './Grid';
import { getHorizontalRangeInfo, getVerticalRangeInfo, useEventListener } from './hooks';
import type { IScrollState } from './interface';
import type { CoordinateManager } from './managers';
import type { ITimeoutID } from './utils';
import { cancelTimeout, isWindowsOS, requestTimeout } from './utils/utils';

export interface ScrollerProps
  extends Pick<IGridProps, 'smoothScrollX' | 'smoothScrollY' | 'onVisibleRegionChanged'> {
  coordInstance: CoordinateManager;
  containerWidth: number;
  containerHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  left?: number;
  top?: number;
  scrollEnable?: boolean;
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
    scrollEnable = true,
    setScrollState,
    onVisibleRegionChanged,
  } = props;

  useImperativeHandle(ref, () => ({
    scrollTo: (sl?: number, st?: number) => {
      if (horizontalScrollRef.current && sl != null) {
        horizontalScrollRef.current.scrollLeft = sl;
      }
      if (verticalScrollRef.current && st != null) {
        verticalScrollRef.current.scrollTop = st;
      }
    },
    scrollBy: (deltaX: number, deltaY: number) => {
      horizontalScrollRef.current?.scrollBy(deltaX, 0);
      verticalScrollRef.current?.scrollBy(0, deltaY);
    },
  }));

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
      scrollProps.scrollTop ?? verticalScrollRef.current.scrollTop
    );
    const { startColumnIndex, stopColumnIndex } = getHorizontalRangeInfo(
      coordInstance,
      scrollProps.scrollLeft ?? horizontalScrollRef.current.scrollLeft
    );

    onVisibleRegionChanged?.({
      x: startColumnIndex,
      y: startRowIndex,
      width: stopColumnIndex - startColumnIndex,
      height: stopRowIndex - stopColumnIndex,
    });

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

  return (
    <>
      <div
        ref={horizontalScrollRef}
        className="absolute will-change-transform cursor-pointer overflow-x-scroll overflow-y-hidden h-4 left-0 bottom-0 scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-ring/60"
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
        className="absolute will-change-transform cursor-pointer overflow-x-hidden overflow-y-scroll w-4 right-0 scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-ring/60"
        style={{
          top,
          height: containerHeight - top,
        }}
        onScroll={(e) => onScroll(e, 'vertical')}
      >
        <div className="flex flex-col shrink-0">{placeholderElements}</div>
      </div>
    </>
  );
};

export const InfiniteScroller = forwardRef(InfiniteScrollerBase);
