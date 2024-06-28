import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SpaceRole } from '@teable/core';
import { hasPermission } from '@teable/core';
import { X } from '@teable/icons';
import type { ListSpaceCollaboratorVo } from '@teable/openapi';
import {
  deleteSpaceCollaborator,
  getSpaceCollaboratorList,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys, useSession } from '@teable/sdk';
import {
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import dayjs, { extend } from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { debounce } from 'lodash';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import React, { useMemo, useState } from 'react';
import { Collaborator } from './Collaborator';
import { RoleSelect } from './RoleSelect';

extend(relativeTime);

interface ICollaborators {
  spaceId: string;
  role: SpaceRole;
}

const filterCollaborators = (search: string, collaborators?: ListSpaceCollaboratorVo) => {
  if (!search) return collaborators;
  return collaborators?.filter(({ userName, email }) => {
    const searchLower = search.toLowerCase();
    const usernameLower = userName.toLowerCase();
    const emailLower = email.toLowerCase();
    return !search || usernameLower.includes(searchLower) || emailLower.includes(searchLower);
  });
};

export const Collaborators: FC<PropsWithChildren<ICollaborators>> = (props) => {
  const { spaceId, role, children } = props;
  const [search, setSearch] = useState<string>('');
  const [applySearch, setApplySearch] = useState<string>(search);
  const queryClient = useQueryClient();
  const { user } = useSession();
  const { t } = useTranslation('common');

  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  const { mutate: updateCollaborator, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: updateSpaceCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const { mutate: deleteCollaborator, isLoading: deleteCollaboratorLoading } = useMutation({
    mutationFn: deleteSpaceCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries(ReactQueryKeys.spaceCollaboratorList(spaceId));
    },
  });

  const collaboratorsFiltered = useMemo(() => {
    return filterCollaborators(applySearch, collaborators);
  }, [applySearch, collaborators]);

  const hasGrantRolePermission = hasPermission(role, 'space|grant_role');

  const setApplySearchDebounced = useMemo(() => {
    return debounce(setApplySearch, 200);
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center gap-x-4">
        <Input
          className="h-8"
          type="search"
          placeholder={t('invite.dialog.collaboratorSearchPlaceholder')}
          value={search}
          onChange={(e) => {
            const value = e.target.value;
            setSearch(value);
            setApplySearchDebounced(value);
          }}
        />
        {children}
      </div>
      <div className="space-y-5">
        {collaboratorsFiltered?.map(({ userId, userName, email, role, avatar, createdTime }) => (
          <div key={userId} className="relative flex items-center gap-3 pr-6">
            <Collaborator name={userName} email={email} avatar={avatar} />
            <div className="text-xs text-muted-foreground">
              {t('invite.dialog.collaboratorJoin', {
                joinTime: dayjs(createdTime).fromNow(),
              })}
            </div>
            <RoleSelect
              value={role}
              disabled={updateCollaboratorLoading || userId === user.id || !hasGrantRolePermission}
              onChange={(role) =>
                updateCollaborator({ spaceId, updateSpaceCollaborateRo: { userId, role } })
              }
            />
            {userId !== user.id && hasGrantRolePermission && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      className="absolute right-0 h-auto p-0 hover:bg-inherit"
                      size="sm"
                      variant="ghost"
                      disabled={deleteCollaboratorLoading}
                      onClick={() => deleteCollaborator({ spaceId, userId })}
                    >
                      <X className="size-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{t('invite.dialog.collaboratorRemove')}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
