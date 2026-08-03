import { Avatar, AvatarFallback, AvatarImage, cn } from '@teable/ui-lib/shadcn';
import { useAsync } from 'react-use';

const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });

interface ISpaceAvatarProps {
  name: string;
  avatar?: string | null;
  className?: string;
}

export const SpaceAvatar = ({ name, avatar, className }: ISpaceAvatarProps) => {
  const initial = name?.charAt(0).toUpperCase() || '?';
  const { value: displayAvatar } = useAsync(async () => {
    if (!avatar) {
      return undefined;
    }
    await preloadImage(avatar);
    return avatar;
  }, [avatar]);

  return (
    <Avatar className={cn('shrink-0 rounded border', className)}>
      <AvatarImage src={displayAvatar || undefined} alt={name} />
      <AvatarFallback className={cn('rounded bg-background text-foreground font-medium ')}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
};
