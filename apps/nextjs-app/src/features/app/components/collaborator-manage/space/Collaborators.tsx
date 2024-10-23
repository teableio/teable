import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { canManageRole, Role } from '@teable/core';
import { Settings } from '@teable/icons';
import type { ListSpaceCollaboratorRo } from '@teable/openapi';
import {
  deleteSpaceCollaborator,
  getSpaceCollaboratorList,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import React, { useMemo } from 'react';
import { CollaboratorItem } from '../components/CollaboratorItem';
import { CollaboratorList } from '../components/CollaboratorList';
import { RoleSelect } from '../components/RoleSelect';
import { filterCollaborators } from '../utils';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

interface ICollaborators {
  spaceId: string;
  role: IRole;
  collaboratorQuery?: ListSpaceCollaboratorRo;
}

export const Collaborators: FC<PropsWithChildren<ICollaborators>> = (props) => {
  const { spaceId, role: currentRole, children, collaboratorQuery } = props;
  const [search, setSearch] = React.useState('');
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const { user } = useSession();
  const router = useRouter();

  const { data: collaborators } = useQuery({
    queryKey: collaboratorQuery
      ? ReactQueryKeys.spaceCollaboratorList(spaceId, collaboratorQuery)
      : ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) =>
      getSpaceCollaboratorList(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  const { mutate: updateCollaborator, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: updateSpaceCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
      queryClient.invalidateQueries(ReactQueryKeys.space(spaceId));
      queryClient.invalidateQueries(ReactQueryKeys.spaceList());
    },
  });

  const { mutate: deleteCollaborator, isLoading: deleteCollaboratorLoading } = useMutation({
    mutationFn: deleteSpaceCollaborator,
    onSuccess: async (_, context) => {
      if (context.userId === user.id) {
        router.push('/space');
        queryClient.invalidateQueries(ReactQueryKeys.spaceList());
        return;
      }
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const filteredCollaborators = useMemo(
    () => filterCollaborators(search, collaborators),
    [collaborators, search]
  );

  const filteredRoleStatic = useFilteredRoleStatic(currentRole);

  const goBase = (baseId: string) => {
    router.push(`/base/${baseId}`);
  };

  return (
    <CollaboratorList
      inputRight={children}
      onSearch={setSearch}
      searchPlaceholder={t('invite.dialog.collaboratorSearchPlaceholder')}
    >
      {filteredCollaborators?.map(
        ({ userId, role, userName, email, createdTime, avatar, base }) => {
          const isBase = Boolean(base);
          const canOperator =
            canManageRole(currentRole, role) || userId === user.id || currentRole === Role.Owner;
          return (
            <CollaboratorItem
              key={userId}
              userId={userId}
              userName={userName}
              email={email}
              avatar={avatar}
              createdTime={createdTime}
              onDeleted={(userId) => {
                deleteCollaborator({ spaceId, userId });
              }}
              showDelete={canOperator && !isBase}
              deletable={!deleteCollaboratorLoading && canOperator}
              collaboratorTips={
                isBase && (
                  <div className="ml-3 inline-flex items-center gap-2">
                    <Badge className="text-muted-foreground" variant={'outline'}>
                      {base?.name}
                    </Badge>
                    <Button
                      className="h-auto p-0.5"
                      size={'xs'}
                      variant={'ghost'}
                      onClick={() => goBase(base!.id)}
                    >
                      <Settings />
                    </Button>
                  </div>
                )
              }
            >
              <RoleSelect
                className="mx-1"
                value={role}
                options={filteredRoleStatic}
                disabled={updateCollaboratorLoading || !canOperator || isBase}
                onChange={(role) =>
                  updateCollaborator({ spaceId, updateSpaceCollaborateRo: { userId, role } })
                }
              />
            </CollaboratorItem>
          );
        }
      )}
    </CollaboratorList>
  );
};
