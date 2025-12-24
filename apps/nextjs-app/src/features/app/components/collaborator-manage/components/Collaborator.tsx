import { Building2 } from '@teable/icons';
import { PrincipalType } from '@teable/openapi';
import { Badge, cn } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
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
  billable?: boolean | null;
}

export interface IDepartmentCollaborator {
  type: PrincipalType.Department;
  name: string;
}

export type ICollaborator = IUserCollaborator | IDepartmentCollaborator;

export const Collaborator = (props: ICollaboratorProps) => {
  const { item, className, tips } = props;
  const { t } = useTranslation('common');
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
      <div className="ml-2 flex flex-1 flex-col space-y-1 overflow-hidden">
        <div className="text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="truncate">{item.name}</span>
            {item.type === PrincipalType.User && item.billable && (
              <Badge className="shrink-0 border-none bg-blue-100 font-normal text-blue-500 dark:bg-blue-500/20 ">
                {t('billing.billable')}
              </Badge>
            )}
            {tips}
          </div>
        </div>
        {item.type === PrincipalType.User && (
          <p className="text-xs leading-none text-muted-foreground">{item.email}</p>
        )}
      </div>
    </div>
  );
};
