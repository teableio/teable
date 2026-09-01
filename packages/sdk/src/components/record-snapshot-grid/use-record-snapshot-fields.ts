import { useQuery } from '@tanstack/react-query';
import { getFields } from '@teable/openapi';
import { useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { createFieldInstance } from '../../model';

// Field instances a snapshot viewer (trash records / archive) may render: every
// field the caller can read, in field-list order.
export const useRecordSnapshotFields = (tableId: string, enabled = true) => {
  const { data: fieldsData } = useQuery({
    queryKey: ReactQueryKeys.fieldList(tableId),
    queryFn: ({ queryKey }) => getFields(queryKey[1]).then((res) => res.data),
    enabled: Boolean(tableId) && enabled,
  });

  return useMemo(
    () =>
      (fieldsData ?? [])
        .map((field) => createFieldInstance(field))
        .filter((field) => field.canReadFieldRecord),
    [fieldsData]
  );
};
