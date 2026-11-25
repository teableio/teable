export const UNDO_REDO_ENGINE_PREFERENCE_TTL_SECONDS = 6 * 60 * 60;

export const buildUndoRedoEnginePreferenceKey = (
  userId: string,
  tableId: string,
  windowId: string
) => `operations:engine:${userId}:${tableId}:${windowId}` as const;

export const buildLegacyRedoKey = (userId: string, tableId: string, windowId: string) =>
  `operations:redo:${userId}:${tableId}:${windowId}` as const;
