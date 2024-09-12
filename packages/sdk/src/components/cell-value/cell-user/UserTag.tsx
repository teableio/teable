import { cn } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { UserAvatar } from './UserAvatar';

interface IUserTag {
  name: string;
  avatar?: ReactNode | string | null;
  className?: string;
  suffix?: ReactNode;
  formatImageUrl?: (url: string) => string;
}

export const UserTag = (props: IUserTag) => {
  const { name, avatar, suffix, className, formatImageUrl } = props;

  return (
    <div className={cn('flex items-center text-sm', className)}>
      <UserAvatar name={name} avatar={avatar} formatImageUrl={formatImageUrl} />
      <div className="-ml-3 flex items-center overflow-hidden rounded-[6px] bg-secondary pl-4 pr-2 text-secondary-foreground">
        <p className="flex-1 truncate" title={name}>
          {name}
        </p>
        {suffix}
      </div>
    </div>
  );
};
