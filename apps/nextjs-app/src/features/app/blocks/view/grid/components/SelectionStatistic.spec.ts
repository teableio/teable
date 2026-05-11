import { CellValueType, StatisticsFunc } from '@teable/core';
import type { ISelectionAggregationVo } from '@teable/openapi';
import type { IFieldInstance, IRecordIndexMap, Record as SdkRecord } from '@teable/sdk';
import { SelectionRegionType } from '@teable/sdk/components/grid/interface';
import { CombinedSelection } from '@teable/sdk/components/grid/managers';
import { describe, it, expect } from 'vitest';
import { computeSelectionStatistic, mergeBackendStats } from './SelectionStatistic';

const numField = (id: string): IFieldInstance =>
  ({ id, cellValueType: CellValueType.Number }) as IFieldInstance;

const multiNumField = (id: string): IFieldInstance =>
  ({ id, cellValueType: CellValueType.Number, isMultipleCellValue: true }) as IFieldInstance;

const textField = (id: string): IFieldInstance =>
  ({ id, cellValueType: CellValueType.String }) as IFieldInstance;

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

  it('skips fields with isMultipleCellValue (multi-value rollups/lookups)', () => {
    const multi = multiNumField('fldMulti');
    const cols = [{ id: 'fldNum1' }, { id: 'fldMulti' }];
    const rm: IRecordIndexMap = {
      0: fakeRecord({ fldNum1: 5, fldMulti: [1, 2, 3] }),
      1: fakeRecord({ fldNum1: 7, fldMulti: [4] }),
    };
    const result = computeSelectionStatistic(cellSelection(0, 0, 1, 1), rm, cols, [num1, multi]);
    // Only fldNum1 contributes: 5 + 7 = 12, count 2.
    expect(result!.sum.toNumber()).toBe(12);
    expect(result!.count).toBe(2);
    expect(result!.representativeField).toBe(num1);
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

  it('skips unloaded rows silently (frontend-only path)', () => {
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

describe('mergeBackendStats', () => {
  const num1 = numField('fldNum1');
  const num2 = numField('fldNum2');
  const text = textField('fldText');
  const fields = [num1, num2, text];
  const columns = [{ id: 'fldNum1' }, { id: 'fldNum2' }, { id: 'fldText' }];

  it('totals per-(field, aggFunc) backend rows into combined sum/count/average', () => {
    const data: ISelectionAggregationVo = {
      aggregations: [
        { fieldId: 'fldNum1', total: { value: 60, aggFunc: StatisticsFunc.Sum } },
        { fieldId: 'fldNum1', total: { value: 3, aggFunc: StatisticsFunc.Filled } },
        { fieldId: 'fldNum2', total: { value: 200, aggFunc: StatisticsFunc.Sum } },
        { fieldId: 'fldNum2', total: { value: 2, aggFunc: StatisticsFunc.Filled } },
      ],
    };
    const result = mergeBackendStats(data, ['fldNum1', 'fldNum2'], columns, fields, 0, 2);
    expect(result!.sum.toNumber()).toBe(260);
    expect(result!.count).toBe(5);
    expect(result!.average.toNumber()).toBe(52);
    expect(result!.representativeField).toBe(num1);
  });

  it('returns null when total filled is zero', () => {
    const data: ISelectionAggregationVo = {
      aggregations: [
        { fieldId: 'fldNum1', total: { value: null, aggFunc: StatisticsFunc.Sum } },
        { fieldId: 'fldNum1', total: { value: 0, aggFunc: StatisticsFunc.Filled } },
      ],
    };
    expect(mergeBackendStats(data, ['fldNum1'], columns, fields, 0, 0)).toBeNull();
  });

  it('ignores fieldIds outside the aggregable set (defensive)', () => {
    const data: ISelectionAggregationVo = {
      aggregations: [
        { fieldId: 'fldNum1', total: { value: 50, aggFunc: StatisticsFunc.Sum } },
        { fieldId: 'fldNum1', total: { value: 2, aggFunc: StatisticsFunc.Filled } },
        { fieldId: 'fldStranger', total: { value: 999, aggFunc: StatisticsFunc.Sum } },
        { fieldId: 'fldStranger', total: { value: 9, aggFunc: StatisticsFunc.Filled } },
      ],
    };
    const result = mergeBackendStats(data, ['fldNum1'], columns, fields, 0, 1);
    expect(result!.sum.toNumber()).toBe(50);
    expect(result!.count).toBe(2);
  });
});
