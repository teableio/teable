import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { Building2, Database } from '@teable/icons';
import type { IGetSpaceVo, UniqueCollaboratorItem } from '@teable/openapi';
import {
  CollaboratorType,
  getSpaceCollaboratorList,
  getSpaceUniqueCollaboratorList,
  PrincipalType,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { useContentDir } from '@teable/sdk/hooks';
import { Button, Skeleton } from '@teable/ui-lib/shadcn';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import React, { useState } from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';
import { InviteSpacePopover } from '../../collaborator/space/InviteSpacePopover';
import { BaseCountBadge } from '../components/BaseCountBadge';
import { getUniqueCollaboratorPrincipalId, PRINCIPAL_PERMISSIONS_TAKE } from '../utils';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: IRole;
  space: IGetSpaceVo;
}
const MEMBERS_PER_PAGE = 30;

const PrincipalBaseList = ({ spaceId, principalId }: { spaceId: string; principalId: string }) => {
  const contentDir = useContentDir();
  const { t } = useTranslation('space');
  const { data, isLoading } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      includeBase: true,
      principalId,
      take: PRINCIPAL_PERMISSIONS_TAKE,
    }),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  if (isLoading) {
    return <Skeleton className="ms-11 h-5 w-32" />;
  }

  const permissions = (data?.collaborators ?? []).filter(
    ({ resourceType }) => resourceType === CollaboratorType.Base
  );
  return (
    <ul className="space-y-1">
      {permissions.map((permission) => {
        const scopeName = permission.base?.name ?? t('baseList.allBases');
        return (
          <li
            className="flex h-5 min-w-0 items-center gap-1 ps-11"
            key={permission.base?.id ?? 'space'}
          >
            <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span
              dir={contentDir}
              className="min-w-0 truncate text-xs text-muted-foreground"
              title={scopeName}
            >
              {scopeName}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const contentDir = useContentDir();
  const { spaceId, space } = props;
  const { t } = useTranslation('space');
  const { t: tCommon } = useTranslation('common');
  const [expandedPrincipalKeys, setExpandedPrincipalKeys] = useState<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId, {
      skip: 0,
      take: MEMBERS_PER_PAGE,
      orderBy: 'asc',
    }),
    queryFn: ({ queryKey }) =>
      getSpaceUniqueCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const collaborators = data?.collaborators ?? [];
  const uniqueTotal = data?.total ?? collaborators.length;
  const hasMore = uniqueTotal > collaborators.length;

  const togglePrincipal = (key: string) => {
    setExpandedPrincipalKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderPrincipal = (item: UniqueCollaboratorItem) => {
    const principalId = getUniqueCollaboratorPrincipalId(item);
    const key = `${item.type}:${principalId}`;
    const isCollapsed = !expandedPrincipalKeys.has(key);
    const principalName = item.type === PrincipalType.User ? item.userName : item.departmentName;
    const principalIcon =
      item.type === PrincipalType.User ? (
        <UserAvatar user={{ name: item.userName, avatar: item.avatar }} className="border" />
      ) : (
        <Building2 className="size-7 shrink-0" />
      );

    if (item.spaceRole && item.baseCount === 0) {
      return (
        <li key={key} className="flex h-8 min-w-0 items-center gap-2 px-2">
          {principalIcon}
          <p
            dir={contentDir}
            className="min-w-0 flex-1 truncate text-sm font-medium"
            title={principalName}
          >
            {principalName}
          </p>
        </li>
      );
    }

    const badgeTooltip = item.spaceRole
      ? tCommon('invite.table.basePermissionCount', { count: item.baseCount })
      : tCommon('invite.table.basePermissionsOnly');
    return (
      <li key={key} className="flex min-h-8 flex-col gap-1">
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full min-w-0 justify-start py-0 pe-1 ps-2 text-start font-normal"
          aria-expanded={!isCollapsed}
          aria-label={tCommon(
            isCollapsed ? 'invite.table.expandPermissions' : 'invite.table.collapsePermissions',
            { name: principalName }
          )}
          onClick={() => togglePrincipal(key)}
        >
          {principalIcon}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <p
              dir={contentDir}
              className="min-w-0 truncate text-sm font-medium"
              title={principalName}
            >
              {principalName}
            </p>
            <BaseCountBadge compact count={item.baseCount} label={badgeTooltip} />
          </div>
          <span className="flex size-auto shrink-0 items-center justify-center text-muted-foreground">
            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </span>
        </Button>
        {!isCollapsed && <PrincipalBaseList spaceId={spaceId} principalId={principalId} />}
      </li>
    );
  };

  return (
    <div>
      <h2 className="mb-4 px-2 font-medium">{t('spaceSetting.collaborators')}</h2>
      <ul className="space-y-3">{collaborators.map((item) => renderPrincipal(item))}</ul>
      {hasMore && (
        <div className="mt-4 flex">
          <InviteSpacePopover space={space}>
            <Button
              variant="link"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              +{uniqueTotal - collaborators.length} {t('more')}
            </Button>
          </InviteSpacePopover>
        </div>
      )}
    </div>
  );
};
