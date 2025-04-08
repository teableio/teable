import type { NotificationStatesEnum } from '@teable/core';
import { type INotificationVo } from '@teable/openapi';
import Link from 'next/link';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data: { url, message },
  } = props;

  return (
    <Link href={url}>
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
      />
    </Link>
  );
};
