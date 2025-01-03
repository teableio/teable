import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IBaseRole, IRole } from '@teable/core';
import { canManageRole, Role } from '@teable/core';
import {
  CollaboratorType,
  deleteBaseCollaborator,
  getBaseCollaboratorList,
  PrincipalType,
  updateBaseCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import React, { useMemo } from 'react';
import { CollaboratorItem } from '../components/CollaboratorItem';
import { CollaboratorList } from '../components/CollaboratorList';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

const MEMBERS_PER_PAGE = 50;

export const BaseCollaborators = (props: { baseId: string; role: IRole }) => {
  const { baseId, role: userRole } = props;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { t } = useTranslation('common');
  const [search, setSearch] = React.useState('');
  const { data, hasNextPage, fetchNextPage, isLoading } = useInfiniteQuery({
    queryKey: ReactQueryKeys.baseCollaboratorList(baseId, { includeSystem: true, search }),
    staleTime: 1000,
    refetchOnWindowFocus: false,
    queryFn: ({ queryKey, pageParam = 0 }) =>
      getBaseCollaboratorList(queryKey[1], {
        ...queryKey[2],
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    getNextPageParam: (lastPage, pages) => {
      const allCollaborators = pages.flatMap((page) => page.collaborators);
      return allCollaborators.length >= lastPage.total ? undefined : pages.length;
    },
  });

  const collaborators = useMemo(() => {
    return data?.pages.flatMap((page) => page.collaborators);
  }, [data]);

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
      if (context.deleteBaseCollaboratorRo.principalId === user.id) {
        router.push('/space');
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.baseCollaboratorList(baseId),
      });
    },
  });

  const filteredRoleStatic = useFilteredRoleStatic(userRole);

  return (
    <CollaboratorList
      onSearch={setSearch}
      searchPlaceholder={t('invite.base.collaboratorSearchPlaceholder')}
      isSearching={isLoading}
    >
      {collaborators?.map((item) => {
        const { role, createdTime, resourceType } = item;
        const collaborator =
          item.type === PrincipalType.User
            ? {
                type: PrincipalType.User as const,
                name: item.userName,
                email: item.email,
                avatar: item.avatar,
                id: item.userId,
              }
            : {
                type: PrincipalType.Department as const,
                name: item.departmentName,
                id: item.departmentId,
              };
        const canOperator =
          canManageRole(userRole, role) || collaborator.id === user.id || userRole === Role.Owner;
        return (
          <CollaboratorItem
            key={collaborator.id}
            item={collaborator}
            createdTime={createdTime}
            onDeleted={() => {
              deleteCollaborator({
                baseId,
                deleteBaseCollaboratorRo: {
                  principalId: collaborator.id,
                  principalType: collaborator.type,
                },
              });
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
                resourceType === CollaboratorType.Space || updateCollaboratorLoading || !canOperator
              }
              onChange={(role) =>
                updateCollaborator({
                  baseId,
                  updateBaseCollaborateRo: {
                    principalId: collaborator.id,
                    principalType: collaborator.type,
                    role: role as IBaseRole,
                  },
                })
              }
            />
          </CollaboratorItem>
        );
      })}
      {hasNextPage && (
        <div className="flex justify-center py-4">
          <Button variant="link" size="sm" className="text-[13px]" onClick={() => fetchNextPage()}>
            {t('actions.loadMore')}
          </Button>
        </div>
      )}
    </CollaboratorList>
  );
};
