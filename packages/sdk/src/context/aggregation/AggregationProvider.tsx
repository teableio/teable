import type { IViewAggregationVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
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

export const AggregationProvider: FC<IAggregationProviderProps> = ({ children }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregation, setViewAggregation] = useState<IViewAggregationVo>({});

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    setRemotePresence(connection.getPresence(`${IdPrefix.View}_${tableId}_${viewId}_aggregation`));

    console.log(
      'remotePresence.wantSubscribe: ',
      remotePresence?.wantSubscribe,
      'subscribed: ',
      remotePresence?.subscribed
    );

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe((err) => err && console.error);
      remotePresence?.on('receive', (id, viewAggregation: IViewAggregationVo) => {
        console.log(remotePresence?.remotePresences);

        console.log(`receive: ${id} - aggregation: ${JSON.stringify(viewAggregation, null, 4)}`);
        setViewAggregation(viewAggregation);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId, viewId]);

  useEffect(() => {
    if (tableId == null || viewId == null) return;

    const controller = new AbortController();

    View.getViewAggregation(tableId, viewId).then((res) => {
      console.log('AggregationProvider - getViewAggregation', res);
      setViewAggregation(res);
    });
    return () => {
      controller.abort();
    };
  }, [tableId, viewId]);

  return (
    <AggregationContext.Provider value={viewAggregation}>{children}</AggregationContext.Provider>
  );
};
