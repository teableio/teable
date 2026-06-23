import { FieldType } from '@teable/core';
import type { Field, IRecordIndexMap } from '@teable/sdk';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import { describe, expect, it } from 'vitest';
import { getSyncCopyData } from './getSyncCopyData';

const textField = {
  id: 'fldText1111111111',
  name: 'Text',
  dbFieldName: 'text',
  type: FieldType.SingleLineText,
  options: {},
  cellValueType: 'string',
  dbFieldType: 'TEXT',
  cellValue2String: (value: unknown) => (value == null ? '' : String(value)),
} as unknown as Field;

const buildRecordMap = (values: (string | undefined)[]) =>
  values.reduce((acc, value, index) => {
    acc[index] = {
      id: `rec${index}`,
      fields: { [textField.id]: value },
    } as unknown as IRecordIndexMap[number];
    return acc;
  }, {} as IRecordIndexMap);

describe('getSyncCopyData', () => {
  describe('Columns selection', () => {
    it('copies only the visible rows, ignoring stale recordMap entries beyond rowCount', () => {
      // simulates a filter narrowing 3 rows down to 1 while old rows stay cached
      const recordMap = buildRecordMap(['2', '1', '2']);
      const selection = new CombinedSelection(SelectionRegionType.Columns, [[0, 0]]);

      const { content, rawContent } = getSyncCopyData({
        recordMap,
        fields: [textField],
        selection,
        rowCount: 1,
      });

      expect(content).toBe('2');
      expect(rawContent).toEqual([['2']]);
    });

    it('copies all rows when rowCount matches the loaded records', () => {
      const recordMap = buildRecordMap(['a', 'b', 'c']);
      const selection = new CombinedSelection(SelectionRegionType.Columns, [[0, 0]]);

      const { content } = getSyncCopyData({
        recordMap,
        fields: [textField],
        selection,
        rowCount: 3,
      });

      expect(content).toBe('a\nb\nc');
    });
  });
});
