import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrganizationMe } from '@teable/openapi';

const OrganizationQueryKey = 'organization-me';

export const useOrganization = () => {
  const queryClient = useQueryClient();
  const { data: organization } = useQuery({
    queryKey: [OrganizationQueryKey],
    queryFn: () => getOrganizationMe().then((res) => res.data),
  });

  return {
    organization,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: [OrganizationQueryKey] });
    },
  };
};
