import { Building2 } from '@teable/icons';
import { PrincipalType } from '@teable/openapi';
import { cn } from '@teable/ui-lib/shadcn';
import { UserAvatar } from '../../user/UserAvatar';

interface ICollaboratorProps {
  item: IUserCollaborator | IDepartmentCollaborator;
  className?: string;
  tips?: React.ReactNode;
}

export interface IUserCollaborator {
  type: PrincipalType.User;
  name: string;
  email: string;
  avatar?: string | null;
}

export interface IDepartmentCollaborator {
  type: PrincipalType.Department;
  name: string;
}

export type ICollaborator = IUserCollaborator | IDepartmentCollaborator;

export const Collaborator = (props: ICollaboratorProps) => {
  const { item, className, tips } = props;
  return (
    <div
      className={cn(
        'flex flex-1',
        {
          'items-center': item.type === PrincipalType.Department,
        },
        className
      )}
    >
      {item.type === PrincipalType.User && (
        <UserAvatar user={{ name: item.name, avatar: item.avatar }} />
      )}
      {item.type === PrincipalType.Department && (
        <div className=" flex size-7 items-center justify-center rounded-full bg-accent">
          <Building2 className="size-4" />
        </div>
      )}
      <div className="ml-2 flex flex-1 flex-col space-y-1">
        <p className="text-sm font-medium leading-none">
          {item.name}
          {tips}
        </p>
        {item.type === PrincipalType.User && (
          <p className="text-xs leading-none text-muted-foreground">{item.email}</p>
        )}
      </div>
    </div>
  );
};
