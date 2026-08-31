import { Spin } from '@teable/ui-lib/base';

/**
 * Neutral main-area placeholder (top bar + centered spinner) for base pages
 * whose layout can't be mocked while their client-only chunk loads (automation,
 * app, dashboard). Shared with the base-entry transition overlay's plain
 * variant so the space→base transition and a hard refresh read identically.
 */
export const PlainPageSkeleton = () => (
  <div className="flex h-full min-w-0 flex-1 flex-col">
    <div className="h-12 shrink-0 border-b" />
    <div className="flex flex-1 items-center justify-center">
      <Spin className="size-5 text-muted-foreground" />
    </div>
  </div>
);
