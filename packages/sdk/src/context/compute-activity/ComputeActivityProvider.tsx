import type { FC, ReactNode } from 'react';
import { useComputeActivitySubscription } from '../../hooks/use-compute-activity';
import { ComputeActivityContext } from './ComputeActivityContext';

/**
 * Runs compute-activity subscription once for a table subtree and shares
 * revision/fieldMeta with useGridColumns + panel so column themes recompute.
 */
export const ComputeActivityProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const activity = useComputeActivitySubscription();
  return (
    <ComputeActivityContext.Provider value={activity}>{children}</ComputeActivityContext.Provider>
  );
};
