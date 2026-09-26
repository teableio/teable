import type { IRecordIndexMap } from '@teable/sdk';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import type { ILoadedRecordFields } from '@teable/sdk/utils/column-projection';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useIsSelectionLoaded } from './useIsSelectionLoaded';

const fields = [{ id: 'fldPrefix' }, { id: 'fldViewport' }, { id: 'fldOffscreen' }];
const doc = { id: 'doc-a' };

const recordMap = {
  0: { id: 'rec0', docSource: doc, fields: { fldPrefix: 'a' } },
} as unknown as IRecordIndexMap;

const rowSelection = new CombinedSelection(SelectionRegionType.Rows, [[0, 0]]);
const offscreenColumn = new CombinedSelection(SelectionRegionType.Columns, [[2, 2]]);
const prefixCells = new CombinedSelection(SelectionRegionType.Cells, [
  [0, 0],
  [0, 0],
]);

const loadedByRecord = (fieldIds: string[], source: object = doc) =>
  new Map<string, ILoadedRecordFields>([['rec0', { source, fields: new Set(fieldIds) }]]);

const isSelectionLoaded = (args: {
  selection: CombinedSelection;
  recordMap: IRecordIndexMap;
  rowCount: number;
  loadedFieldsByRecordId?: ReadonlyMap<string, ILoadedRecordFields>;
  snapshotFieldIds?: ReadonlySet<string>;
  fields?: { id: string }[];
}) => {
  const { result } = renderHook(() => useIsSelectionLoaded());
  return result.current(args);
};

describe('useIsSelectionLoaded', () => {
  it('treats a whole-row copy as unloaded when any visible column is missing', () => {
    expect(
      isSelectionLoaded({
        selection: rowSelection,
        recordMap,
        rowCount: 1,
        loadedFieldsByRecordId: loadedByRecord(['fldPrefix', 'fldViewport']),
        snapshotFieldIds: new Set(['fldPrefix']),
        fields,
      })
    ).toBe(false);
  });

  it('allows a whole-row copy only after every visible column is loaded', () => {
    expect(
      isSelectionLoaded({
        selection: rowSelection,
        recordMap,
        rowCount: 1,
        loadedFieldsByRecordId: loadedByRecord(fields.map((field) => field.id)),
        snapshotFieldIds: new Set(['fldPrefix']),
        fields,
      })
    ).toBe(true);
  });

  it('still allows sync-copy of a loaded cell rectangle while off-screen columns stay sparse', () => {
    expect(
      isSelectionLoaded({
        selection: prefixCells,
        recordMap,
        rowCount: 1,
        loadedFieldsByRecordId: loadedByRecord(['fldPrefix']),
        snapshotFieldIds: new Set(['fldPrefix']),
        fields,
      })
    ).toBe(true);
  });

  it('treats an off-screen column selection as unloaded', () => {
    expect(
      isSelectionLoaded({
        selection: offscreenColumn,
        recordMap,
        rowCount: 1,
        loadedFieldsByRecordId: loadedByRecord(['fldPrefix']),
        snapshotFieldIds: new Set(['fldPrefix']),
        fields,
      })
    ).toBe(false);
  });

  it('keeps the pre-sparse path: loaded rows copy locally when field tracking is absent', () => {
    expect(
      isSelectionLoaded({
        selection: rowSelection,
        recordMap,
        rowCount: 1,
        fields,
      })
    ).toBe(true);
  });
});
