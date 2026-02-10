import { BillableRoles, type IRole } from '@teable/core';
import { Building2 } from '@teable/icons';
import { PrincipalType } from '@teable/openapi';
import {
  Badge,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
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
  role?: IRole;
}

export interface IDepartmentCollaborator {
  type: PrincipalType.Department;
  name: string;
}

export type ICollaborator = IUserCollaborator | IDepartmentCollaborator;

const BillableBadge = (props: { role?: IRole }) => {
  const { role } = props;
  const { t } = useTranslation('common');
  const isBillableRole = role ? (BillableRoles as readonly IRole[]).includes(role) : true;

  const badge = (
    <Badge className="shrink-0 border-none bg-blue-100 font-normal text-blue-500 hover:bg-blue-100/80 dark:bg-blue-500/20 dark:hover:bg-blue-500/30">
      {t('billing.billable')}
    </Badge>
  );

  if (isBillableRole) {
    return badge;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{badge}</span>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p>{t('billing.billableByAuthorityMatrix')}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const Collaborator = (props: ICollaboratorProps) => {
  const { item, className, tips } = props;

  return (
    <div className={cn('flex flex-1 items-center', className)}>
      {item.type === PrincipalType.User && (
        <UserAvatar className="border" user={{ name: item.name, avatar: item.avatar }} />
      )}
      {item.type === PrincipalType.Department && (
        <div className=" flex size-7 items-center justify-center rounded-full bg-accent">
          <Building2 className="size-4" />
        </div>
      )}
      <div className="ml-3 flex flex-1 flex-col space-y-1 overflow-hidden">
        <div className="text-sm font-medium">
          <div className="flex items-center gap-2">
            <span className="truncate">{item.name}</span>
            {item.type === PrincipalType.User && item.billable && (
              <BillableBadge role={item.role} />
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
