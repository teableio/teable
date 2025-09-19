import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib/shadcn';
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
  const { user, width = 28, height = 28, className, style } = props;
  const { name, avatar } = user;

  const userAvatarProps = getImageProps({
    width,
    height,
    src: avatar || '',
    alt: name,
    style: { objectFit: 'cover' },
    quality: 100,
  }).props;

  return (
    <Avatar className={cn('size-7 bg-background', className)} style={style}>
      <AvatarImage {...userAvatarProps} />
      <AvatarFallback>{name?.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
};
