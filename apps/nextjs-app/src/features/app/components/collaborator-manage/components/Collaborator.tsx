import { BillableRoles, type IRole } from '@teable/core';
import { Building2 } from '@teable/icons';
import { PrincipalType } from '@teable/openapi';
import {
  Badge,
  cn,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
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

export const OverflowText = (props: { text: string; className?: string }) => {
  const { text, className } = props;
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [isOverflow, setIsOverflow] = useState(false);

  const checkOverflow = useCallback((element: HTMLSpanElement) => {
    setIsOverflow(element.scrollWidth > element.clientWidth);
  }, []);

  const setContentRef = useCallback(
    (element: HTMLSpanElement | null) => {
      observerRef.current?.disconnect();
      elementRef.current = element;

      if (!element) {
        observerRef.current = null;
        return;
      }

      checkOverflow(element);

      const observer = new ResizeObserver(() => checkOverflow(element));
      observer.observe(element);
      observerRef.current = observer;
    },
    [checkOverflow]
  );

  useEffect(() => {
    if (elementRef.current) {
      checkOverflow(elementRef.current);
    }
  }, [checkOverflow, text]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  const content = (
    <span ref={setContentRef} className={cn('min-w-0 truncate', className)}>
      {text}
    </span>
  );

  if (!isOverflow) {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipPortal>
          <TooltipContent className="max-w-60 break-all">
            <p>{text}</p>
          </TooltipContent>
        </TooltipPortal>
      </Tooltip>
    </TooltipProvider>
  );
};

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
    <div className={cn('flex min-w-0 flex-1 items-center', className)}>
      {item.type === PrincipalType.User && (
        <UserAvatar className="border" user={{ name: item.name, avatar: item.avatar }} />
      )}
      {item.type === PrincipalType.Department && (
        <div className=" flex size-7 items-center justify-center rounded-full bg-accent">
          <Building2 className="size-4" />
        </div>
      )}
      <div className="ml-3 flex min-w-0 flex-1 flex-col space-y-1 overflow-hidden">
        <div className="min-w-0 text-sm font-medium">
          <div className="flex min-w-0 items-center gap-2">
            <OverflowText text={item.name} />
            {item.type === PrincipalType.User && item.billable && (
              <BillableBadge role={item.role} />
            )}
            {tips}
          </div>
        </div>
        {item.type === PrincipalType.User && (
          <OverflowText text={item.email} className="text-xs leading-none text-muted-foreground" />
        )}
      </div>
    </div>
  );
};
