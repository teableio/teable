export function getCollaboratorsChannel(tableId: string) {
  return `__col_user_${tableId}`;
}

export function getCellCollaboratorsChannel(tableId: string) {
  return `__col_cell_user_${tableId}`;
}

export function getUserNotificationChannel(userId: string) {
  return `__notification_user_${userId}`;
}

export function getActionTriggerChannel(table: string) {
  return `__action_trigger_${table}`;
}
