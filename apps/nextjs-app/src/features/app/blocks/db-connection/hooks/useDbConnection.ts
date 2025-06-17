import { useQuery } from '@tanstack/react-query';
import { getDbConnection } from '@teable/openapi';
import { useBaseId } from '@teable/sdk/hooks';

export const useDbConnection = () => {
  const baseId = useBaseId() as string;

  const { data, isLoading } = useQuery({
    queryKey: ['connection', baseId],
    queryFn: ({ queryKey }) => getDbConnection(queryKey[1]).then((data) => data.data),
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
