export function getAggregationChannel(tableId: string, viewId: string) {
  return `__aggregation_${tableId}_${viewId}`;
}

export function getRowCountChannel(tableId: string, viewId: string) {
  return `__row_count_${tableId}_${viewId}`;
}

export function getCollaboratorsChannel(tableId: string) {
  return `__col_user_${tableId}`;
}

export function getCellCollaboratorsChannel(tableId: string) {
  return `__col_cell_user_${tableId}`;
}
