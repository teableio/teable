import { Avatar, AvatarFallback, AvatarImage } from '@teable/ui-lib/shadcn';
import { getImageProps } from 'next/image';
import React from 'react';

interface UserAvatarProps {
  user: { name: string; avatar?: string | null };
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
}

export const UserAvatar: React.FC<UserAvatarProps> = (props) => {
  const { user, width = 28, height = 28, className = 'size-7', style } = props;

  const { props: userAvatarProps } = getImageProps({
    width,
    height,
    src: user.avatar as string,
    alt: user.name,
  });

  return (
    <Avatar className={className} style={style}>
      <AvatarImage {...userAvatarProps} />
      <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
};
