import { useQuery } from '@tanstack/react-query';
import type { ITableActionKey } from '@teable/core';
import { getTablePermission } from '@teable/openapi';
import { useMemo } from 'react';
import { ReactQueryKeys } from '../../config';
import { useBase, useTableId, useTableListener } from '../../hooks';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from './TablePermissionContext';

export const TablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const baseId = useBase().id;
  const tableId = useTableId();

  const { data: tablePermission, refetch } = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId!),
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: !!tableId,
  });

  const tableMatches = useMemo<ITableActionKey[]>(() => ['addField'], []);
  useTableListener(tableId, tableMatches, refetch);

  return (
    <TablePermissionContext.Provider value={tablePermission ?? TablePermissionContextDefaultValue}>
      {children}
    </TablePermissionContext.Provider>
  );
};
