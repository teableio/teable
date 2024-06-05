import { useQuery } from '@tanstack/react-query';
import type { ITableActionKey } from '@teable/core';
import { getTablePermission } from '@teable/openapi';
import { useEffect } from 'react';
import { ReactQueryKeys } from '../../config';
import { useBase, useTableId } from '../../hooks';
import { useActionPresence } from '../../hooks/use-presence';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from './TablePermissionContext';

export const TablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const baseId = useBase().id;
  const tableId = useTableId();
  const presence = useActionPresence(tableId);

  const { data: tablePermission, refetch } = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId!),
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: !!tableId,
  });

  useEffect(() => {
    if (tableId == null || !presence) return;

    const cb = (_id: string, res: ITableActionKey[]) => {
      if (res.some((action) => action === 'addField')) {
        refetch();
      }
    };

    presence.addListener('receive', cb);

    return () => {
      presence.removeListener('receive', cb);
    };
  }, [presence, refetch, tableId]);

  return (
    <TablePermissionContext.Provider value={tablePermission ?? TablePermissionContextDefaultValue}>
      {children}
    </TablePermissionContext.Provider>
  );
};
