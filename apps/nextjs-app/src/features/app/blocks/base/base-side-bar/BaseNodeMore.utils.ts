type PermissionMap = Record<string, boolean | undefined>;

interface ITableRecordNavigationInput {
  activeTableId?: string;
  targetTableId: string;
  targetTableHref?: string;
  targetViewId?: string;
  currentPathname: string;
  currentQuery: Record<string, string | string[] | undefined>;
  recordId: string;
}

export const getTableRecordNavigation = ({
  activeTableId,
  targetTableId,
  targetTableHref,
  targetViewId,
  currentPathname,
  currentQuery,
  recordId,
}: ITableRecordNavigationInput) => {
  if (activeTableId === targetTableId) {
    return {
      url: {
        pathname: currentPathname,
        query: { ...currentQuery, recordId },
      },
      shallow: true,
    };
  }

  if (!targetTableHref) return;

  return {
    url: {
      pathname: targetTableHref,
      query: { recordId },
    },
    shallow: Boolean(targetViewId),
  };
};

interface ITableOperationPermissionInput {
  table?: { permission?: PermissionMap } | null;
  nodeExists: boolean;
  basePermission?: PermissionMap;
  canTableRecordHistoryRead?: boolean;
  canTableTrashRead?: boolean;
  canTableArchiveRead?: boolean;
}

export const getTableOperationMenuPermission = ({
  table,
  nodeExists,
  basePermission,
  canTableRecordHistoryRead,
  canTableTrashRead,
  canTableArchiveRead,
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
    tableArchive: Boolean(hasReadyTable && canTableArchiveRead),
    shareTable: Boolean(basePermission?.['base|update']),
    apiTable: hasReadyTable,
  };
};
