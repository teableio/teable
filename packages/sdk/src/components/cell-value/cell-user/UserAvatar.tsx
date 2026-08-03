import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { isValidElement, type ReactNode } from 'react';

export interface IUserAvatarProps {
  name: string;
  avatar?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  formatImageUrl?: (url: string) => string;
}

export const UserAvatar = (props: IUserAvatarProps) => {
  const { name, avatar, className, style, formatImageUrl } = props;

  if (isValidElement(avatar)) {
    return avatar;
  }

  const avatarUrl = avatar
    ? formatImageUrl
      ? formatImageUrl(avatar as string)
      : (avatar as string)
    : undefined;

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
      <AvatarImage src={avatarUrl} alt={name} />
      <AvatarFallback>{name?.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
};
