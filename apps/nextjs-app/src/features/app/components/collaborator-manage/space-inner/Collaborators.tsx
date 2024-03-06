import { useQuery } from '@tanstack/react-query';
import type { SpaceRole } from '@teable/core';
import { getSpaceCollaboratorList } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk';
import { Avatar, AvatarFallback, AvatarImage } from '@teable/ui-lib';
import Image from 'next/image';
import React from 'react';

interface SpaceInnerCollaboratorProps {
  spaceId: string;
  role?: SpaceRole;
}

export const Collaborators: React.FC<SpaceInnerCollaboratorProps> = (props) => {
  const { spaceId } = props;
  const { data: collaborators } = useQuery({
    queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId),
    queryFn: ({ queryKey }) => getSpaceCollaboratorList(queryKey[1]).then(({ data }) => data),
  });

  return (
    <div>
      <h2 className="mb-4 font-medium">Collaborators</h2>
      <ul className="space-y-3">
        {collaborators?.map(({ userId, userName, avatar }) => (
          <li key={userId} className="flex items-center space-x-3">
            <Avatar className="size-7">
              <AvatarImage asChild src={avatar as string}>
                <Image src={avatar as string} alt={userName} width={28} height={28} />
              </AvatarImage>
              <AvatarFallback>{userName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{userName}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
