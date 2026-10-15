import { cn } from '@teable/ui-lib/shadcn';
import type { HTMLAttributes } from 'react';

const LIGHT_COLORS = [
  'bg-zinc-100 dark:bg-zinc-900',
  'bg-zinc-100 bg-opacity-25 dark:bg-zinc-900 dark:bg-opacity-25',
  'bg-zinc-50 dark:bg-zinc-900',
  'bg-zinc-50 bg-opacity-25 dark:bg-zinc-900 dark:bg-opacity-25',
];

/**
 * Deterministic 0..1 pseudo-random value for a seed.
 *
 * These placeholders must render identical styles on the server and during
 * hydration: a real `Math.random()` produces a different value on each render
 * and React reports a hydration mismatch (visible only in dev, but the tree is
 * silently regenerated in production).
 */
const pseudoRandom = (seed: number): number => {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

export const Rectangles = ({
  amount,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  amount: number;
}) => {
  return Array.from({ length: amount }).map((_, index) => {
    const randomColor = LIGHT_COLORS[Math.floor(pseudoRandom(index + 1) * LIGHT_COLORS.length)];

    // 3 decimals keep the value exactly serializable: a longer fraction is
    // truncated when the browser re-reads the style attribute during
    // hydration, which React reports as a hydration attribute mismatch.
    const randomDuration = Math.round((pseudoRandom(index + 2) * 3 + 2) * 1000) / 1000;

    return (
      <div
        key={index}
        className={cn(randomColor, className)}
        style={{
          ...style,
          animation: `pulse ${randomDuration}s cubic-bezier(0.4, 0, 0.6, 1) infinite`,
        }}
        {...props}
      />
    );
  });
};
