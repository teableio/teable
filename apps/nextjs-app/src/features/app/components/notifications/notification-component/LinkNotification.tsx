import { NotificationTypeEnum, type NotificationStatesEnum } from '@teable/core';
import { type INotificationVo } from '@teable/openapi';
import { getLocalizationMessage } from '@teable/sdk/context';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

const getShowMessage = (message: string, t: ILocaleFunction) => {
  try {
    const parsedMessage = JSON.parse(message);
    return getLocalizationMessage(parsedMessage, t);
  } catch (error) {
    return message;
  }
};

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data: { url, message: messageString, notifyType },
  } = props;

  const { t } = useTranslation('system');
  const message = getShowMessage(messageString, t as ILocaleFunction);

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
