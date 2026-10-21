import { createUndoRedoCommand } from '@teable/v2-core';
import type { UndoRedoCommandLeafData } from '@teable/v2-core';
import { describe, expect, it } from 'vitest';
import type { IUndoRedoOperation } from '../../cache/types';
import { OperationName } from '../../cache/types';
import { getV1UndoRedoRequiredActions, getV2UndoRedoRequiredActions } from './undo-redo-permission';

const tableId = 'tblxxxxxxxxxxxxxxxx';
const viewId = 'viwxxxxxxxxxxxxxxxx';
const fieldId = 'fldxxxxxxxxxxxxxxxx';

const v1 = (name: OperationName, result: Record<string, unknown> = {}) =>
  ({ name, params: { tableId }, result }) as unknown as IUndoRedoOperation;

describe('getV1UndoRedoRequiredActions', () => {
  it.each([
    [OperationName.CreateRecords, ['record|delete'], ['record|create']],
    [OperationName.DeleteRecords, ['record|create'], ['record|delete']],
    [OperationName.ArchiveRecords, ['record|archive'], ['record|archive']],
    [OperationName.UpdateRecords, ['record|update'], ['record|update']],
    [OperationName.UpdateRecordsOrder, ['view|update'], ['view|update']],
    [OperationName.CreateFields, ['field|delete'], ['field|create']],
    [OperationName.DeleteFields, ['field|create'], ['field|delete']],
    [OperationName.ConvertField, ['field|update'], ['field|update']],
    [OperationName.ConvertFieldV2, ['field|update'], ['field|update']],
    [OperationName.CreateView, ['view|delete'], ['view|create']],
    [OperationName.DeleteView, ['view|create'], ['view|delete']],
    [OperationName.UpdateView, ['view|update'], ['view|update']],
  ])('%s: undo needs %j, redo needs %j', (name, undoActions, redoActions) => {
    expect(getV1UndoRedoRequiredActions(v1(name), 'undo')).toEqual(undoActions);
    expect(getV1UndoRedoRequiredActions(v1(name), 'redo')).toEqual(redoActions);
  });

  it('paste: cell updates alone only need record|update', () => {
    const operation = v1(OperationName.PasteSelection, {
      updateRecords: { recordIds: [], fieldIds: [], cellContexts: [] },
    });
    expect(getV1UndoRedoRequiredActions(operation, 'undo')).toEqual(['record|update']);
    expect(getV1UndoRedoRequiredActions(operation, 'redo')).toEqual(['record|update']);
  });

  it('paste: expanded rows and columns need the matching create/delete actions', () => {
    const operation = v1(OperationName.PasteSelection, {
      updateRecords: { recordIds: [], fieldIds: [], cellContexts: [] },
      newRecords: [{ id: 'recxxxxxxxxxxxxxxxx', fields: {} }],
      newFields: [{ id: fieldId }],
    });
    expect(getV1UndoRedoRequiredActions(operation, 'undo')).toEqual([
      'record|update',
      'record|delete',
      'field|delete',
    ]);
    expect(getV1UndoRedoRequiredActions(operation, 'redo')).toEqual([
      'record|update',
      'record|create',
      'field|create',
    ]);
  });

  it('fails closed on an operation it does not know', () => {
    expect(getV1UndoRedoRequiredActions(v1('somethingNew' as OperationName), 'undo')).toBeNull();
  });
});

describe('getV2UndoRedoRequiredActions', () => {
  const snapshotField = { id: fieldId, name: 'f', type: 'singleLineText' };
  const fieldSnapshot = createUndoRedoCommand('ApplyFieldSnapshot', {
    baseId: 'bsexxxxxxxxxxxxxxxx',
    tableId,
    snapshot: { field: snapshotField as never, views: [] },
  });
  const deleteField = createUndoRedoCommand('DeleteField', {
    baseId: 'bsexxxxxxxxxxxxxxxx',
    tableId,
    fieldId,
  });
  const viewSnapshot = createUndoRedoCommand('ApplyViewSnapshot', {
    tableId,
    snapshot: { id: viewId } as never,
  });
  const deleteView = createUndoRedoCommand('DeleteView', { tableId, viewId });
  const updateRecord = createUndoRedoCommand('UpdateRecord', {
    tableId,
    recordId: 'recxxxxxxxxxxxxxxxx',
    fields: {},
    fieldKeyType: 'id',
    typecast: false,
  });
  const deleteRecords = createUndoRedoCommand('DeleteRecords', { tableId, recordIds: [] });
  const restoreRecords = createUndoRedoCommand('RestoreRecords', { tableId, records: [] });

  it('maps a field creation: undo deletes the field, redo re-applies its snapshot', () => {
    const entry = { undoCommand: deleteField, redoCommand: fieldSnapshot };
    expect(getV2UndoRedoRequiredActions(entry, 'undo')).toEqual(['field|delete']);
    expect(getV2UndoRedoRequiredActions(entry, 'redo')).toEqual(['field|create']);
  });

  it('maps a field deletion: undo recreates the field from its snapshot', () => {
    const entry = { undoCommand: fieldSnapshot, redoCommand: deleteField };
    expect(getV2UndoRedoRequiredActions(entry, 'undo')).toEqual(['field|create']);
    expect(getV2UndoRedoRequiredActions(entry, 'redo')).toEqual(['field|delete']);
  });

  it('maps a field edit (snapshot on both sides) to field|update', () => {
    const entry = { undoCommand: fieldSnapshot, redoCommand: fieldSnapshot };
    expect(getV2UndoRedoRequiredActions(entry, 'undo')).toEqual(['field|update']);
    expect(getV2UndoRedoRequiredActions(entry, 'redo')).toEqual(['field|update']);
  });

  it('only treats a snapshot as a re-creation when the opposite side deletes the same id', () => {
    const otherDelete = createUndoRedoCommand('DeleteField', {
      baseId: 'bsexxxxxxxxxxxxxxxx',
      tableId,
      fieldId: 'fldyyyyyyyyyyyyyyyy',
    });
    const entry = { undoCommand: fieldSnapshot, redoCommand: otherDelete };
    expect(getV2UndoRedoRequiredActions(entry, 'undo')).toEqual(['field|update']);
  });

  it('maps view create / delete / edit the same way', () => {
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: deleteView, redoCommand: viewSnapshot }, 'undo')
    ).toEqual(['view|delete']);
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: viewSnapshot, redoCommand: deleteView }, 'undo')
    ).toEqual(['view|create']);
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: viewSnapshot, redoCommand: viewSnapshot }, 'redo')
    ).toEqual(['view|update']);
  });

  it('maps record commands', () => {
    expect(
      getV2UndoRedoRequiredActions(
        { undoCommand: restoreRecords, redoCommand: deleteRecords },
        'undo'
      )
    ).toEqual(['record|create']);
    expect(
      getV2UndoRedoRequiredActions(
        { undoCommand: restoreRecords, redoCommand: deleteRecords },
        'redo'
      )
    ).toEqual(['record|delete']);
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: updateRecord, redoCommand: updateRecord }, 'undo')
    ).toEqual(['record|update']);
  });

  it.each([
    ['SetButtonValue', ['record|update']],
    ['UpdateRecords', ['record|update']],
    ['ArchiveRecords', ['record|archive']],
    ['RestoreArchivedRecords', ['record|archive']],
    ['ApplyRecordOrders', ['view|update']],
    ['ReplayFieldTypeConversion', ['field|update']],
    ['EnableViewShare', ['view|share']],
    ['DisableViewShare', ['view|update']],
  ] as const)('maps %s to %j', (type, actions) => {
    const leaf = { type, version: 1, payload: {} } as unknown as UndoRedoCommandLeafData;
    expect(getV2UndoRedoRequiredActions({ undoCommand: leaf, redoCommand: leaf }, 'undo')).toEqual(
      actions
    );
  });

  it('unions the actions of every leaf in a batch, without duplicates', () => {
    const batch = createUndoRedoCommand('Batch', [restoreRecords, updateRecord, fieldSnapshot]);
    const opposite = createUndoRedoCommand('Batch', [deleteRecords, updateRecord, deleteField]);
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: batch, redoCommand: opposite }, 'undo')
    ).toEqual(['record|create', 'record|update', 'field|create']);
  });

  it('fails closed when any leaf is of an unknown type', () => {
    const unknownLeaf = {
      type: 'SomethingNew',
      version: 1,
      payload: {},
    } as unknown as UndoRedoCommandLeafData;
    const batch = createUndoRedoCommand('Batch', [updateRecord, unknownLeaf]);
    expect(
      getV2UndoRedoRequiredActions({ undoCommand: batch, redoCommand: batch }, 'undo')
    ).toBeNull();
  });
});
