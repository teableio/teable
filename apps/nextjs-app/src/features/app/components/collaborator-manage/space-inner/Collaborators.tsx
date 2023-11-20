import { useQuery } from '@tanstack/react-query';
import type { SpaceRole } from '@teable-group/core';
import { getSpaceCollaboratorList } from '@teable-group/openapi';
import { useSession } from '@teable-group/sdk';
import { Avatar, AvatarFallback, AvatarImage, Skeleton } from '@teable-group/ui-lib';
import React from 'react';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: SpaceRole;
}

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId } = props;
  const { user } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ['space-collaborator-list', spaceId],
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]),
  });
  const collaborators = data?.data;

  collaborators?.sort((a, b) => (a.userId === user?.id ? -1 : b.userId === user?.id ? 1 : 0));
  return (
    <div>
      <h2 className="mb-4 font-medium">Collaborators</h2>
      <ul className="space-y-3">
        {isLoading ? (
          <li className="flex items-center space-x-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </li>
        ) : (
          collaborators?.map(({ userId, userName, avatar }) => (
            <li key={userId} className="flex items-center space-x-3">
              <Avatar className="h-7 w-7">
                <AvatarImage src={avatar as string} alt="avatar-name" />
                <AvatarFallback>{userName.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{userName}</p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
};
