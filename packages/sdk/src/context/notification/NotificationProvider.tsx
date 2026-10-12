import type { INotificationBuffer } from '@teable/core';
import { getUserNotificationChannel, isSessionRevokedSignal } from '@teable/core';
import type { FC, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { useSession } from '../../hooks';
import { useConnection } from '../../hooks/use-connection';
import { redirectToUnauthenticatedAuth } from '../app/queryClient';
import { NotificationContext } from './NotificationContext';

interface INotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: FC<INotificationProviderProps> = ({ children }) => {
  const { user } = useSession();
  const { connection } = useConnection();
  const [remotePresence, setRemotePresence] = useState<Presence>();
  const [notification, setNotification] = useState<INotificationBuffer | null>(null);

  useEffect(() => {
    if (!connection) {
      return;
    }

    const channel = getUserNotificationChannel(user.id);
    setRemotePresence(connection.getPresence(channel));

    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, res: INotificationBuffer) => {
      // The same channel carries the one message that is not a notification: the account
      // was deactivated and its sessions revoked. Nothing on this page works from here on,
      // so it leaves for sign-in now instead of on its next refused request.
      if (isSessionRevokedSignal(res)) {
        redirectToUnauthenticatedAuth();
        return;
      }
      setNotification(res);
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.unsubscribe();
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, user.id]);

  return (
    <NotificationContext.Provider value={notification}>{children}</NotificationContext.Provider>
  );
};
