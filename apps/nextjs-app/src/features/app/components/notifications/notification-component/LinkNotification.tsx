import { NotificationTypeEnum } from '@teable/core';
import type { NotificationStatesEnum } from '@teable/core';
import { type INotificationVo } from '@teable/openapi';
import type { ILocaleFunction } from '@teable/sdk/context/app/i18n';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { getShowMessage } from './get-show-message';

interface LinkNotificationProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
  disableLink?: boolean;
}

export const LinkNotification = (props: LinkNotificationProps) => {
  const {
    data,
    data: { url, notifyType },
    disableLink,
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

  if (disableLink || !url || notifyType === NotificationTypeEnum.ExportBase) {
    return (
      <>
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          className="max-h-20 min-w-0 max-w-full flex-1 overflow-auto break-words [overflow-wrap:anywhere]"
          dangerouslySetInnerHTML={{ __html: message }}
          onClick={handleContentClick}
        />
        {/* do not delete this div for tailwind css */}
        <div className="hidden underline hover:text-blue-500"></div>
      </>
    );
  }

  return (
    <Link href={url} className="min-w-0 max-w-full flex-1">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="max-h-20 min-w-0 max-w-full overflow-auto break-words [overflow-wrap:anywhere]"
        dangerouslySetInnerHTML={{ __html: message }}
        onClick={handleContentClick}
      />
    </Link>
  );
};
