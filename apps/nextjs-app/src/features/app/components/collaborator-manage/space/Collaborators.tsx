import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SpaceRole } from '@teable-group/core';
import { X } from '@teable-group/icons';
import type { ListSpaceCollaboratorVo } from '@teable-group/openapi';
import {
  deleteSpaceCollaborator,
  getSpaceCollaboratorList,
  updateSpaceCollaborator,
} from '@teable-group/openapi';
import { useSession } from '@teable-group/sdk';
import {
  Avatar,
  AvatarFallback,
  Button,
  Input,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable-group/ui-lib';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { throttle } from 'lodash';
import { useMemo, useState } from 'react';
import { RoleSelect } from './RoleSelect';
dayjs.extend(relativeTime);

interface ICollaborators {
  spaceId: string;
  role: SpaceRole;
}

const filterCollaborators = throttle((search: string, collaborators?: ListSpaceCollaboratorVo) => {
  return collaborators?.filter(({ username, email }) => {
    const searchLower = search.toLowerCase();
    const usernameLower = username.toLowerCase();
    const emailLower = email.toLowerCase();
    return !search || usernameLower.includes(searchLower) || emailLower.includes(searchLower);
  });
}, 200);

export const Collaborators: React.FC<ICollaborators> = (props) => {
  const { spaceId, role } = props;
  const [search, setSearch] = useState<string>('');
  const queryClient = useQueryClient();
  const { user } = useSession();

  const collaborators = useQuery({
    queryKey: ['space-collaborator-list', spaceId],
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]),
  }).data?.data;

  const { mutate: updateCollaborator, isLoading: updateCollaboratorLoading } = useMutation({
    mutationFn: updateSpaceCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['space-collaborator-list'] });
    },
  });

  const { mutate: deleteCollaborator, isLoading: deleteCollaboratorLoading } = useMutation({
    mutationFn: deleteSpaceCollaborator,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['space-collaborator-list'] });
    },
  });

  const collaboratorsFiltered = useMemo(() => {
    return filterCollaborators(search, collaborators);
  }, [search, collaborators]);

  const canManage = role === SpaceRole.Owner;

  return (
    <div>
      <div className="text-sm text-muted-foreground">Space collaborators</div>
      <Input
        className="mb-5 mt-3 h-8"
        type="search"
        placeholder="Find a space collaborator by name or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="space-y-5">
        {collaboratorsFiltered?.map(({ userId, username, email, role, createdTime }) => (
          <div key={userId} className="relative flex items-center gap-3 pr-7">
            <div className="flex flex-1">
              <Avatar className="h-7 w-7">
                <AvatarFallback>{username.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="ml-2 flex flex-1 flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{username}</p>
                <p className="text-xs leading-none text-muted-foreground">{email}</p>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              joined {dayjs(createdTime).fromNow()}
            </div>
            <RoleSelect
              value={role}
              disabled={updateCollaboratorLoading || userId === user.id || !canManage}
              onChange={(role) =>
                updateCollaborator({ spaceId, updateSpaceCollaborateRo: { userId, role } })
              }
            />
            {userId !== user.id && canManage && (
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
                      <X className="h-4 w-4 cursor-pointer text-muted-foreground opacity-70 hover:opacity-100" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Remove collaborator</p>
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
