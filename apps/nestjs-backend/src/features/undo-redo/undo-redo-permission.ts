import type { Action } from '@teable/core';
import { flattenUndoRedoCommands } from '@teable/v2-core';
import type { UndoEntry, UndoRedoCommandLeafData } from '@teable/v2-core';
import type { IUndoRedoOperation } from '../../cache/types';
import { OperationName } from '../../cache/types';

export type IUndoRedoReplayMode = 'undo' | 'redo';

/**
 * Optional edition hook (enterprise: authority matrix). When a table's write
 * permissions are not decided by the caller's base role, the provider returns
 * the caller's current effective actions on that table — already narrowed by
 * the access-token scope — and the replay gate checks against that set.
 * Returning `undefined` means the base role governs, and the default check
 * (PermissionService.validPermissions) applies.
 */
export const UNDO_REDO_PERMISSION_RESOLVER = 'UNDO_REDO_PERMISSION_RESOLVER';

export interface IUndoRedoPermissionResolver {
  resolveTableActions(tableId: string): Promise<Action[] | undefined>;
}

// The undo/redo routes only require `table|read`: the stack itself is the
// caller's own history. What a replay WRITES, however, is whatever the entry
// carries, so the replay must be gated by the permissions those writes need
// at replay time — a collaborator downgraded after the original write must
// not be able to re-apply it through the stack. Both helpers return the
// actions a replay needs, or `null` when the entry contains something this
// mapping does not know (callers fail closed on `null`).

const unique = (actions: Action[]): Action[] => [...new Set(actions)];

const pasteSelectionActions = (
  operation: Extract<IUndoRedoOperation, { name: OperationName.PasteSelection }>,
  mode: IUndoRedoReplayMode
): Action[] => {
  const { updateRecords, newRecords, newFields } = operation.result;
  const actions: Action[] = [];
  if (updateRecords) {
    actions.push('record|update');
  }
  if (newRecords?.length) {
    actions.push(mode === 'undo' ? 'record|delete' : 'record|create');
  }
  if (newFields?.length) {
    actions.push(mode === 'undo' ? 'field|delete' : 'field|create');
  }
  return actions;
};

/**
 * Actions a v1 stack entry needs to be replayed in the given direction.
 * Undo of a create is a delete (and vice versa); in-place changes need the
 * matching update action in both directions.
 */
export const getV1UndoRedoRequiredActions = (
  operation: IUndoRedoOperation,
  mode: IUndoRedoReplayMode
): Action[] | null => {
  switch (operation.name) {
    case OperationName.CreateRecords:
      return [mode === 'undo' ? 'record|delete' : 'record|create'];
    case OperationName.DeleteRecords:
      return [mode === 'undo' ? 'record|create' : 'record|delete'];
    // Restoring one's own archived records through undo is bounded by the
    // archive capability, not by the archive-management right that governs
    // the archive screen — an Editor who can archive can also take it back.
    case OperationName.ArchiveRecords:
      return ['record|archive'];
    case OperationName.UpdateRecords:
      return ['record|update'];
    // Record order lives on the view (PUT /view/:viewId/record-order).
    case OperationName.UpdateRecordsOrder:
      return ['view|update'];
    case OperationName.CreateFields:
      return [mode === 'undo' ? 'field|delete' : 'field|create'];
    case OperationName.DeleteFields:
      return [mode === 'undo' ? 'field|create' : 'field|delete'];
    case OperationName.ConvertField:
    case OperationName.ConvertFieldV2:
      return ['field|update'];
    case OperationName.PasteSelection:
      return unique(pasteSelectionActions(operation, mode));
    case OperationName.CreateView:
      return [mode === 'undo' ? 'view|delete' : 'view|create'];
    case OperationName.DeleteView:
      return [mode === 'undo' ? 'view|create' : 'view|delete'];
    case OperationName.UpdateView:
      return ['view|update'];
    default: {
      // Compile-time exhaustiveness; an unknown name at runtime fails closed.
      const unhandled: never = operation;
      void unhandled;
      return null;
    }
  }
};

// `ApplyFieldSnapshot` / `ApplyViewSnapshot` are used both to bring back a
// deleted field/view and to revert an in-place change. The direction is
// visible in the entry's other side: when the opposite command deletes the
// same id, replaying the snapshot (re)creates it.
const recreatesField = (
  leaf: Extract<UndoRedoCommandLeafData, { type: 'ApplyFieldSnapshot' }>,
  opposite: ReadonlyArray<UndoRedoCommandLeafData>
) =>
  opposite.some(
    (other) =>
      other.type === 'DeleteField' && other.payload.fieldId === leaf.payload.snapshot.field.id
  );

const recreatesView = (
  leaf: Extract<UndoRedoCommandLeafData, { type: 'ApplyViewSnapshot' }>,
  opposite: ReadonlyArray<UndoRedoCommandLeafData>
) =>
  opposite.some(
    (other) => other.type === 'DeleteView' && other.payload.viewId === leaf.payload.snapshot.id
  );

const v2LeafActions = (
  leaf: UndoRedoCommandLeafData,
  opposite: ReadonlyArray<UndoRedoCommandLeafData>
): Action[] | null => {
  switch (leaf.type) {
    case 'UpdateRecord':
    case 'UpdateRecords':
    case 'SetButtonValue':
      return ['record|update'];
    case 'DeleteRecords':
      return ['record|delete'];
    case 'RestoreRecords':
      return ['record|create'];
    // Same reasoning as the v1 ArchiveRecords entry: reversing one's own
    // archive is part of the archive capability.
    case 'ArchiveRecords':
    case 'RestoreArchivedRecords':
      return ['record|archive'];
    case 'ApplyRecordOrders':
      return ['view|update'];
    case 'DeleteField':
      return ['field|delete'];
    case 'ApplyFieldSnapshot':
      return [recreatesField(leaf, opposite) ? 'field|create' : 'field|update'];
    case 'ReplayFieldTypeConversion':
      return ['field|update'];
    case 'DeleteView':
      return ['view|delete'];
    case 'ApplyViewSnapshot':
      return [recreatesView(leaf, opposite) ? 'view|create' : 'view|update'];
    case 'EnableViewShare':
      return ['view|share'];
    // Mirrors POST /view/:viewId/disable-share.
    case 'DisableViewShare':
      return ['view|update'];
    default: {
      const unhandled: never = leaf;
      void unhandled;
      return null;
    }
  }
};

/**
 * Actions a v2 stack entry needs to be replayed in the given direction: the
 * union over every leaf of the command that will run (`undoCommand` for undo,
 * `redoCommand` for redo).
 */
export const getV2UndoRedoRequiredActions = (
  entry: Pick<UndoEntry, 'undoCommand' | 'redoCommand'>,
  mode: IUndoRedoReplayMode
): Action[] | null => {
  const replayed = flattenUndoRedoCommands(mode === 'undo' ? entry.undoCommand : entry.redoCommand);
  const opposite = flattenUndoRedoCommands(mode === 'undo' ? entry.redoCommand : entry.undoCommand);
  const actions: Action[] = [];
  for (const leaf of replayed) {
    const leafActions = v2LeafActions(leaf, opposite);
    if (!leafActions) {
      return null;
    }
    actions.push(...leafActions);
  }
  return unique(actions);
};
