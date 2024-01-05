import { MoreHorizontal, Trash2 } from '@teable-group/icons';
import { useBase, useTablePermission, useTables } from '@teable-group/sdk/hooks';
import type { Table } from '@teable-group/sdk/model';
import { ConfirmDialog } from '@teable-group/ui-lib/base';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@teable-group/ui-lib/shadcn';
import { useRouter } from 'next/router';
import React, { useMemo } from 'react';

interface ITableOperationProps {
  className?: string;
  table: Table;
}

export const TableOperation = (props: ITableOperationProps) => {
  const { table, className } = props;
  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const permission = useTablePermission();
  const base = useBase();
  const tables = useTables();
  const router = useRouter();
  const { baseId, nodeId: routerTableId } = router.query;

  const menuPermission = useMemo(() => {
    return {
      deleteTable: permission['table|delete'],
    };
  }, [permission]);

  const deleteTable = async () => {
    const tableId = table?.id;
    if (!tableId) {
      return;
    }
    await base.deleteTable(tableId);
    const firstTableId = tables.find((t) => t.id !== tableId)?.id;
    if (routerTableId === tableId) {
      router.push(
        firstTableId
          ? {
              pathname: '/base/[baseId]/[nodeId]',
              query: { baseId, nodeId: firstTableId },
            }
          : {
              pathname: '/base/[baseId]',
              query: { baseId },
            }
      );
    }
  };

  if (!Object.values(menuPermission).some(Boolean)) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div>
            <MoreHorizontal className={className} />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="min-w-[160px]"
          onClick={(e) => e.stopPropagation()}
        >
          {menuPermission.deleteTable && (
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteConfirm(true)}>
              <Trash2 className="mr-2" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title={`Are you sure you want to delete ${table?.name}?`}
        cancelText="Cancel"
        confirmText="Continue"
        onCancel={() => setDeleteConfirm(false)}
        onConfirm={deleteTable}
      />
    </>
  );
};
