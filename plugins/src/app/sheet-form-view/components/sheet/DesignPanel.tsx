import { useIsHydrated } from '@teable/sdk';
import { forwardRef, lazy } from 'react';
import { SheetSkeleton } from './SheetSkeleton';
import type { IUniverSheetProps, IUniverSheetRef } from './UniverSheet';

// univer could not support SSR Well, if use next/dynamic, ref will be lost.
const UniverSheet = lazy(() => import('./UniverSheet'));

export const DesignPanel = forwardRef<IUniverSheetRef | null, IUniverSheetProps>((props, ref) => {
  const isHydrated = useIsHydrated();
  return isHydrated ? (
    <div className="size-full overflow-hidden rounded-sm border">
      <UniverSheet {...props} ref={ref} />
    </div>
  ) : (
    <SheetSkeleton />
  );
});

DesignPanel.displayName = 'DesignPanel';
