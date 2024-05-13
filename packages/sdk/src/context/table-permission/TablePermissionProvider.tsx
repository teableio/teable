import { useQuery } from '@tanstack/react-query';
import type { IActionTriggerBuffer } from '@teable/core';
import { getActionTriggerChannel } from '@teable/core';
import { getTablePermission } from '@teable/openapi';
import { useEffect } from 'react';
import { ReactQueryKeys } from '../../config';
import { useBase, useConnection, useTableId } from '../../hooks';
import {
  TablePermissionContext,
  TablePermissionContextDefaultValue,
} from './TablePermissionContext';

export const TablePermissionProvider = ({ children }: { children: React.ReactNode }) => {
  const baseId = useBase().id;
  const tableId = useTableId();
  const { connection } = useConnection();

  const { data: tablePermission, refetch } = useQuery({
    queryKey: ReactQueryKeys.getTablePermission(baseId, tableId!),
    queryFn: ({ queryKey }) => getTablePermission(queryKey[1], queryKey[2]).then((res) => res.data),
    enabled: !!tableId,
  });

  useEffect(() => {
    if (tableId == null || connection == null) return;

    const channel = getActionTriggerChannel(tableId);
    const remotePresence = connection.getPresence(channel);
    remotePresence?.subscribe((err) => err && console.error);

    const receiveHandler = (_id: string, context: IActionTriggerBuffer) => {
      if (context.addField) {
        console.log('receiveHandler');
        refetch();
      }
    };

    remotePresence.on('receive', receiveHandler);
    return () => {
      remotePresence?.removeListener('receive', receiveHandler);
      remotePresence?.unsubscribe();
      remotePresence?.destroy();
    };
  }, [connection, refetch, tableId]);

  return (
    <TablePermissionContext.Provider value={tablePermission ?? TablePermissionContextDefaultValue}>
      {children}
    </TablePermissionContext.Provider>
  );
};
