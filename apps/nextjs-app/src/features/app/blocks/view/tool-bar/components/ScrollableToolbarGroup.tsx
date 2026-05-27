import { cn } from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const fadeWidth = 32;

interface IScrollableToolbarGroupProps {
  children: ReactNode;
  className?: string;
}

export const ScrollableToolbarGroup = (props: IScrollableToolbarGroupProps) => {
  const { children, className } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [{ canScrollLeft, canScrollRight }, setScrollState] = useState({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    const maxContentScrollLeft = maxScrollLeft - fadeWidth;
    const nextState = {
      canScrollLeft: el.scrollLeft > 1,
      canScrollRight: maxContentScrollLeft > 1 && el.scrollLeft < maxContentScrollLeft - 1,
    };

    setScrollState((prevState) =>
      prevState.canScrollLeft === nextState.canScrollLeft &&
      prevState.canScrollRight === nextState.canScrollRight
        ? prevState
        : nextState
    );
  }, []);

  useEffect(() => {
    updateScrollState();
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);
    Array.from(el.children).forEach((child) => resizeObserver.observe(child));
    el.addEventListener('scroll', updateScrollState, { passive: true });

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener('scroll', updateScrollState);
    };
  }, [updateScrollState]);

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        className={cn(
          'flex gap-1 overflow-x-auto overflow-y-hidden pr-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          className
        )}
      >
        {children}
      </div>
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity duration-150',
          canScrollLeft ? 'opacity-100' : 'opacity-0'
        )}
      />
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity duration-150',
          canScrollRight ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  );
};
