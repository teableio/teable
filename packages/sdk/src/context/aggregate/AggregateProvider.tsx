import type { IViewAggregateVo } from '@teable-group/core';
import { IdPrefix } from '@teable-group/core';
import type { Presence } from '@teable/sharedb/lib/client';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { View } from '../../model';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { AggregateContext } from './AggregateContext';

interface IAggregateProviderProps {
  children: ReactNode;
}

export const AggregateProvider: FC<IAggregateProviderProps> = ({ children }) => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregate, setViewAggregate] = useState<IViewAggregateVo>({});

  // const viewAggregateData = useCallback(async () => {
  //   if (!tableId || !viewId) {
  //     return;
  //   }
  //
  //   const data = await View.getViewAggregate(tableId, viewId);
  //   console.log('setViewAggregate', data);
  //   // setViewAggregate(data);
  //   return data;
  // }, [tableId, viewId]);

  useEffect(() => {
    if (!tableId || !viewId || !connection) {
      return;
    }

    // console.log(viewAggregateData());
    setRemotePresence(connection.getPresence(`${IdPrefix.View}_${tableId}_${viewId}_aggregate`));

    console.log('remotePresence.wantSubscribe', remotePresence?.wantSubscribe);
    console.log('remotePresence.subscribed', remotePresence?.subscribed);

    if (!remotePresence?.subscribed) {
      remotePresence?.subscribe(console.error);
      remotePresence?.on('receive', (id, viewAggregateVo: IViewAggregateVo) => {
        console.log(remotePresence?.remotePresences);

        console.log(`receive: ${id} - aggregate: ${JSON.stringify(viewAggregateVo, null, 4)}`);
        setViewAggregate(viewAggregateVo);
      });
    }

    return () => {
      remotePresence?.destroy();
    };
  }, [connection, tableId, viewId, remotePresence]);

  const value = useMemo(() => {
    return viewAggregate;
  }, [viewAggregate]);

  return <AggregateContext.Provider value={value}>{children}</AggregateContext.Provider>;
};
