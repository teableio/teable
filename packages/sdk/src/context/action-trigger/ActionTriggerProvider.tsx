import type { IActionTriggerBuffer } from '@teable/core';
import { getActionTriggerChannel } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { AnchorContext } from '../anchor';
import { AppContext } from '../app';
import type { PropKeys } from './ActionTriggerContext';
import { ActionTriggerContext } from './ActionTriggerContext';

interface INotificationProviderProps {
  children: ReactNode;
}

export const ActionTriggerProvider: FC<INotificationProviderProps> = ({ children }) => {
  const { tableId } = useContext(AnchorContext);
  const { connection } = useContext(AppContext);

  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [actionTrigger, setActionTrigger] = useState<IActionTriggerBuffer>();

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

  const listener = useCallback(
    (propKeys: PropKeys[], callback: () => void, deps?: unknown[]) => {
      if (actionTrigger == null) return;

      const actionSets = propKeys
        .map((prop) => actionTrigger[prop])
        .filter(Boolean)
        .flat();

      const isRelevantAction = actionSets.length > 0;

      const hasSpecificKeys = ['tableAdd', 'tableUpdate', 'tableDelete'].some(
        (key) => key in actionTrigger
      );

      const isDependencyTriggered = hasSpecificKeys
        ? deps?.some((dep) => actionSets.includes(dep as string))
        : deps?.every((dep) => actionSets.includes(dep as string));

      if (deps ? isDependencyTriggered : isRelevantAction) {
        callback?.();
      }
    },
    [actionTrigger]
  );

  const value = useMemo(() => ({ data: actionTrigger, listener }), [actionTrigger, listener]);
  return <ActionTriggerContext.Provider value={value}>{children}</ActionTriggerContext.Provider>;
};
