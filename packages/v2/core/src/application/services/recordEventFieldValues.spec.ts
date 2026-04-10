import { describe, expect, it } from 'vitest';

import { mergeRecordFieldValues } from './recordEventFieldValues';

describe('mergeRecordFieldValues', () => {
  it('returns the original field values when there are no changed fields', () => {
    const fieldValues = [
      { fieldId: 'fldA', value: 'Alpha' },
      { fieldId: 'fldB', value: 1 },
    ];

    expect(mergeRecordFieldValues(fieldValues)).toBe(fieldValues);
    expect(mergeRecordFieldValues(fieldValues, new Map())).toBe(fieldValues);
  });

  it('overrides changed fields and appends newly returned ones', () => {
    const fieldValues = [
      { fieldId: 'fldA', value: 'Alpha' },
      { fieldId: 'fldB', value: 1 },
    ];

    const merged = mergeRecordFieldValues(
      fieldValues,
      new Map<string, unknown>([
        ['fldB', 2],
        ['fldC', true],
      ])
    );

    expect(merged).toEqual([
      { fieldId: 'fldA', value: 'Alpha' },
      { fieldId: 'fldB', value: 2 },
      { fieldId: 'fldC', value: true },
    ]);
  });
});
