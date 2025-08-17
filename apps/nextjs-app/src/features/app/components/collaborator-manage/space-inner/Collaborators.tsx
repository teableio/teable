import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { Building2 } from '@teable/icons';
import type { IGetSpaceVo } from '@teable/openapi';
import { getSpaceCollaboratorList, PrincipalType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { SpaceCollaboratorModalTrigger } from '@/features/app/components/collaborator-manage/space/SpaceCollaboratorModalTrigger';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: IRole;
  space: IGetSpaceVo;
}
const MEMBERS_PER_PAGE = 50;

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId, space } = props;
  const { t } = useTranslation('space');

  const { data } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      skip: 0,
      take: MEMBERS_PER_PAGE,
      orderBy: 'asc',
      includeBase: true,
    }),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const collaborators = data?.collaborators || [];
  const maxDisplay = 30;
  const displayedCollaborators = collaborators.slice(0, maxDisplay);
  const hasMore = collaborators.length > maxDisplay;

  return (
    <div>
      <h2 className="mb-4 font-medium">{t('spaceSetting.collaborators')}</h2>
      <ul className="space-y-3">
        {displayedCollaborators.map((item) => {
          const isBase = Boolean(item.base);
          return (
            <li
              key={item.type === PrincipalType.User ? item.userId : item.departmentId}
              className="flex items-center space-x-3"
            >
              {item.type === PrincipalType.User ? (
                <UserAvatar user={{ name: item.userName, avatar: item.avatar }} />
              ) : (
                <Building2 className="size-7" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {item.type === PrincipalType.User ? item.userName : item.departmentName}
                </p>
                {isBase && (
                  <Badge className="mt-1 text-xs text-muted-foreground" variant="outline">
                    {item.base?.name}
                  </Badge>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="mt-4 flex">
          <SpaceCollaboratorModalTrigger space={space}>
            <Button
              variant="link"
              size="sm"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              +{collaborators.length - maxDisplay} {t('more')}
            </Button>
          </SpaceCollaboratorModalTrigger>
        </div>
      )}
    </div>
  );
};
