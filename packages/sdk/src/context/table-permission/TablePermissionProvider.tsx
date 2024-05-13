import { useQuery } from '@tanstack/react-query';
import { getTablePermission } from '@teable/openapi';
import { ReactQueryKeys } from '../../config';
import { useBase, useTableId } from '../../hooks';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from './TablePermissionContext';

export const TablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const baseId = useBase().id;
  const tableId = useTableId();
  const { data: tablePermission } = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId!),
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
  });

  return (
    <TablePermissionContext.Provider value={tablePermission ?? TablePermissionContextDefaultValue}>
      {children}
    </TablePermissionContext.Provider>
  );
};
