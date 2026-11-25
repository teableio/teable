import { cn } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { useContentDir } from '../../../hooks/use-content-dir';
import { UserAvatar } from './UserAvatar';

interface IUserTag {
  name: string;
  avatar?: ReactNode | string | null;
  className?: string;
  suffix?: ReactNode;
  formatImageUrl?: (url: string) => string;
  isAppUser?: boolean;
}

export const UserTag = (props: IUserTag) => {
  const { name, avatar, suffix, className, formatImageUrl, isAppUser } = props;
  const contentDir = useContentDir();

  return (
    <div
      className={cn(
        'flex items-center h-6 rounded-full text-secondary-foreground ps-[2px] pe-2 gap-1.5',
        isAppUser ? 'bg-blue-50 dark:bg-blue-500/15' : 'bg-secondary',
        className
      )}
    >
      <UserAvatar
        name={name}
        avatar={avatar}
        formatImageUrl={formatImageUrl}
        isAppUser={isAppUser}
        className="size-5"
      />
      <p dir={contentDir} className="flex-1 truncate text-xs" title={name}>
        {name}
      </p>
      {suffix}
    </div>
  );
};
