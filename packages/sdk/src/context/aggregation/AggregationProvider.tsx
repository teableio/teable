import type { IRawAggregationVo } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { useIsHydrated } from '../../hooks';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { AggregationContext } from './AggregationContext';
import { useConnectionAggregation } from './useConnectionAggregation';

interface IAggregationProviderProps {
  children: ReactNode;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [viewAggregation, setViewAggregation] = useState<IRawAggregationVo>({});

  const connectionAggregation = useConnectionAggregation();

  useEffect(() => {
    if (tableId == null || viewId == null || !isHydrated) return;

    View.getViewAggregations(tableId, viewId).then((res) => {
      const { viewId, aggregations } = res.data;
      setViewAggregation({
        [viewId]: {
          viewId: viewId,
          aggregations: aggregations ?? [],
          executionTime: new Date().getTime(),
        },
      });
    });
  }, [tableId, viewId, connection, isHydrated]);

  return (
    <AggregationContext.Provider value={connectionAggregation ?? viewAggregation}>
      {children}
    </AggregationContext.Provider>
  );
};
