import type { INotification } from '@teable/core';
import { updateNotificationStatus } from '@teable/openapi';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@teable/ui-lib';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { getShowMessage } from './notification-component/get-show-message';

interface IImportantNotificationPopupProps {
  notifications: INotification[];
  onAcknowledge: (id: string) => void;
}

export const ImportantNotificationPopup = ({
  notifications,
  onAcknowledge,
}: IImportantNotificationPopupProps) => {
  const { t } = useTranslation('common');
  const [isLoading, setIsLoading] = useState(false);

  const current = notifications[0];
  if (!current) return null;

  const message = getShowMessage(current, t as ILocaleFunction);

  const handleAcknowledge = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsLoading(true);
    await updateNotificationStatus({
      notificationId: current.id,
      updateNotifyStatusRo: { isRead: true },
    })
      .then(() => {
        onAcknowledge(current.id);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return (
    <AlertDialog open>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('notification.importantNotice.title')}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div
              className="break-words [overflow-wrap:anywhere] [&_a]:text-blue-500 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: message }}
            />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction disabled={isLoading} onClick={handleAcknowledge}>
            {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
            {t('notification.importantNotice.acknowledge')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
