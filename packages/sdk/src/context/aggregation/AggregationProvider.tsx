import type { IRawAggregationVo } from '@teable-group/core';
import { getAggregationChannel } from '@teable-group/core/dist/models/channel';
import type { Presence } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { useIsHydrated } from '../../hooks';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const isHydrated = useIsHydrated();
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregation, setViewAggregation] = useState<IRawAggregationVo>({});

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    const channel = getAggregationChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe((err) => err && console.error);
      remotePresence?.on('receive', (id, viewAggregation: IRawAggregationVo) => {
        setViewAggregation(viewAggregation);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId, viewId]);

  useEffect(() => {
    if (tableId == null || viewId == null || !isHydrated) return;

    View.getViewAggregation(tableId, viewId).then((res) => {
      setViewAggregation({
        [viewId]: {
          ...res,
          executionTime: new Date().getTime(),
        },
      });
    });
  }, [tableId, viewId, connection, isHydrated]);

  return (
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
