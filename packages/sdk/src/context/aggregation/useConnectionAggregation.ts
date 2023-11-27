import type { IRawAggregationVo } from '@teable-group/core';
import { getAggregationChannel } from '@teable-group/core';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';

let referenceCount = 0;

export const useConnectionAggregation = (onChange?: () => void) => {
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
      onChange?.();
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      canCreatePresence && referenceCount--;
      if (referenceCount === 0) {
        remotePresence?.unsubscribe();
        remotePresence?.destroy();
      }
      setRemotePresence(undefined);
    };
  }, [connection, onChange, remotePresence, tableId, viewId]);

  return viewAggregation;
};
