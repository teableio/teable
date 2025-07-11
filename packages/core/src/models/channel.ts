export function getCollaboratorsChannel(tableId: string) {
  return `__col_user_${tableId}`;
}

export function getCellCollaboratorsChannel(tableId: string) {
  return `__col_cell_user_${tableId}`;
}

export function getUserNotificationChannel(userId: string) {
  return `__notification_user_${userId}`;
}

export function getActionTriggerChannel(tableIdOrViewId: string) {
  return `__action_trigger_${tableIdOrViewId}`;
}

export function getBasePermissionUpdateChannel(baseId: string) {
  return `__base_permission_update_${baseId}`;
}

export function getTableImportChannel(tableId: string) {
  return `__table_import_${tableId}`;
}

export function getCommentChannel(tableId: string, recordId: string) {
  return `__record_comment_${tableId}_${recordId}`;
}

export function getTableCommentChannel(tableId: string) {
  return `__table_comment_${tableId}`;
}

export function getTableButtonClickChannel(tableId: string) {
  return `__table_button_click_${tableId}`;
}

export function getToolCallChannel(toolCallId: string) {
  return `__tool_call_${toolCallId}`;
}

export function getChatChannel(chatId: string) {
  return `__chat_${chatId}`;
}
