import type { IActionTriggerBuffer } from '@teable-group/core';
import { getActionTriggerChannel } from '@teable-group/core';
import type { FC, ReactNode } from 'react';
import { useContext, useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import { ActionTriggerContext } from './ActionTriggerContext';

interface INotificationProviderProps {
  children: ReactNode;
}

export const ActionTriggerProvider: FC<INotificationProviderProps> = ({ children }) => {
  const { tableId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [actionTrigger, setActionTrigger] = useState<IActionTriggerBuffer | null>(null);

  useEffect(() => {
    if (tableId == null || connection == null) return;

    const channel = getActionTriggerChannel(tableId);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, res: IActionTriggerBuffer) => {
      setActionTrigger(res);
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.unsubscribe();
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, tableId]);

  return (
    <ActionTriggerContext.Provider value={actionTrigger}>{children}</ActionTriggerContext.Provider>
  );
};
