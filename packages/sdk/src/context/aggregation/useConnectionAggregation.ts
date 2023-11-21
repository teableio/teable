import type { IRawAggregationVo } from '@teable-group/core';
import { getAggregationChannel } from '@teable-group/core/dist/models/channel';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';

let referenceCount = 0;

export const useConnectionAggregation = () => {
  const { tableId, viewId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [viewAggregation, setViewAggregation] = useState<IRawAggregationVo>();

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

  return viewAggregation;
};
