import { NotificationTypeEnum, type NotificationStatesEnum } from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import React from 'react';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';

interface INotificationItemProps extends React.HTMLAttributes<HTMLElement> {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

export const NotificationItem = React.forwardRef<HTMLElement, INotificationItemProps>(
  (props, ref) => {
    const { data, notifyStatus, ...rest } = props;
    const { notifyIcon, notifyType, createdTime, url } = data;
    const dayjs = useLanDayjs();
    const fromNow = dayjs(createdTime).fromNow();
    const isExportBase = notifyType === NotificationTypeEnum.ExportBase;

    const className = cn(
      'm-1 flex flex-auto cursor-pointer items-center rounded-sm px-6 py-2 hover:bg-accent'
    );

    const content = (
      <>
        <NotificationIcon notifyIcon={notifyIcon} notifyType={notifyType} />

        <div className="mr-3 w-full items-center overflow-hidden whitespace-pre-wrap break-words text-sm font-normal">
          <div className="overflow-auto">
            <LinkNotification data={data} notifyStatus={notifyStatus} disableLink />
          </div>

          <div className="truncate text-[11px] opacity-75" title={fromNow}>
            {fromNow}
          </div>
        </div>
      </>
    );

    if (isExportBase) {
      return (
        <div ref={ref as React.Ref<HTMLDivElement>} className={className} {...rest}>
          {content}
        </div>
      );
    }

    return (
      <Link ref={ref as React.Ref<HTMLAnchorElement>} href={url} className={className} {...rest}>
        {content}
      </Link>
    );
  }
);

NotificationItem.displayName = 'NotificationItem';
