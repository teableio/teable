import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { isValidElement, type ReactNode } from 'react';
import { convertNextImageUrl } from '../../grid-enhancements/utils';

export interface IUserAvatarProps {
  name: string;
  avatar?: ReactNode;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  formatImageUrl?: (url: string) => string;
}

export const UserAvatar = (props: IUserAvatarProps) => {
  const { name, avatar, size = 64, className, style, formatImageUrl } = props;

  if (isValidElement(avatar)) {
    return avatar;
  }

  return (
    <Avatar
      className={cn(
        'size-6 border bg-background',
        {
          'bg-gray-300': name === 'Deleted User',
        },
        className
      )}
      style={style}
    >
      <AvatarImage
        src={
          avatar
            ? formatImageUrl
              ? formatImageUrl(avatar as string)
              : convertNextImageUrl({
                  url: avatar as string,
                  w: size,
                  q: 75,
                })
            : undefined
        }
        alt={name}
      />
      <AvatarFallback>{name?.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
};
