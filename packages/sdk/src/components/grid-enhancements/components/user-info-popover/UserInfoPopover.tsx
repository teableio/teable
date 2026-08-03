import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import type { FC } from 'react';
import { useShareId } from '../../../../hooks';
import { UserAvatar } from '../../../cell-value/cell-user/UserAvatar';
import { useUserInfoPopoverStore } from './user-info-popover';

interface IUserInfoPopoverProps {
  id?: string;
}

export const UserInfoPopover: FC<IUserInfoPopoverProps> = (props) => {
  const { id } = props;
  const { popoverInfo } = useUserInfoPopoverStore();
  const isShare = useShareId();

  if (!popoverInfo || popoverInfo.id !== id) return null;

  const { user, position } = popoverInfo;
  const style = {
    left: position.x,
    top: position.y,
    width: position.width,
    height: position.height,
  };

  return (
    <Popover open={true}>
      <PopoverTrigger asChild>
        <div className="pointer-events-none absolute" style={style} />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        sideOffset={8}
        className="pointer-events-none w-auto min-w-[200px] p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-3">
          <UserAvatar name={user.name} avatar={user.avatarUrl} className="size-9" />
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {user.name}
              {user.isSystem && (
                <span className="rounded bg-secondary px-1 py-0 text-[10px] leading-4 text-muted-foreground">
                  Bot
                </span>
              )}
            </span>
            {!isShare && user.email && (
              <span className="text-xs text-muted-foreground">{user.email}</span>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
