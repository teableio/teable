import { ResizeHandleBar, cn } from '@teable/ui-lib';
import {
  type FC,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocalStorage } from 'react-use';
import { LocalStorageKeys } from '../../config/local-storage-keys';
import { ModalContext } from './ModalContext';
import type { IExpandRecordCrumb } from './PanelContext';
import { ExpandRecordPanelHostContext, ExpandRecordPanelStackContext } from './PanelContext';

// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_WIDTH = 320;
// eslint-disable-next-line @typescript-eslint/naming-convention
const DEFAULT_WIDTH = 560;
// however wide the panel is dragged, this much of the table stays visible beside it
// eslint-disable-next-line @typescript-eslint/naming-convention
const MIN_TABLE_WIDTH = 240;

// Layers that take Escape for themselves: while one is open, Escape is theirs, not the panel's.
// Checked before they handle the key (a layer closes itself on it), and by open state rather than
// `defaultPrevented`, since a closed layer still mounted for its exit animation marks it too.
// eslint-disable-next-line @typescript-eslint/naming-convention
const OPEN_LAYER_SELECTOR = [
  '[data-radix-popper-content-wrapper] [data-state="open"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(',');

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const useElementWidth = (element: HTMLElement | null) => {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return width;
};

/**
 * The record side panel: docked to the end side of the nearest table node, over the table
 * (the table keeps its width and stays interactive). The start edge drags to resize; the width
 * is remembered across tables. `extraWidth` is added on top while the comment column is open,
 * so the fields keep their width.
 */
export const Panel: FC<
  PropsWithChildren<{
    visible?: boolean;
    extraWidth?: number;
    // the open record as the breadcrumb of a record stacked over it shows it
    crumb?: Omit<IExpandRecordCrumb, 'close'>;
    className?: string;
    onClose?: () => void;
  }>
> = (props) => {
  const { visible, extraWidth = 0, crumb, className, onClose, children } = props;
  const { container } = useContext(ExpandRecordPanelHostContext);
  const parentStack = useContext(ExpandRecordPanelStackContext);
  const ref = useRef<HTMLDivElement>(null);
  const [storedWidth, setStoredWidth] = useLocalStorage<number>(
    LocalStorageKeys.ExpandRecordPanelSize,
    DEFAULT_WIDTH
  );
  const [dragging, setDragging] = useState(false);
  const [childCount, setChildCount] = useState(0);
  const containerWidth = useElementWidth(container);

  const maxWidth = Math.max(MIN_WIDTH, containerWidth - MIN_TABLE_WIDTH);
  const baseWidth = clamp(storedWidth ?? DEFAULT_WIDTH, MIN_WIDTH, maxWidth);
  const width = containerWidth
    ? Math.min(baseWidth + extraWidth, containerWidth)
    : baseWidth + extraWidth;

  const { registerChild: registerInParent } = parentStack;
  useEffect(() => {
    if (!visible) return;
    return registerInParent?.();
  }, [visible, registerInParent]);

  const registerChild = useCallback(() => {
    setChildCount((count) => count + 1);
    return () => setChildCount((count) => count - 1);
  }, []);

  // Escape closes the top panel wherever focus is. Captured on the window so nothing on the page
  // can swallow it first; a panel with a record stacked over it leaves the key to that one.
  useEffect(() => {
    if (!visible || childCount > 0) return;
    const onKeyDownCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return;
      // a panel in a hidden tab stays mounted but is not the one being looked at
      if (!ref.current?.getClientRects().length) return;
      onClose?.();
    };
    window.addEventListener('keydown', onKeyDownCapture, true);
    return () => window.removeEventListener('keydown', onKeyDownCapture, true);
  }, [visible, childCount, onClose]);

  const { title, tableName, openTable } = crumb ?? {};
  const stackValue = useMemo(
    () => ({
      depth: parentStack.depth + 1,
      trail: [...parentStack.trail, { title, tableName, openTable, close: onClose }],
      closeRoot: parentStack.closeRoot ?? onClose,
      registerChild,
    }),
    [
      parentStack.depth,
      parentStack.trail,
      title,
      tableName,
      openTable,
      parentStack.closeRoot,
      onClose,
      registerChild,
    ]
  );

  const onSashPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onSashPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !container) return;
    const rect = container.getBoundingClientRect();
    const isRtl = getComputedStyle(container).direction === 'rtl';
    const next = isRtl ? e.clientX - rect.left : rect.right - e.clientX;
    setStoredWidth(clamp(next - extraWidth, MIN_WIDTH, maxWidth));
  };

  const onSashPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  if (!visible || !container) return null;

  return createPortal(
    // clips the slide-in to the table node, so it comes out of the table's edge instead of
    // sweeping over whatever sits beside the node
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        ref={ref}
        role="region"
        className={cn(
          'pointer-events-auto absolute inset-y-0 end-0 flex flex-col rounded-s-lg border-s bg-background shadow-xl',
          // only the drawer itself slides in; a linked record stacked in it just swaps the content,
          // as going back through the breadcrumb does
          parentStack.depth === 0 && 'animate-in slide-in-from-right rtl:slide-in-from-left',
          dragging && 'select-none',
          // a linked record stacked on top replaces this one until it is closed
          childCount > 0 && 'invisible',
          className
        )}
        style={{ width }}
        // the panel sits inside its opener in the React tree: keys must not reach the grid
        onKeyDown={(e) => e.stopPropagation()}
        onPaste={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* the sidebar's handle: 4px astride the edge, line and grip on hover and while dragging */}
        <div
          className="group absolute inset-y-0 -start-0.5 z-20 w-1 cursor-col-resize touch-none"
          onPointerDown={onSashPointerDown}
          onPointerMove={onSashPointerMove}
          onPointerUp={onSashPointerUp}
          onPointerCancel={onSashPointerUp}
        >
          <ResizeHandleBar />
        </div>
        <ModalContext.Provider value={{ ref }}>
          <ExpandRecordPanelStackContext.Provider value={stackValue}>
            {children}
          </ExpandRecordPanelStackContext.Provider>
        </ModalContext.Provider>
      </div>
    </div>,
    container
  );
};
