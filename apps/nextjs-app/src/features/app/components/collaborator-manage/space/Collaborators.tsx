import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import { canManageRole, Role } from '@teable/core';
import { Settings } from '@teable/icons';
import type {
  CollaboratorItem,
  ListSpaceCollaboratorRo,
  UpdateBaseCollaborateRo,
} from '@teable/openapi';
import {
  PrincipalType,
  deleteBaseCollaborator,
  deleteSpaceCollaborator,
  getSpaceCollaboratorList,
  updateBaseCollaborator,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import { Badge, Button, Input } from '@teable/ui-lib/shadcn';
import { debounce } from 'lodash';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CollaboratorTable } from '../../collaborator/share/common/CollaboratorTable';
import { useFilteredRoleStatic as useFilteredBaseRoleStatic } from '../base/useFilteredRoleStatic';
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
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const { user } = useSession();
  const router = useRouter();

  const setSearchDebounced = useMemo(() => {
    return debounce(setSearch, 200);
  }, []);

  useEffect(() => {
    if (!isComposing) {
      setSearchDebounced(inputValue);
    }
  }, [inputValue, isComposing, setSearchDebounced]);

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
    queryFn: ({ queryKey, pageParam }) =>
      getSpaceCollaboratorList(queryKey[1], {
        ...queryKey[2],
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    staleTime: 1000,
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const allCollaborators = pages.flatMap((page) => page.collaborators);
      return allCollaborators.length >= lastPage.total ? undefined : pages.length;
    },
  });

  const collaborators = useMemo(() => {
    return data?.pages.flatMap((page) => page.collaborators) || [];
  }, [data]);

  const total = data?.pages[0]?.total || 0;

  const { mutate: updateCollaborator, isPending: updateCollaboratorLoading } = useMutation({
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

      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
      });
      if (isBase) {
        queryClient.invalidateQueries({
          queryKey: ReactQueryKeys.baseCollaboratorList(resourceId),
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.space(spaceId) });
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
      }
    },
  });

  const { mutate: deleteCollaborator, isPending: deleteCollaboratorLoading } = useMutation({
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
        queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceList() });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
      });
    },
  });

  const filteredRoleStatic = useFilteredRoleStatic(currentRole);
  const filteredBaseRoleStatic = useFilteredBaseRoleStatic(currentRole);

  const goBase = (baseId: string) => {
    router.push(`/base/${baseId}`);
  };

  const getPermissions = useCallback(
    (item: CollaboratorItem) => {
      const collaboratorId = item.type === PrincipalType.User ? item.userId : item.departmentId;
      const canOperator =
        canManageRole(currentRole, item.role) ||
        collaboratorId === user.id ||
        currentRole === Role.Owner;
      return {
        canUpdateRole: canOperator,
        canDelete: canOperator,
        showDelete: canOperator,
      };
    },
    [currentRole, user.id]
  );

  const getFilteredRoleStatic = useCallback(
    (item: CollaboratorItem) => {
      const isBase = Boolean(item.base);
      return isBase ? filteredBaseRoleStatic : filteredRoleStatic;
    },
    [filteredBaseRoleStatic, filteredRoleStatic]
  );

  const handleUpdateRole = useCallback(
    (role: IRole, item: CollaboratorItem) => {
      const isBase = Boolean(item.base);
      const collaboratorId = item.type === PrincipalType.User ? item.userId : item.departmentId;
      updateCollaborator({
        resourceId: item.base ? item.base.id : spaceId,
        updateCollaborateRo: {
          principalId: collaboratorId,
          principalType: item.type,
          role,
        },
        isBase,
      });
    },
    [spaceId, updateCollaborator]
  );

  const handleDelete = useCallback(
    (item: CollaboratorItem) => {
      const isBase = Boolean(item.base);
      const collaboratorId = item.type === PrincipalType.User ? item.userId : item.departmentId;
      deleteCollaborator({
        resourceId: item.base ? item.base.id : spaceId,
        principalId: collaboratorId,
        principalType: item.type,
        isBase,
      });
    },
    [spaceId, deleteCollaborator]
  );

  const renderTips = useCallback(
    (item: CollaboratorItem) => {
      if (!item.base) return null;
      return (
        <div className="inline-flex items-center gap-2">
          <Badge className="text-muted-foreground" variant="outline">
            {item.base.name}
          </Badge>
          <Button
            className="h-auto p-0.5"
            size="xs"
            variant="ghost"
            onClick={() => goBase(item.base!.id)}
          >
            <Settings />
          </Button>
        </div>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <div className="flex size-full flex-col">
      <div className="mb-4 flex w-full items-center gap-x-4">
        <Input
          className="h-8"
          type="search"
          placeholder={t('invite.dialog.collaboratorSearchPlaceholder')}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
        />
        {children}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <CollaboratorTable
          list={collaborators}
          total={total}
          hasNextPage={hasNextPage}
          fetchNextPage={fetchNextPage}
          isLoading={isLoading}
          updateRoleLoading={updateCollaboratorLoading}
          deleteLoading={deleteCollaboratorLoading}
          getPermissions={getPermissions}
          getFilteredRoleStatic={getFilteredRoleStatic}
          onUpdateRole={handleUpdateRole}
          onDelete={handleDelete}
          renderTips={renderTips}
        />
      </div>
    </div>
  );
};
