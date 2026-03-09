import { NotificationTypeEnum } from '@teable/core';
import type { ILocalization, NotificationStatesEnum } from '@teable/core';
import { type INotificationVo } from '@teable/openapi';
import { getLocalizationMessage } from '@teable/sdk/context';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

const getShowMessage = (data: INotificationVo['notifications'][number], t: ILocaleFunction) => {
  const { message, messageI18n } = data;
  try {
    if (!messageI18n) {
      return message;
    }
    const parsedMessage = JSON.parse(messageI18n);
    const { i18nKey = '', context = {} } = parsedMessage as ILocalization;
    if (!i18nKey) {
      return message;
    }
    return getLocalizationMessage({ i18nKey, context: { spaceName: '', ...context } }, t, 'common');
  } catch (error) {
    return message;
  }
};

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data,
    data: { url, notifyType },
  } = props;

  const { t } = useTranslation(['common']);
  const message = getShowMessage(data, t as ILocaleFunction);

  // When the message contains inner <a> links (e.g. error report download),
  // we need to stop the click from bubbling up to the parent <Link> which
  // would navigate to the table URL instead.
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'A' || target.closest('a')) {
      e.stopPropagation();
      e.preventDefault();
      const anchor = (target.tagName === 'A' ? target : target.closest('a')) as HTMLAnchorElement;
      if (anchor?.href) {
        window.open(anchor.href, anchor.target || '_blank', 'noopener,noreferrer');
      }
    }
  };

  return notifyType !== NotificationTypeEnum.ExportBase ? (
    <Link href={url}>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="max-h-20 overflow-auto break-words"
        dangerouslySetInnerHTML={{ __html: message }}
        onClick={handleContentClick}
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
