import type { IGridRowColorRule } from '@teable/core';
import { CellValueType, Colors, FieldType } from '@teable/core';
import type { IFieldInstance } from '@teable/sdk/model';
import { describe, expect, it } from 'vitest';
import {
  getChoiceRowTint,
  getFirstMatchedChoiceColor,
  getFirstMatchedRuleColor,
  getRowColorRuleFieldIds,
  matchesRowColorFilter,
} from './row-coloring';

describe('getChoiceRowTint', () => {
  it('normalizes different tones from the same hue to one row tint', () => {
    expect(getChoiceRowTint(Colors.RedLight2, '#FFFFFF', 'light')).toBe(
      getChoiceRowTint(Colors.RedDark1, '#FFFFFF', 'light')
    );
  });

  it('creates restrained light and dark theme tints', () => {
    expect(getChoiceRowTint(Colors.Blue, '#fff', 'light')).toBe('#E0EFFF');
    expect(getChoiceRowTint(Colors.Blue, '#121314', 'dark')).toBe('#0E2C4C');
  });

  it('returns undefined for an unknown color', () => {
    expect(getChoiceRowTint('unknown', '#FFFFFF', 'light')).toBeUndefined();
  });
});

describe('getFirstMatchedChoiceColor', () => {
  const choices = [
    { id: 'choOpen', name: 'Open', color: Colors.Green },
    { id: 'choBlocked', name: 'Blocked', color: Colors.Red },
  ];

  it('uses the first enabled value for a multiple select cell', () => {
    expect(getFirstMatchedChoiceColor(['Open', 'Blocked'], choices, ['choBlocked'])).toBe(
      Colors.Red
    );
  });

  it('colors all choices when enabledChoiceIds is omitted', () => {
    expect(getFirstMatchedChoiceColor('Open', choices)).toBe(Colors.Green);
  });

  it('does not color empty, unknown, or disabled values', () => {
    expect(getFirstMatchedChoiceColor(null, choices)).toBeUndefined();
    expect(getFirstMatchedChoiceColor('Unknown', choices)).toBeUndefined();
    expect(getFirstMatchedChoiceColor('Open', choices, [])).toBeUndefined();
  });
});

describe('conditional row coloring', () => {
  const fields = [
    {
      id: 'fldStatus',
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
      cellValue2String: (value: unknown) => String(value ?? ''),
    },
    {
      id: 'fldPriority',
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
      cellValue2String: (value: unknown) => String(value ?? ''),
    },
    {
      id: 'fldTags',
      type: FieldType.MultipleSelect,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
      cellValue2String: (value: unknown) => (Array.isArray(value) ? value.join(',') : ''),
    },
  ] as IFieldInstance[];

  const values = new Map<string, unknown>([
    ['fldStatus', 'Blocked'],
    ['fldPriority', 9],
    ['fldTags', ['Customer', 'Urgent']],
  ]);
  const getCellValue = (fieldId: string) => values.get(fieldId);

  it('supports nested conditions and field-specific operators', () => {
    expect(
      matchesRowColorFilter(
        {
          conjunction: 'and',
          filterSet: [
            { fieldId: 'fldStatus', operator: 'is', value: 'Blocked' },
            {
              conjunction: 'or',
              filterSet: [
                { fieldId: 'fldPriority', operator: 'isGreaterEqual', value: 8 },
                { fieldId: 'fldTags', operator: 'hasAnyOf', value: ['VIP'] },
              ],
            },
          ],
        },
        getCellValue,
        fields
      )
    ).toBe(true);
  });

  it('uses the first enabled matching rule', () => {
    const rules: IGridRowColorRule[] = [
      {
        id: 'disabled',
        enabled: false,
        color: Colors.OrangeBright,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldPriority', operator: 'isGreater', value: 5 }],
        },
      },
      {
        id: 'blocked',
        color: Colors.RedBright,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus', operator: 'is', value: 'Blocked' }],
        },
      },
      {
        id: 'urgent',
        color: Colors.YellowBright,
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldTags', operator: 'hasAnyOf', value: ['Urgent'] }],
        },
      },
    ];

    expect(getFirstMatchedRuleColor(rules, getCellValue, fields)).toBe(Colors.RedBright);
    expect([...getRowColorRuleFieldIds(rules)]).toEqual(['fldPriority', 'fldStatus', 'fldTags']);
  });

  it('does not match an incomplete rule', () => {
    expect(matchesRowColorFilter(null, getCellValue, fields)).toBe(false);
    expect(
      matchesRowColorFilter(
        { conjunction: 'and', filterSet: [{ conjunction: 'and', filterSet: [] }] },
        getCellValue,
        fields
      )
    ).toBe(false);
  });
});
