import { cn } from '@teable/ui-lib/shadcn';
import { UserAvatar } from '../../user/UserAvatar';

interface ICollaboratorProps {
  name: string;
  email: string;
  avatar?: string | null;
  className?: string;
  tips?: React.ReactNode;
}

export const Collaborator = (props: ICollaboratorProps) => {
  const { name, email, avatar, className, tips } = props;

  return (
    <div className={cn('flex flex-1', className)}>
      <UserAvatar user={{ name, avatar }} />
      <div className="ml-2 flex flex-1 flex-col space-y-1">
        <p className="text-sm font-medium leading-none">
          {name}
          {tips}
        </p>
        <p className="text-xs leading-none text-muted-foreground">{email}</p>
      </div>
    </div>
  );
};
