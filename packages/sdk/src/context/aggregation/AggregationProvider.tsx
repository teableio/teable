import type { IViewAggregationVo } from '@teable-group/core';
import { getAggregationChannel } from '@teable-group/core/dist/models/channel';
import type { Presence } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { AggregationContext } from './AggregationContext';

interface IAggregationProviderProps {
  children: ReactNode;
}

const previousSet = new Set();

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregation, setViewAggregation] = useState<IViewAggregationVo>({});

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    const channel = getAggregationChannel(tableId, viewId);
    setRemotePresence(connection.getPresence(channel));

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe((err) => err && console.error);
      remotePresence?.on('receive', (id, viewAggregation: IViewAggregationVo) => {
        setViewAggregation(viewAggregation);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId, viewId]);

  useEffect(() => {
    if (tableId == null || viewId == null) return;
    if (previousSet.has(`${tableId}-${viewId}`)) return;
    previousSet.add(`${tableId}-${viewId}`);

    View.getViewAggregation(tableId, viewId).then((res) => {
      previousSet.clear();
      setViewAggregation(res);
    });
  }, [tableId, viewId, connection]);

  return (
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
