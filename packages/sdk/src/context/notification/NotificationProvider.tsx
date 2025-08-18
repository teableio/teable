import type { INotificationBuffer } from '@teable/core';
import { getUserNotificationChannel } from '@teable/core';
import { toast } from '@teable/ui-lib/src/shadcn/ui/sonner';
import { BellRingIcon } from 'lucide-react';
import type { FC, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Presence } from 'sharedb/lib/client';
import { useSession } from '../../hooks';
import { useConnection } from '../../hooks/use-connection';
import { useTranslation } from '../app/i18n';
import { NotificationContext } from './NotificationContext';

interface INotificationProviderProps {
  children: ReactNode;
}

export const NotificationProvider: FC<INotificationProviderProps> = ({ children }) => {
  const { user } = useSession();
  const { connection } = useConnection();
  const { t } = useTranslation();
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
      if (!res.notification.isRead) {
        toast(t('notification.title'), {
          description: res.notification.message,
          icon: <BellRingIcon className="size-4" />,
        });
      }
      setNotification(res);
    };

    remotePresence?.on('receive', receiveHandler);

    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.unsubscribe();
      remotePresence?.destroy();
    };
  }, [connection, remotePresence, t, user.id]);

  return (
    <NotificationContext.Provider value={notification}>{children}</NotificationContext.Provider>
  );
};
