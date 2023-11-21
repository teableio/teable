import type { IRawAggregationVo } from '@teable-group/core';
import { getAggregationChannel } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { useIsHydrated } from '../../hooks';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

let referenceCount = 0;

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregation, setViewAggregation] = useState<IRawAggregationVo>({});

  useEffect(() => {
    const canCreatePresence = tableId && viewId && connection;
    if (!canCreatePresence) {
      return;
    }
    referenceCount++;
    const channel = getAggregationChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, viewAggregation: IRawAggregationVo) => {
      setViewAggregation(viewAggregation);
    };

    remotePresence?.on('receive', (id, viewAggregation: IRawAggregationVo) => {
      setViewAggregation(viewAggregation);
    });

    return () => {
      canCreatePresence && referenceCount--;
      remotePresence?.removeListener('receive', receiveHandler);
      if (referenceCount === 0) {
        remotePresence?.unsubscribe();
        remotePresence?.destroy();
      }
    };
  }, [connection, remotePresence, tableId, viewId]);

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
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
