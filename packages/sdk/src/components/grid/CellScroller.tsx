import type { ForwardRefRenderFunction, MutableRefObject, ReactNode, UIEvent } from 'react';
import { useMemo, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { GRID_DEFAULT } from './configs';
import { useEventListener } from './hooks';
import type { IActiveCellBound } from './interface';
import { getWheelDelta } from './utils/utils';

export interface CellScrollerProps {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  scrollEnable?: boolean;
  activeCellBound: IActiveCellBound;
  setCellScrollTop: React.Dispatch<React.SetStateAction<number>>;
}

export interface CellScrollerRef {
  reset: () => void;
}

const { cellScrollBarPaddingY } = GRID_DEFAULT;

const CellScrollerBase: ForwardRefRenderFunction<CellScrollerRef, CellScrollerProps> = (
  props,
  ref
) => {
  const { containerRef, style, scrollEnable, activeCellBound, setCellScrollTop } = props;
  const { height: containerHeight, totalHeight: scrollHeight } = activeCellBound;

  const verticalScrollRef = useRef<HTMLDivElement | null>(null);
  const offsetY = useRef(0);
  const lastScrollTop = useRef(0);

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (verticalScrollRef.current) {
        verticalScrollRef.current.scrollTop = 0;
        setCellScrollTop(0);
      }
    },
  }));

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (!verticalScrollRef.current) return;

    const el = e.target as HTMLElement;
    const { scrollTop: newScrollTop } = el;
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

    setCellScrollTop(scrollTop);
  };

  const scrollHandler = useCallback((deltaY: number) => {
    if (verticalScrollRef.current) {
      const realDeltaY = deltaY;
      verticalScrollRef.current.scrollTop = verticalScrollRef.current.scrollTop + realDeltaY;
    }
  }, []);

  const onWheel = useCallback(
    (event: Event) => {
      if (!scrollEnable) return;
      event.preventDefault();
      const [, fixedDeltaY] = getWheelDelta(event as WheelEvent);
      scrollHandler(fixedDeltaY);
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
    <div
      ref={verticalScrollRef}
      className="scrollbar scrollbar-thumb-rounded-sm scrollbar-w-2 absolute w-[10px] cursor-pointer overflow-x-hidden overflow-y-scroll opacity-0 will-change-transform"
      style={{
        ...style,
        height: containerHeight - cellScrollBarPaddingY * 2,
      }}
      onScroll={onScroll}
    >
      <div className="flex shrink-0 flex-col">{placeholderElements}</div>
    </div>
  );
};

export const CellScroller = forwardRef(CellScrollerBase);
