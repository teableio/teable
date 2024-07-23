import type { QueryClient } from '@tanstack/react-query';
import type { SpaceRole } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const spaceRoleChecker = ({
  queryClient,
  spaceId,
  roles,
}: {
  queryClient: QueryClient;
  spaceId: string;
  roles: SpaceRole[];
}) => {
  const role = (queryClient.getQueryState(ReactQueryKeys.space(spaceId))?.data as IGetSpaceVo)
    ?.role;

  if (!roles.includes(role)) {
    return {
      redirect: {
        destination: '/403',
        permanent: false,
      },
    };
  }
};
