import { getRandomFloat } from '@teable/core';
import { cn } from '@teable/ui-lib/shadcn';
import type { HTMLAttributes } from 'react';

export const Rectangles = ({
  amount,
  className,
  style,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  amount: number;
}) => {
  const LIGHT_COLORS = [
    'bg-zinc-100 dark:bg-zinc-900',
    'bg-zinc-100 bg-opacity-25 dark:bg-zinc-900 dark:bg-opacity-25',
    'bg-zinc-50 dark:bg-zinc-900',
    'bg-zinc-50 bg-opacity-25 dark:bg-zinc-900 dark:bg-opacity-25',
  ];

  return Array.from({ length: amount }).map((_, index) => {
    const randomColor = LIGHT_COLORS[Math.floor(getRandomFloat() * LIGHT_COLORS.length)];

    const randomDuration = getRandomFloat() * 3 + 2;

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
