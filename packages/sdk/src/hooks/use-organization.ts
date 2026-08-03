import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrganizationMe } from '@teable/openapi';
import { ReactQueryKeys } from '../config';

export const useOrganization = () => {
  const queryClient = useQueryClient();
  const { data: organization } = useQuery({
    queryKey: ReactQueryKeys.getOrganizationMe(),
    queryFn: () => getOrganizationMe().then((res) => res.data),
  });

  return {
    organization,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.getOrganizationMe() });
    },
  };
};
