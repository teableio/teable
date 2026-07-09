type PermissionMap = Record<string, boolean | undefined>;

interface ITableOperationPermissionInput {
  table?: { permission?: PermissionMap } | null;
  nodeExists: boolean;
  basePermission?: PermissionMap;
  canTableRecordHistoryRead?: boolean;
  canTableTrashRead?: boolean;
}

export const getTableOperationMenuPermission = ({
  table,
  nodeExists,
  basePermission,
  canTableRecordHistoryRead,
  canTableTrashRead,
}: ITableOperationPermissionInput) => {
  const hasReadyTable = Boolean(table);

  return {
    deleteTable: Boolean(
      table?.permission?.['table|delete'] ?? (nodeExists && basePermission?.['table|delete'])
    ),
    updateTable: Boolean(
      table?.permission?.['table|update'] ?? (nodeExists && basePermission?.['table|update'])
    ),
    duplicateTable: Boolean(table?.permission?.['table|read'] && basePermission?.['table|create']),
    exportTable: Boolean(table?.permission?.['table|export']),
    importTable: Boolean(table?.permission?.['table|import']),
    tableRecordHistory: Boolean(hasReadyTable && canTableRecordHistoryRead),
    tableTrash: Boolean(hasReadyTable && canTableTrashRead),
    shareTable: Boolean(basePermission?.['base|update']),
    apiTable: hasReadyTable,
  };
};
