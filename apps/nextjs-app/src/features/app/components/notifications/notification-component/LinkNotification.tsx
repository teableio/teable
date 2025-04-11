import { NotificationTypeEnum, type NotificationStatesEnum } from '@teable/core';
import { type INotificationVo } from '@teable/openapi';
import Link from 'next/link';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data: { url, message, notifyType },
  } = props;

  return notifyType !== NotificationTypeEnum.ExportBase ? (
    <Link href={url}>
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
      />
    </Link>
  ) : (
    <>
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
      />
      {/* do not delete this div for tailwind css */}
      <div className="hidden underline hover:text-blue-500"></div>
    </>
  );
};
