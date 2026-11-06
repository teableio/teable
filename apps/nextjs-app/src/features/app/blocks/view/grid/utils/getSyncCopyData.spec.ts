import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import type { Field, IRecordIndexMap } from '@teable/sdk';
import { CombinedSelection, SelectionRegionType } from '@teable/sdk';
import { describe, expect, it } from 'vitest';
import { getSingleRowCopyData, getSyncCopyData } from './getSyncCopyData';

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

const userField = {
  id: 'fldUser1111111111',
  name: 'Owner',
  dbFieldName: 'owner',
  type: FieldType.User,
  options: { isMultiple: false, shouldNotify: false },
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: false,
  cellValue2String: (value: { title?: string } | null) => value?.title ?? '',
} as unknown as Field;

const multipleUserField = {
  ...userField,
  id: 'fldUsers111111111',
  name: 'Owners',
  options: { isMultiple: true, shouldNotify: false },
  isMultipleCellValue: true,
  cellValue2String: (value: Array<{ title?: string }> | null) =>
    value?.map(({ title }) => title ?? '').join(', ') ?? '',
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

  describe('Rows selection', () => {
    it('emits empty cells for omitted field keys, which is why unloaded columns must not sync-copy', () => {
      const loaded = { ...textField, id: 'fldLoaded', name: 'Loaded' } as unknown as Field;
      const offscreen = { ...textField, id: 'fldOffscreen', name: 'Offscreen' } as unknown as Field;
      const recordMap = {
        0: {
          id: 'rec0',
          fields: { fldLoaded: 'kept' },
        },
      } as unknown as IRecordIndexMap;

      const { content, rawContent } = getSyncCopyData({
        recordMap,
        fields: [loaded, offscreen],
        selection: new CombinedSelection(SelectionRegionType.Rows, [[0, 0]]),
        rowCount: 1,
      });

      expect(content).toBe('kept\t');
      expect(rawContent).toEqual([['kept', undefined]]);
    });
  });
});

describe('getSingleRowCopyData', () => {
  it('keeps a single user value exactly as loaded', () => {
    const user = { id: 'usrA', title: 'Alice', email: 'alice@example.com' };
    const result = getSingleRowCopyData({
      fields: [userField],
      selection: new CombinedSelection(SelectionRegionType.Cells, [
        [0, 0],
        [0, 0],
      ]),
      fieldValueMap: { [userField.id]: user },
    });

    expect(result.content).toBe('Alice');
    expect(result.displayContent).toEqual([['Alice']]);
    expect(result.rawContent).toEqual([[user]]);
  });

  it('keeps multiple users and does not add a missing email', () => {
    const users = [
      { id: 'usrEmpty', title: 'Empty email', email: '' },
      { id: 'usrMissing', title: 'Missing email' },
    ];
    const result = getSingleRowCopyData({
      fields: [multipleUserField],
      selection: new CombinedSelection(SelectionRegionType.Cells, [
        [0, 0],
        [0, 0],
      ]),
      fieldValueMap: { [multipleUserField.id]: users },
    });

    expect(result.content).toBe('Empty email, Missing email');
    expect(result.displayContent).toEqual([['Empty email, Missing email']]);
    expect(result.rawContent).toEqual([[users]]);
    expect((result.rawContent[0]?.[0] as Array<Record<string, unknown>>)[1]).not.toHaveProperty(
      'email'
    );
  });
});
