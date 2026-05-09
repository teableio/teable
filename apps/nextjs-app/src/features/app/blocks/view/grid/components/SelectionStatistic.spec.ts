import { CellValueType } from '@teable/core';
import type { IFieldInstance, IRecordIndexMap, Record as SdkRecord } from '@teable/sdk';
import { SelectionRegionType } from '@teable/sdk/components/grid/interface';
import { CombinedSelection } from '@teable/sdk/components/grid/managers';
import { describe, it, expect } from 'vitest';
import { computeSelectionStatistic } from './SelectionStatistic';

const numField = (id: string): IFieldInstance =>
  ({ id, cellValueType: CellValueType.Number }) as IFieldInstance;

const textField = (id: string): IFieldInstance =>
  ({ id, cellValueType: CellValueType.String }) as IFieldInstance;

const oneToOneLookupField = (id: string): IFieldInstance =>
  ({
    id,
    cellValueType: CellValueType.String,
    isLookup: true,
    isMultipleCellValue: false,
  }) as IFieldInstance;

const fakeRecord = (values: { [fieldId: string]: unknown }): SdkRecord =>
  ({
    getCellValue: (fieldId: string) => values[fieldId],
  }) as unknown as SdkRecord;

const cellSelection = (c0: number, r0: number, c1: number, r1: number) =>
  new CombinedSelection(SelectionRegionType.Cells, [
    [c0, r0],
    [c1, r1],
  ]);

describe('computeSelectionStatistic', () => {
  const num1 = numField('fldNum1');
  const num2 = numField('fldNum2');
  const text = textField('fldText');
  const fields = [num1, num2, text];
  const columns = [{ id: 'fldNum1' }, { id: 'fldNum2' }, { id: 'fldText' }];

  const recordMap: IRecordIndexMap = {
    0: fakeRecord({ fldNum1: 10, fldNum2: 100, fldText: 'a' }),
    1: fakeRecord({ fldNum1: 20, fldNum2: null, fldText: 'b' }),
    2: fakeRecord({ fldNum1: 30, fldNum2: NaN, fldText: 'c' }),
  };

  it('sums numeric cells across a 2D selection, ignoring text columns', () => {
    const result = computeSelectionStatistic(cellSelection(0, 0, 2, 2), recordMap, columns, fields);
    expect(result).not.toBeNull();
    expect(result!.sum.toNumber()).toBe(160); // 10+20+30 + 100
    expect(result!.count).toBe(4); // num2[1]=null, num2[2]=NaN both skipped
    expect(result!.average.toNumber()).toBe(40);
    expect(result!.representativeField).toBe(num1);
  });

  it('returns null for a single-cell selection', () => {
    const result = computeSelectionStatistic(cellSelection(0, 0, 0, 0), recordMap, columns, fields);
    expect(result).toBeNull();
  });

  it('returns null when selection contains no numeric cells', () => {
    const textOnlyColumns = [{ id: 'fldText' }];
    const result = computeSelectionStatistic(
      cellSelection(0, 0, 0, 2),
      recordMap,
      textOnlyColumns,
      [text]
    );
    expect(result).toBeNull();
  });

  it('returns null for non-cell selection types', () => {
    const rowSelection = new CombinedSelection(SelectionRegionType.Rows, [[0, 1]]);
    expect(computeSelectionStatistic(rowSelection, recordMap, columns, fields)).toBeNull();
  });

  it('flattens array values from Lookup/Rollup numeric fields', () => {
    const lookupField = numField('fldLookup');
    const lookupColumns = [{ id: 'fldLookup' }];
    const rm: IRecordIndexMap = {
      0: fakeRecord({ fldLookup: [1, 2, 3] }),
      1: fakeRecord({ fldLookup: [4] }),
      2: fakeRecord({ fldLookup: null }),
    };
    const result = computeSelectionStatistic(cellSelection(0, 0, 0, 2), rm, lookupColumns, [
      lookupField,
    ]);
    expect(result!.sum.toNumber()).toBe(10);
    expect(result!.count).toBe(4);
  });

  it('uses arbitrary-precision arithmetic to avoid float compounding', () => {
    // 0.1 + 0.2 + 0.3 in native floats = 0.6000000000000001. With Decimal: 0.6.
    const f = numField('fldNum');
    const cols = [{ id: 'fldNum' }];
    const rm: IRecordIndexMap = {
      0: fakeRecord({ fldNum: 0.1 }),
      1: fakeRecord({ fldNum: 0.2 }),
      2: fakeRecord({ fldNum: 0.3 }),
    };
    const result = computeSelectionStatistic(cellSelection(0, 0, 0, 2), rm, cols, [f]);
    expect(result!.sum.toString()).toBe('0.6');
    expect(result!.average.toFixed(3)).toBe('0.200');
  });

  it('coerces stringified numbers from one-to-one Lookup fields', () => {
    // v2 Lookup-of-Number can come through as SingleLineText (cellValueType=String)
    // with a string value. We still want to count it.
    const lookup = oneToOneLookupField('fldLookup');
    const plainText = textField('fldPlainText');
    const cols = [{ id: 'fldLookup' }, { id: 'fldPlainText' }];
    const rm: IRecordIndexMap = {
      0: fakeRecord({ fldLookup: '2', fldPlainText: '99' }),
      1: fakeRecord({ fldLookup: '5', fldPlainText: 'abc' }),
      2: fakeRecord({ fldLookup: 'abc', fldPlainText: '99' }), // un-parseable lookup → skipped
    };
    const result = computeSelectionStatistic(cellSelection(0, 0, 1, 2), rm, cols, [
      lookup,
      plainText,
    ]);
    // Lookup contributes 2 + 5 = 7. Plain text strings (even "99") are NOT coerced.
    expect(result!.sum.toNumber()).toBe(7);
    expect(result!.count).toBe(2);
  });

  it('skips unloaded rows silently', () => {
    const sparseMap: IRecordIndexMap = {
      0: fakeRecord({ fldNum1: 5 }),
      // index 1 is unloaded
      2: fakeRecord({ fldNum1: 7 }),
    };
    const result = computeSelectionStatistic(
      cellSelection(0, 0, 0, 2),
      sparseMap,
      [{ id: 'fldNum1' }],
      [num1]
    );
    expect(result!.sum.toNumber()).toBe(12);
    expect(result!.count).toBe(2);
  });
});
