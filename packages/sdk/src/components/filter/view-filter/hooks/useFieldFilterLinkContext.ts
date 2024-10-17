import { useQuery } from '@tanstack/react-query';
import { getFieldFilterLinkRecords } from '@teable/openapi';
import { ReactQueryKeys } from '../../../../config';

export const useFieldFilterLinkContext = (
  tableId: string,
  fieldId?: string,
  disabled?: boolean
) => {
  const { isLoading, data: queryData } = useQuery({
    queryKey: ReactQueryKeys.getFieldFilterLinkRecords(tableId, fieldId!),
    queryFn: ({ queryKey }) =>
      getFieldFilterLinkRecords(queryKey[1], queryKey[2]).then((data) => data.data),
    enabled: !disabled && Boolean(fieldId),
  });

  return {
    isLoading,
    data: queryData?.map((v) => ({
      tableId: v.tableId,
      data: v.records.reduce(
        (acc, cur) => {
          acc[cur.id] = cur.title;
          return acc;
        },
        {} as Record<string, string | undefined>
      ),
    })),
  };
};
