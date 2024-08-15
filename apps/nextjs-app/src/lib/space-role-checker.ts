import type { QueryClient } from '@tanstack/react-query';
import type { IRole } from '@teable/core';
import type { IGetSpaceVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';

export const spaceRoleChecker = ({
  queryClient,
  spaceId,
  roles,
}: {
  queryClient: QueryClient;
  spaceId: string;
  roles: IRole[];
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
