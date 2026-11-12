import type { ICellItem, IGridRef, IGuideSpotlightRequest } from '@teable/sdk';
import { useGuideSpotlightStore } from '@teable/sdk';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { resolveGuideSpotlight } from '../utils/guideSpotlight';

// scrollToItem needs the grid's measured viewport, and getCellBounds the scroll state the
// scroll lands in; both arrive a render later, so each step waits a beat
const SETTLE_DELAY = 200;
const SPOTLIGHT_DURATION = 6000;

interface IGuideSpotlightProps {
  gridRef: React.RefObject<IGridRef | null>;
  tableId: string;
  fieldsTableId: string | undefined;
  columns: { id?: string }[];
  hasFirstRecord: boolean;
}

const dismiss = (request: IGuideSpotlightRequest) => {
  const { request: current, clear } = useGuideSpotlightStore.getState();
  if (current === request) clear();
};

export const GuideSpotlight = forwardRef<{ onScrollHandler: () => void }, IGuideSpotlightProps>(
  (props, ref) => {
    const { gridRef, tableId, fieldsTableId, columns, hasFirstRecord } = props;
    const request = useGuideSpotlightStore((state) => state.request);
    const [claimed, setClaimed] = useState<{
      request: IGuideSpotlightRequest;
      columnIndex: number;
    } | null>(null);
    const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
    const active = claimed && claimed.request === request ? claimed : null;

    useImperativeHandle(ref, () => ({
      onScrollHandler: () => {
        if (active && position) dismiss(active.request);
      },
    }));

    useEffect(() => {
      if (!request || claimed?.request === request) return;
      const resolution = resolveGuideSpotlight({
        request,
        tableId,
        fieldsTableId,
        columns,
        hasFirstRecord,
        now: Date.now(),
      });
      if (resolution === 'wait') return;
      if (resolution === 'drop') return dismiss(request);
      setClaimed({ request, columnIndex: resolution.columnIndex });
    }, [request, claimed, tableId, fieldsTableId, columns, hasFirstRecord]);

    useEffect(() => {
      if (!active) return;
      const { request, columnIndex } = active;
      const cell: ICellItem = [columnIndex, 0];
      const timers: ReturnType<typeof setTimeout>[] = [];
      const later = (fn: () => void, delay: number) => timers.push(setTimeout(fn, delay));
      let shown = false;

      later(() => {
        gridRef.current?.scrollToItem(cell);
        later(() => {
          const bounds = gridRef.current?.getCellBounds(cell);
          // e.g. the first row sits in a collapsed group
          if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) {
            return dismiss(request);
          }
          shown = true;
          setPosition({ left: bounds.x + bounds.width / 2, top: bounds.y + bounds.height / 2 });
          later(() => dismiss(request), SPOTLIGHT_DURATION);
        }, SETTLE_DELAY);
      }, SETTLE_DELAY);

      const container = gridRef.current?.getContainer();
      const onInteract = () => dismiss(request);
      container?.addEventListener('pointerdown', onInteract, true);
      container?.addEventListener('keydown', onInteract, true);

      return () => {
        timers.forEach(clearTimeout);
        container?.removeEventListener('pointerdown', onInteract, true);
        container?.removeEventListener('keydown', onInteract, true);
        setPosition(null);
        // Leaving the grid ends a spotlight the user has seen; one not shown yet stays for the
        // grid that remounts in its place.
        if (shown) dismiss(request);
      };
    }, [active, gridRef]);

    if (!active || !position) return null;

    return (
      <div
        aria-hidden
        className="pointer-events-none absolute z-40 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
        style={position}
      >
        <span className="absolute inset-0 animate-ping rounded-full border-2 border-blue-500 motion-reduce:animate-none" />
        <span className="size-2.5 rounded-full bg-blue-500 shadow-[0_0_10px_2px_rgb(59_130_246/0.55)]" />
      </div>
    );
  }
);

GuideSpotlight.displayName = 'GuideSpotlight';
