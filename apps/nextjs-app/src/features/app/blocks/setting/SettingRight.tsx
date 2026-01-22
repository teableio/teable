import { useSession } from '@teable/sdk/hooks';
import { cn } from '@teable/ui-lib/shadcn';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface ISettingRight {
  header?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
}

export const SettingRight = (props: ISettingRight) => {
  const { header, actions, children, contentClassName } = props;
  const { user } = useSession();
  return (
    <div className="size-full">
      <div className="flex h-full flex-col">
        {header && (
          <div className="flex items-start justify-between gap-4 border-b px-8 py-4">
            <div className="flex flex-1 items-start gap-2">{header}</div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <UserAvatar user={user} />
            </div>
          </div>
        )}
        <div className={cn('flex-1 overflow-y-auto px-8 py-4', contentClassName)}>{children}</div>
      </div>
    </div>
  );
};
