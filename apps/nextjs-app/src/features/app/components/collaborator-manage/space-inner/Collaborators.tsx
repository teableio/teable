import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { Building2 } from '@teable/icons';
import { getSpaceCollaboratorList, PrincipalType } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: IRole;
}
const MEMBERS_PER_PAGE = 50;

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId } = props;
  const { t } = useTranslation('space');
  const { data } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId, {
      skip: 0,
      take: MEMBERS_PER_PAGE,
    }),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then((res) => res.data),
  });

  const collaborators = data?.collaborators;

  return (
    <div>
      <h2 className="mb-4 font-medium">{t('spaceSetting.collaborators')}</h2>
      <ul className="space-y-3">
        {collaborators?.map((item) => {
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
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
