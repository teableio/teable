import { useQuery } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { getSpaceCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { useTranslation } from 'next-i18next';
import React from 'react';
import { UserAvatar } from '@/features/app/components/user/UserAvatar';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: IRole;
}

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId } = props;
  const { t } = useTranslation('space');
  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then((res) => res.data),
  });

  return (
    <div>
      <h2 className="mb-4 font-medium">{t('spaceSetting.collaborators')}</h2>
      <ul className="space-y-3">
        {collaborators?.map(({ userId, userName, avatar }) => (
          <li key={userId} className="flex items-center space-x-3">
            <UserAvatar user={{ name: userName, avatar }} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{userName}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
