import { useQuery } from '@tanstack/react-query';
import { BillingProductLevel, getDbConnection } from '@teable/openapi';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import { useBaseUsage } from '@/features/app/hooks/useBaseUsage';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';

export const useDbConnection = () => {
  const baseId = useBaseId() as string;
  const permissions = useBasePermission();
  const hasPermission = permissions?.['base|db_connection'];
  const isCloud = useIsCloud();
  const usage = useBaseUsage();
  const isUnavailable = isCloud && usage?.level !== BillingProductLevel.Enterprise;

  const { data, isLoading } = useQuery({
    queryKey: ['connection', baseId],
    queryFn: ({ queryKey }) => getDbConnection(queryKey[1]).then((data) => data.data),
    enabled: hasPermission && !isUnavailable,
  });

  const dataArray = data?.dsn
    ? Object.entries(data?.dsn).map(([label, value]) => {
        if (label === 'params') {
          const display = Object.entries(value)
            .map((v) => v.join('='))
            .join('&');
          return {
            label,
            display,
            value: display,
          };
        }
        if (label === 'pass') {
          return {
            label,
            display: '********',
            value: String(value ?? ''),
          };
        }
        return { label, value: String(value ?? ''), display: String(value ?? '') };
      })
    : [];

  dataArray.unshift({
    label: 'url',
    display: (data?.url || '').replace(data?.dsn?.pass || '', '********'),
    value: data?.url || '',
  });

  return { data, dataArray, isLoading };
};
