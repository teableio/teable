import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import type { ReactNode } from 'react';
import { isValidElement, useMemo } from 'react';
import { convertNextImageUrl } from '../../grid-enhancements';

interface IUserTag {
  name?: string;
  avatar?: ReactNode | string | null;
  className?: string;
  suffix?: ReactNode;
}

export const UserTag = (props: IUserTag) => {
  const { name = 'Untitled', avatar, suffix, className } = props;

  const avatarComponent = useMemo(() => {
    if (isValidElement(avatar)) {
      return avatar;
    }
    return (
      <>
        <AvatarImage
          src={
            avatar
              ? convertNextImageUrl({
                  url: avatar as string,
                  w: 64,
                  q: 75,
                })
              : undefined
          }
          alt={name}
        />
        <AvatarFallback className="text-sm">{name.slice(0, 1)}</AvatarFallback>
      </>
    );
  }, [name, avatar]);

  return (
    <div className={cn('flex items-center', className)}>
      <Avatar className="size-6 cursor-pointer border">{avatarComponent}</Avatar>
      <div className="-ml-3 flex items-center overflow-hidden rounded-[6px] bg-secondary pl-4 pr-2 text-sm text-secondary-foreground">
        <p className="flex-1 truncate">{name}</p>
        {suffix}
      </div>
    </div>
  );
};
