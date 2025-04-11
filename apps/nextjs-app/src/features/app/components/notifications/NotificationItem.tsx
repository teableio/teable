import { type NotificationStatesEnum } from '@teable/core';
import type { INotificationVo } from '@teable/openapi';
import { useLanDayjs } from '@teable/sdk/hooks';
import { LinkNotification } from './notification-component';
import { NotificationIcon } from './NotificationIcon';

interface INotificationItemProps {
  data: INotificationVo['notifications'][number];
  notifyStatus: NotificationStatesEnum;
}

export const NotificationItem = (props: INotificationItemProps) => {
  const { data, notifyStatus } = props;

  const { notifyIcon, notifyType, createdTime } = data;

  const dayjs = useLanDayjs();

  const fromNow = dayjs(createdTime).fromNow();

  return (
    <div className="m-1 flex flex-auto cursor-pointer items-center rounded-sm px-6 py-2 hover:bg-accent">
      <NotificationIcon notifyIcon={notifyIcon} notifyType={notifyType} />

      <div className="mr-3 w-full items-center overflow-hidden whitespace-pre-wrap break-words text-sm font-normal">
        <div className="overflow-auto">
          <LinkNotification data={data} notifyStatus={notifyStatus} />
        </div>

        <div className="truncate text-[11px] opacity-75" title={fromNow}>
          {fromNow}
        </div>
      </div>
    </div>
  );
};
