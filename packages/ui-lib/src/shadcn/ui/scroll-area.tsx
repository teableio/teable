'use client';

import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as React from 'react';
import { useUiDirection } from '../../base/direction/direction';

import { cn } from '../utils';

/**
 * Radix moves the thumb from JS: a `scroll` listener writes its transform on the next
 * animation frame. Browsers scroll on the compositor, so whenever the main thread is busy
 * the thumb trails the content. Where scroll-driven animations are supported, the thumb is
 * driven instead by a scroll timeline of the viewport (`animate-scroll-thumb-*`), which
 * moves in the same frame as the content. Radix still sizes, drags and shows/hides the
 * thumb, and its inline transform remains the fallback: a running animation outranks it.
 */
const ScrollTimelineContext = React.createContext<
  { timeline: string; dir: 'ltr' | 'rtl' } | undefined
>(undefined);

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    scrollBar?: 'horizontal' | 'vertical' | 'both' | 'none';
    viewportRef?: React.Ref<HTMLDivElement>;
  }
>(
  (
    { className, children, onScroll, scrollBar = 'vertical', viewportRef, style, ...props },
    ref
  ) => {
    const uiDir = useUiDirection();
    const dir = props.dir ?? uiDir;
    // Unique per instance, so a nested scroll area never resolves its parent's timeline.
    const timeline = `--scroll-area${React.useId().replace(/[^\w-]/g, '-')}`;
    return (
      <ScrollTimelineContext.Provider value={{ timeline, dir }}>
        <ScrollAreaPrimitive.Root
          dir={dir}
          ref={ref}
          className={cn('relative overflow-hidden', className)}
          // Lets the scrollbars, siblings of the viewport, see its timelines.
          style={{ timelineScope: `${timeline}-x, ${timeline}-y`, ...style }}
          {...props}
        >
          <ScrollAreaPrimitive.Viewport
            ref={viewportRef}
            className="h-full w-full rounded-[inherit]"
            style={{ scrollTimeline: `${timeline}-x x, ${timeline}-y y` }}
            onScroll={onScroll}
          >
            {children}
          </ScrollAreaPrimitive.Viewport>
          {scrollBar && (scrollBar === 'both' || scrollBar === 'vertical') && (
            <ScrollBar orientation="vertical" />
          )}
          {scrollBar && (scrollBar === 'both' || scrollBar === 'horizontal') && (
            <ScrollBar orientation="horizontal" />
          )}
          <ScrollAreaPrimitive.Corner />
        </ScrollAreaPrimitive.Root>
      </ScrollTimelineContext.Provider>
    );
  }
);
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName;

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = 'vertical', ...props }, ref) => {
  const scrollTimeline = React.useContext(ScrollTimelineContext);
  const isHorizontal = orientation === 'horizontal';
  const barRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => barRef.current as HTMLDivElement);
  // The bar's ends stay half the area's corner radius (at least 2px) from its ends, as
  // OverlayScrollbar's do, so a rounded corner never cuts them. Set before Radix first
  // measures the track, since it reads the padding only when the track resizes.
  React.useLayoutEffect(() => {
    const bar = barRef.current;
    const root = bar?.parentElement;
    if (!bar || !root) return;
    const style = getComputedStyle(root);
    const radius = Math.max(
      ...[
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ].map((value) => parseFloat(value) || 0)
    );
    bar.style.setProperty(
      isHorizontal ? 'padding-inline' : 'padding-block',
      `${Math.max(2, radius / 2)}px`
    );
  }, [isHorizontal]);
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={barRef}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        // A size container, so the thumb keyframes can measure the track in cqw/cqh.
        'supports-[animation-timeline:scroll()]:[container-type:size]',
        // Matches the app's overlay scrollbar (OverlayScrollbar): 2px off the edge, a 6px
        // thumb that widens to 9px under the pointer.
        orientation === 'vertical' && 'h-full w-[11px] py-0.5 pe-0.5',
        orientation === 'horizontal' && 'h-[11px] flex-col px-0.5 pb-0.5',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className={cn(
          // The thumb is the hit area; its ::after is the visible bar.
          'relative flex-1 after:absolute after:rounded-full after:bg-foreground/35 after:transition-all hover:after:bg-foreground/50',
          isHorizontal
            ? 'after:inset-x-0 after:bottom-0 after:h-1.5 hover:after:h-[9px]'
            : 'after:inset-y-0 after:end-0 after:w-1.5 hover:after:w-[9px]',
          scrollTimeline &&
            (isHorizontal
              ? scrollTimeline.dir === 'rtl'
                ? 'supports-[animation-timeline:scroll()]:animate-scroll-thumb-x-rtl'
                : 'supports-[animation-timeline:scroll()]:animate-scroll-thumb-x'
              : 'supports-[animation-timeline:scroll()]:animate-scroll-thumb-y')
        )}
        style={
          scrollTimeline && {
            animationTimeline: `${scrollTimeline.timeline}-${isHorizontal ? 'x' : 'y'}`,
          }
        }
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
});
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName;

export { ScrollArea, ScrollBar };
