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
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      ref={ref}
      orientation={orientation}
      className={cn(
        'flex touch-none select-none transition-colors',
        // A size container, so the thumb keyframes can measure the track in cqw/cqh.
        'supports-[animation-timeline:scroll()]:[container-type:size]',
        orientation === 'vertical' && 'h-full w-2.5 border-s border-s-transparent p-[1px]',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent p-[1px]',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        className={cn(
          'relative flex-1 rounded-full bg-border',
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
