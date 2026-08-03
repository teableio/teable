import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib/shadcn';
import React from 'react';

interface UserAvatarProps {
  user: { name: string; avatar?: string | null };
  className?: string;
  style?: React.CSSProperties;
}

export const UserAvatar: React.FC<UserAvatarProps> = (props) => {
  const { user, className, style } = props;
  const { name, avatar } = user;

  return (
    <Avatar className={cn('size-7 bg-background', className)} style={style}>
      <AvatarImage src={avatar || undefined} alt={name} />
      <AvatarFallback>{name?.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
};
