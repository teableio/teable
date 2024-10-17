import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IBaseRole, IRole } from '@teable/core';
import { canManageRole, Role } from '@teable/core';
import {
  CollaboratorType,
  deleteBaseCollaborator,
  getBaseCollaboratorList,
  updateBaseCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import { Badge } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { CollaboratorItem } from '../components/CollaboratorItem';
import { CollaboratorList } from '../components/CollaboratorList';
import { RoleSelect } from '../components/RoleSelect';
import { filterCollaborators } from '../utils';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

export const BaseCollaborators = (props: { baseId: string; role: IRole }) => {
  const { baseId, role: userRole } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { t } = useTranslation('common');
  const [search, setSearch] = React.useState('');
  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId, { includeSystem: true }),
    queryFn: ({ queryKey }) =>
      getBaseCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const { mutate: updateCollaborator, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: updateBaseCollaborator,
    onSuccess: () => {
      queryClient.invalidateQueries(ReactQueryKeys.baseCollaboratorList(baseId));
      queryClient.invalidateQueries(ReactQueryKeys.base(baseId));
    },
  });

  const { mutate: deleteCollaborator, isLoading: deleteCollaboratorLoading } = useMutation({
    mutationFn: deleteBaseCollaborator,
    onSuccess: async (_, context) => {
      if (context.userId === user.id) {
        router.push('/space');
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
      });
    },
  });

  const filteredCollaborators = useMemo(
    () => filterCollaborators(search, collaborators),
    [collaborators, search]
  );

  const filteredRoleStatic = useFilteredRoleStatic(userRole);

  return (
    <CollaboratorList
      onSearch={setSearch}
      searchPlaceholder={t('invite.base.collaboratorSearchPlaceholder')}
    >
      {filteredCollaborators?.map(
        ({ userId, role, userName, email, createdTime, resourceType, avatar }) => {
          const canOperator =
            canManageRole(userRole, role) || userId === user.id || userRole === Role.Owner;
          return (
            <CollaboratorItem
              key={userId}
              userId={userId}
              userName={userName}
              email={email}
              avatar={avatar}
              createdTime={createdTime}
              onDeleted={(userId) => {
                deleteCollaborator({ baseId, userId });
              }}
              showDelete={resourceType === CollaboratorType.Base && canOperator}
              deletable={!deleteCollaboratorLoading && canOperator}
              collaboratorTips={
                resourceType === CollaboratorType.Space && (
                  <Badge className="ml-2 text-muted-foreground" variant={'outline'}>
                    {t('noun.space')}
                  </Badge>
                )
              }
            >
              <RoleSelect
                className="mx-1"
                value={role}
                options={filteredRoleStatic}
                disabled={
                  resourceType === CollaboratorType.Space ||
                  updateCollaboratorLoading ||
                  !canOperator
                }
                onChange={(role) =>
                  updateCollaborator({
                    baseId,
                    updateBaseCollaborateRo: { userId, role: role as IBaseRole },
                  })
                }
              />
            </CollaboratorItem>
          );
        }
      )}
    </CollaboratorList>
  );
};
