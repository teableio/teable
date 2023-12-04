import { useQuery } from '@tanstack/react-query';
import type { SpaceRole } from '@teable-group/core';
import { getSpaceCollaboratorList } from '@teable-group/openapi';
import { Avatar, AvatarFallback, AvatarImage } from '@teable-group/ui-lib';
import React from 'react';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: SpaceRole;
}

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId } = props;
  const { data: collaborators } = useQuery({
    queryKey: ['space-collaborator-list', spaceId],
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  return (
    <div>
      <h2 className="mb-4 font-medium">Collaborators</h2>
      <ul className="space-y-3">
        {collaborators?.map(({ userId, userName, avatar }) => (
          <li key={userId} className="flex items-center space-x-3">
            <Avatar className="h-7 w-7">
              <AvatarImage src={avatar as string} alt="avatar-name" />
              <AvatarFallback>{userName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{userName}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
