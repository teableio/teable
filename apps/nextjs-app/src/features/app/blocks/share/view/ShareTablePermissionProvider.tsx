import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from '@teable/sdk/context/table-permission';
import { useFields } from '@teable/sdk/hooks';
import { map } from 'lodash';
import { useMemo } from 'react';

export const ShareTablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const fields = useFields({ withHidden: true, withDenied: true });
  const fieldIds = map(fields, 'id');

  const value = useMemo(() => {
    return {
      ...TablePermissionContextDefaultValue,
      field: {
        create: false,
        fields: fieldIds.reduce(
          (acc, fieldId) => {
            acc[fieldId] = {
              'field|read': true,
            };
            return acc;
          },
          {} as Record<string, Record<string, boolean>>
        ),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fieldIds)]);

  return (
    <TablePermissionContext.Provider value={value}>{children}</TablePermissionContext.Provider>
  );
};
