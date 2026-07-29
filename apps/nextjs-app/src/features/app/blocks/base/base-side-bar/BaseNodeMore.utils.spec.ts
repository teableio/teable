import { describe, expect, it } from 'vitest';
import { getTableOperationMenuPermission, getTableRecordNavigation } from './BaseNodeMore.utils';

describe('getTableRecordNavigation', () => {
  it('keeps the current route when the record belongs to the active table', () => {
    expect(
      getTableRecordNavigation({
        activeTableId: 'tblA',
        targetTableId: 'tblA',
        targetTableHref: '/base/bse1/table/tblA/viwA',
        targetViewId: 'viwA',
        currentPathname: '/base/[baseId]/[[...slug]]',
        currentQuery: { baseId: 'bse1', slug: ['table', 'tblA', 'viwA'] },
        recordId: 'recA',
      })
    ).toEqual({
      url: {
        pathname: '/base/[baseId]/[[...slug]]',
        query: { baseId: 'bse1', slug: ['table', 'tblA', 'viwA'], recordId: 'recA' },
      },
      shallow: true,
    });
  });

  it('navigates to the owning table before opening a cross-table record', () => {
    expect(
      getTableRecordNavigation({
        activeTableId: 'tblA',
        targetTableId: 'tblB',
        targetTableHref: '/base/bse1/table/tblB/viwB',
        targetViewId: 'viwB',
        currentPathname: '/base/[baseId]/[[...slug]]',
        currentQuery: { baseId: 'bse1', slug: ['table', 'tblA', 'viwA'] },
        recordId: 'recB',
      })
    ).toEqual({
      url: {
        pathname: '/base/bse1/table/tblB/viwB',
        query: { recordId: 'recB' },
      },
      shallow: true,
    });
  });

  it('does not open a cross-table record when its table route is unavailable', () => {
    expect(
      getTableRecordNavigation({
        activeTableId: 'tblA',
        targetTableId: 'tblB',
        currentPathname: '/base/[baseId]/[[...slug]]',
        currentQuery: {},
        recordId: 'recB',
      })
    ).toBeUndefined();
  });
});

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
