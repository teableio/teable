import type { QueryClient } from '@tanstack/react-query';
import type { SpaceRole } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';

export const spaceRoleChecker = ({
  queryClient,
  spaceId,
  roles,
}: {
  queryClient: QueryClient;
  spaceId: string;
  roles: SpaceRole[];
}) => {
  const role = (queryClient.getQueryState(['space', spaceId as string])?.data as IGetSpaceVo)?.role;

  if (!roles.includes(role)) {
    return {
      redirect: {
        destination: '/403',
        permanent: false,
      },
    };
  }
};
