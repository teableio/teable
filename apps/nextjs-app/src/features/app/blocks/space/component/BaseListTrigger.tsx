import { useQuery } from '@tanstack/react-query';
import { Database } from '@teable/icons';
import { CollaboratorType, getBaseList, getSharedBase } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import React from 'react';

export const BaseListTrigger = ({
  collaboratorType,
  spaceId,
  children,
}: {
  collaboratorType?: CollaboratorType;
  spaceId: string;
  children: React.ReactNode;
}) => {
  const { data: spaceBases } = useQuery({
    queryKey: ReactQueryKeys.baseList(spaceId),
    queryFn: ({ queryKey }) => getBaseList({ spaceId: queryKey[1] }).then((res) => res.data),
    enabled: collaboratorType !== CollaboratorType.Base,
  });

  const { data: sharedBases } = useQuery({
    queryKey: ReactQueryKeys.getSharedBase(),
    queryFn: () => getSharedBase().then((res) => res.data),
    enabled: collaboratorType === CollaboratorType.Base,
  });

  const bases = spaceBases || sharedBases;

  if (!bases) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        {bases.map((base) => (
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2"
            key={base.id}
            asChild
          >
            <Link href={`/base/${base.id}`}>
              <span>{base.icon ? base.icon : <Database className="mr-2" />}</span>
              {base.name}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
