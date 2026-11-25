import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib';
import { AppWindowMac } from 'lucide-react';
import { isValidElement, type ReactNode } from 'react';

export interface IUserAvatarProps {
  name: string;
  avatar?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  formatImageUrl?: (url: string) => string;
  /** Someone who signed in to an App: without a picture they show the App icon on blue. */
  isAppUser?: boolean;
}

export const UserAvatar = (props: IUserAvatarProps) => {
  const { name, avatar, className, style, formatImageUrl, isAppUser } = props;

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
          'border-transparent': isAppUser,
        },
        className
      )}
      style={style}
    >
      <AvatarImage src={avatarUrl} alt={name} />
      {isAppUser ? (
        <AvatarFallback className="bg-blue-600 text-white">
          <AppWindowMac className="size-3/5" />
        </AvatarFallback>
      ) : (
        <AvatarFallback>{name?.slice(0, 1)}</AvatarFallback>
      )}
    </Avatar>
  );
};
