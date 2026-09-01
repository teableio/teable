import { useQuery } from '@tanstack/react-query';
import type { IItemBaseCollaboratorUser } from '@teable/openapi';
import { getUserCollaborators } from '@teable/openapi';
import { useMemo, useState } from 'react';
import { ReactQueryKeys } from '../config';
import { useBaseId } from './use-base-id';

const COLLABORATOR_SEARCH_TAKE = 100;

// Minimal user shape selected ids resolve from — IUserMapVo entries and collaborator
// items both satisfy it.
interface ICollaboratorFilterUser {
  id: string;
  name: string;
  email?: string | null;
  avatar?: string | null;
}

// Base collaborator candidates for a filter dropdown with server-side search;
// already-selected users stay resolvable from `userMap` after the search narrows
// the candidate list.
export const useCollaboratorFilterUsers = (props: {
  selectedIds: string[];
  userMap: Record<string, ICollaboratorFilterUser>;
}) => {
  const { selectedIds, userMap } = props;
  const baseId = useBaseId();
  const [userSearch, setUserSearch] = useState('');

  const { data: collaboratorsData } = useQuery({
    queryKey: ReactQueryKeys.baseCollaboratorListUser(baseId as string, {
      includeSystem: true,
      skip: 0,
      take: COLLABORATOR_SEARCH_TAKE,
      search: userSearch,
    }),
    queryFn: ({ queryKey }) =>
      getUserCollaborators(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: Boolean(baseId),
  });

  const users = useMemo<IItemBaseCollaboratorUser[]>(() => {
    const map = new Map<string, IItemBaseCollaboratorUser>();
    selectedIds.forEach((id) => {
      const user = userMap[id];
      if (user) {
        map.set(id, { ...user, role: '', email: user.email ?? '' } as IItemBaseCollaboratorUser);
      }
    });
    collaboratorsData?.users.forEach((user) => map.set(user.id, user));
    return Array.from(map.values());
  }, [selectedIds, userMap, collaboratorsData?.users]);

  return { users, setUserSearch };
};
