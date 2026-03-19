import { getActionTriggerChannel } from '@teable/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Presence } from 'sharedb/lib/sharedb';
import { useConnection } from './use-connection';

export interface IActionData {
  actionKey: string;
  payload?: Record<string, unknown>;
}

export const usePresence = (channel: string | undefined) => {
  const { connection } = useConnection();
  const [presence, setPresence] = useState<Presence>();
  const cleanupTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (connection == null || channel == null) return;

    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = undefined;
    }

    const remotePresence = connection.getPresence(channel);

    if (!remotePresence.subscribed && !remotePresence.wantSubscribe) {
      remotePresence.subscribe((err) => {
        if (err) {
          console.error('[usePresence] Subscribe error:', err);
        }
      });
    }

    setPresence(remotePresence);

    return () => {
      cleanupTimeoutRef.current = setTimeout(() => {
        if (remotePresence.listenerCount('receive') === 0) {
          remotePresence.unsubscribe();
          remotePresence.destroy();
        }
      }, 200);
    };
  }, [channel, connection]);

  return presence;
};

export const useActionListener = <T extends IActionData>(
  tableIdOrViewId: string | undefined,
  matches: T['actionKey'][],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  callback: (actionKey: T['actionKey'], payload?: any) => void
) => {
  const presence = usePresence(tableIdOrViewId && getActionTriggerChannel(tableIdOrViewId));
  const relevantProps = useMemo(() => new Set(matches), [matches]);

  useEffect(() => {
    if (!tableIdOrViewId || !presence) {
      return;
    }

    const cb = (_id: string, res: T[]) => {
      const result = res.find(({ actionKey }) => relevantProps.has(actionKey));
      if (result) {
        callback(result.actionKey, result.payload);
      }
    };

    presence.addListener('receive', cb);

    return () => {
      presence.removeListener('receive', cb);
    };
  }, [presence, tableIdOrViewId, callback, relevantProps]);
};
