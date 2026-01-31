import { Avatar, AvatarFallback, cn } from '@teable/ui-lib/shadcn';

interface ISpaceAvatarProps {
  name: string;
  className?: string;
}

export const SpaceAvatar = ({ name, className }: ISpaceAvatarProps) => {
  const initial = name?.charAt(0).toUpperCase() || '?';

  return (
    <Avatar className={cn('shrink-0 rounded border', className)}>
      <AvatarFallback className={cn('rounded bg-background text-foreground font-medium ')}>
        {initial}
      </AvatarFallback>
    </Avatar>
  );
};
