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
    <div
      className={cn(
        'flex items-center h-6 rounded-full bg-secondary text-secondary-foreground pl-[2px] pr-2 gap-1.5',
        className
      )}
    >
      <UserAvatar name={name} avatar={avatar} formatImageUrl={formatImageUrl} className="size-5" />
      <p className="flex-1 truncate text-xs" title={name}>
        {name}
      </p>
      {suffix}
    </div>
  );
};
