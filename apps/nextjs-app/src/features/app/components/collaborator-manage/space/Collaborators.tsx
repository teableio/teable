import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { canManageRole, Role } from '@teable/core';
import { Settings } from '@teable/icons';
import type { ListSpaceCollaboratorRo, UpdateBaseCollaborateRo } from '@teable/openapi';
import {
  PrincipalType,
  deleteBaseCollaborator,
  deleteSpaceCollaborator,
  getSpaceCollaboratorList,
  updateBaseCollaborator,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import { Badge, Button } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import React, { useMemo } from 'react';
import { useFilteredRoleStatic as useFilteredBaseRoleStatic } from '../base/useFilteredRoleStatic';
import { CollaboratorItem } from '../components/CollaboratorItem';
import { CollaboratorList } from '../components/CollaboratorList';
import { RoleSelect } from '../components/RoleSelect';
import { useFilteredRoleStatic } from './useFilteredRoleStatic';

interface ICollaborators {
  spaceId: string;
  role: IRole;
  collaboratorQuery?: ListSpaceCollaboratorRo;
}

const MEMBERS_PER_PAGE = 50;

export const Collaborators: FC<PropsWithChildren<ICollaborators>> = (props) => {
  const { spaceId, role: currentRole, children, collaboratorQuery } = props;
  const [search, setSearch] = React.useState('');
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const { user } = useSession();
  const router = useRouter();

  const { data, hasNextPage, fetchNextPage, isLoading } = useInfiniteQuery({
    queryKey: collaboratorQuery
      ? ReactQueryKeys.spaceCollaboratorList(spaceId, {
          ...collaboratorQuery,
          search,
          includeBase: true,
        })
      : ReactQueryKeys.spaceCollaboratorList(spaceId, {
          search,
          includeBase: true,
        }),
    queryFn: ({ queryKey, pageParam = 0 }) =>
      getSpaceCollaboratorList(queryKey[1], {
        ...queryKey[2],
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    staleTime: 1000,
    getNextPageParam: (lastPage, pages) => {
      const allCollaborators = pages.flatMap((page) => page.collaborators);
      return allCollaborators.length >= lastPage.total ? undefined : pages.length;
    },
  });

  const collaborators = useMemo(() => {
    return data?.pages.flatMap((page) => page.collaborators);
  }, [data]);

  const { mutate: updateCollaborator, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: ({
      resourceId,
      updateCollaborateRo,
      isBase,
    }: {
      resourceId: string;
      updateCollaborateRo: {
        principalId: string;
        principalType: PrincipalType;
        role: IRole;
      };
      isBase?: boolean;
    }) =>
      isBase
        ? updateBaseCollaborator({
            baseId: resourceId,
            updateBaseCollaborateRo: updateCollaborateRo as UpdateBaseCollaborateRo,
          })
        : updateSpaceCollaborator({
            spaceId: resourceId,
            updateSpaceCollaborateRo: updateCollaborateRo,
          }),
    onSuccess: async (_, context) => {
      const { isBase, resourceId } = context;

      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
      if (isBase) {
        queryClient.invalidateQueries(ReactQueryKeys.baseCollaboratorList(resourceId));
      } else {
        queryClient.invalidateQueries(ReactQueryKeys.space(spaceId));
        queryClient.invalidateQueries(ReactQueryKeys.spaceList());
      }
    },
  });

  const { mutate: deleteCollaborator, isLoading: deleteCollaboratorLoading } = useMutation({
    mutationFn: ({
      principalId,
      resourceId,
      principalType,
      isBase,
    }: {
      principalId: string;
      principalType: PrincipalType;
      resourceId: string;
      isBase?: boolean;
    }) =>
      isBase
        ? deleteBaseCollaborator({
            baseId: resourceId,
            deleteBaseCollaboratorRo: { principalId, principalType },
          })
        : deleteSpaceCollaborator({
            spaceId: resourceId,
            deleteSpaceCollaboratorRo: { principalId, principalType },
          }),
    onSuccess: async (_, context) => {
      if (context.principalId === user.id) {
        router.push('/space');
        queryClient.invalidateQueries(ReactQueryKeys.spaceList());
        return;
      }
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const filteredRoleStatic = useFilteredRoleStatic(currentRole);
  const filteredBaseRoleStatic = useFilteredBaseRoleStatic(currentRole);

  const goBase = (baseId: string) => {
    router.push(`/base/${baseId}`);
  };

  return (
    <CollaboratorList
      inputRight={children}
      onSearch={setSearch}
      searchPlaceholder={t('invite.dialog.collaboratorSearchPlaceholder')}
      isSearching={isLoading}
    >
      {collaborators?.map((item) => {
        const { role, createdTime, base } = item;
        const isBase = Boolean(base);
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
          canManageRole(currentRole, role) ||
          collaborator.id === user.id ||
          currentRole === Role.Owner;
        return (
          <CollaboratorItem
            key={collaborator.id}
            item={collaborator}
            createdTime={createdTime}
            onDeleted={() => {
              deleteCollaborator({
                resourceId: base ? base.id : spaceId,
                principalId: collaborator.id,
                principalType: collaborator.type,
                isBase,
              });
            }}
            showDelete={canOperator}
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
              options={isBase ? filteredBaseRoleStatic : filteredRoleStatic}
              disabled={updateCollaboratorLoading || !canOperator}
              onChange={(role) =>
                updateCollaborator({
                  resourceId: base ? base.id : spaceId,
                  updateCollaborateRo: {
                    principalId: collaborator.id,
                    principalType: collaborator.type,
                    role,
                  },
                  isBase,
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
