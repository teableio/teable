import { describe, expect, it } from 'vitest';
import { getTableOperationMenuPermission } from './BaseNodeMore.utils';

describe('getTableOperationMenuPermission', () => {
  it('keeps recovery actions for a table node missing from the ready table list', () => {
    const permission = getTableOperationMenuPermission({
      table: undefined,
      nodeExists: true,
      basePermission: {
        'base|update': true,
        'table|delete': true,
        'table|update': true,
        'table|create': true,
      },
      canTableRecordHistoryRead: true,
      canTableTrashRead: true,
    });

    expect(permission).toMatchObject({
      deleteTable: true,
      updateTable: true,
      duplicateTable: false,
      exportTable: false,
      importTable: false,
      tableRecordHistory: false,
      tableTrash: false,
      shareTable: true,
      apiTable: false,
    });
  });

  it('keeps explicit table permission denial stronger than base fallbacks', () => {
    const permission = getTableOperationMenuPermission({
      table: {
        permission: {
          'table|delete': false,
          'table|update': false,
          'table|read': true,
          'table|export': true,
          'table|import': true,
        },
      },
      nodeExists: true,
      basePermission: {
        'base|update': true,
        'table|delete': true,
        'table|update': true,
        'table|create': true,
      },
      canTableRecordHistoryRead: true,
      canTableTrashRead: true,
    });

    expect(permission).toMatchObject({
      deleteTable: false,
      updateTable: false,
      duplicateTable: true,
      exportTable: true,
      importTable: true,
      tableRecordHistory: true,
      tableTrash: true,
      shareTable: true,
      apiTable: true,
    });
  });
});
