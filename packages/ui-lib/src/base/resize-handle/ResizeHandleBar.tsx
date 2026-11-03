import type { CSSProperties } from 'react';
import { useRef } from 'react';

/**
 * A `re-resizable` handle's style: 4px astride the edge, above the page beside it, whose
 * positioned content would otherwise cover it.
 */
export const resizeHandleStyle = (handle: 'left' | 'right'): CSSProperties => ({
  width: '4px',
  [handle]: '-2px',
  zIndex: 20,
});

/**
 * What a drag handle shows on hover and while dragging, as the grid's freeze handle does: a 2px
 * line on the edge and a grip at the pointer. Goes in a handle classed `group`. Shared by the
 * sidebar, the space shell's side columns and the record side panel.
 */
export const ResizeHandleBar = () => {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className="relative size-full"
      onPointerMove={(event) => {
        const bar = ref.current;
        if (!bar) return;
        const y = event.clientY - bar.getBoundingClientRect().top;
        bar.style.setProperty('--grip-y', `${y}px`);
      }}
    >
      {/* Centred by translate: the grip is wider than the handle, which auto margins can't centre. */}
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-blue-500 opacity-0 group-hover:opacity-100 group-active:opacity-100" />
      <div className="absolute left-1/2 top-[var(--grip-y,50%)] h-[30px] w-2 -translate-x-1/2 -translate-y-1/2 rounded bg-blue-500 opacity-0 group-hover:opacity-100 group-active:opacity-100" />
    </div>
  );
};
