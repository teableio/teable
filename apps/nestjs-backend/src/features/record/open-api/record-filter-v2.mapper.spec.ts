import { CellValueType, FieldType, is } from '@teable/core';
import { normalizeLegacyRecordFilterForV2 } from './record-filter-v2.mapper';

describe('normalizeLegacyRecordFilterForV2', () => {
  const textFieldId = 'fldText';
  const checkboxFieldId = 'fldCheckbox';
  const userFieldId = 'fldUser';
  const dateFieldId = 'fldDate';
  const multiSelectFieldId = 'fldMultiSelect';
  const fields = new Map([
    [textFieldId, { type: FieldType.SingleLineText, cellValueType: CellValueType.String }],
    [checkboxFieldId, { type: FieldType.Checkbox, cellValueType: CellValueType.Boolean }],
    [userFieldId, { type: FieldType.User, cellValueType: CellValueType.String }],
    [
      multiSelectFieldId,
      {
        type: FieldType.MultipleSelect,
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        options: { choices: [{ id: 'choGO', name: 'go', color: 'blue' }] },
      },
    ],
    [
      dateFieldId,
      {
        type: FieldType.Date,
        cellValueType: CellValueType.DateTime,
        options: { formatting: { timeZone: 'Asia/Singapore' } },
      },
    ],
  ]);

  it('preserves v1 checkbox null semantics while dropping incomplete text filters', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: checkboxFieldId, operator: is.value, value: null },
          { fieldId: textFieldId, operator: is.value, value: null },
        ],
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [{ fieldId: checkboxFieldId, operator: 'is', value: false }],
    });
  });

  it('maps checkbox isNot+null (checked) to is+true', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [{ fieldId: checkboxFieldId, operator: 'isNot', value: null }],
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [{ fieldId: checkboxFieldId, operator: 'is', value: true }],
    });
  });

  it('maps symbol operators and normalizes scalar values for list operators', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: textFieldId, operator: '!=', value: 'Alpha', isSymbol: true },
          { fieldId: textFieldId, operator: 'isAnyOf', value: 'Beta' },
        ],
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: textFieldId, operator: 'isNot', value: 'Alpha' },
        { fieldId: textFieldId, operator: 'isAnyOf', value: ['Beta'] },
      ],
    });
  });

  it('replaces Me only for user-like Fields', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: userFieldId, operator: 'hasAnyOf', value: ['Me', 'usrOther'] },
          { fieldId: textFieldId, operator: 'is', value: 'Me' },
        ],
      },
      fields,
      'usrCurrent'
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        {
          fieldId: userFieldId,
          operator: 'hasAnyOf',
          value: ['usrCurrent', 'usrOther'],
        },
        { fieldId: textFieldId, operator: 'is', value: 'Me' },
      ],
    });
  });

  it('converts exact date comparisons with the aggregate Field timezone', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        fieldId: dateFieldId,
        operator: 'isOnOrAfter',
        value: '2026-07-30T01:00:00.000Z',
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      fieldId: dateFieldId,
      operator: 'isOnOrAfter',
      value: {
        mode: 'exactDate',
        exactDate: '2026-07-30T01:00:00.000Z',
        timeZone: 'Asia/Singapore',
      },
    });
  });

  it('preserves both timestamp bounds for field-aware date range evaluation', () => {
    const valid = normalizeLegacyRecordFilterForV2(
      {
        fieldId: dateFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2026-07-01T09:30:00.000Z',
          exactDateEnd: '2026-07-01T12:45:00.000Z',
          timeZone: 'utc',
        },
      },
      fields
    );
    const reversed = normalizeLegacyRecordFilterForV2(
      {
        fieldId: dateFieldId,
        operator: 'is',
        value: {
          mode: 'dateRange',
          exactDate: '2026-07-31T00:00:00.000Z',
          exactDateEnd: '2026-07-01T00:00:00.000Z',
          timeZone: 'utc',
        },
      },
      fields
    );
    const unsupported = normalizeLegacyRecordFilterForV2(
      {
        fieldId: dateFieldId,
        operator: 'isNot',
        value: {
          mode: 'dateRange',
          exactDate: '2026-07-01T00:00:00.000Z',
          exactDateEnd: '2026-07-31T00:00:00.000Z',
          timeZone: 'utc',
        },
      },
      fields
    );

    expect(valid._unsafeUnwrap()).toMatchObject({
      fieldId: dateFieldId,
      operator: 'is',
      value: {
        mode: 'dateRange',
        exactDate: '2026-07-01T09:30:00.000Z',
        exactDateEnd: '2026-07-01T12:45:00.000Z',
        timeZone: 'utc',
      },
    });
    // v1 parity: invalid combinations are not errors — they pass through and
    // the v2 condition visitor compiles them to no-op TRUE fragments.
    expect(reversed._unsafeUnwrap()).toMatchObject({
      fieldId: dateFieldId,
      operator: 'is',
      value: { mode: 'dateRange' },
    });
    expect(unsupported._unsafeUnwrap()).toMatchObject({
      fieldId: dateFieldId,
      operator: 'isNot',
      value: { mode: 'dateRange' },
    });
  });

  it('maps empty-string date comparisons to empty checks instead of timestamp literals', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: dateFieldId, operator: 'isNot', value: '' },
          { fieldId: dateFieldId, operator: 'is', value: '' },
        ],
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: dateFieldId, operator: 'isNotEmpty', value: null },
        { fieldId: dateFieldId, operator: 'isEmpty', value: null },
      ],
    });
  });

  it('converts symbol operators by field type like v1', () => {
    const result = normalizeLegacyRecordFilterForV2(
      {
        conjunction: 'and',
        filterSet: [
          { fieldId: multiSelectFieldId, operator: 'IN', value: ['go'], isSymbol: true },
          { fieldId: multiSelectFieldId, operator: '=', value: ['go'], isSymbol: true },
          {
            fieldId: dateFieldId,
            operator: '>',
            value: '2026-07-30T01:00:00.000Z',
            isSymbol: true,
          },
        ],
      },
      fields
    );

    expect(result._unsafeUnwrap()).toEqual({
      conjunction: 'and',
      items: [
        { fieldId: multiSelectFieldId, operator: 'hasAnyOf', value: ['go'] },
        { fieldId: multiSelectFieldId, operator: 'isExactly', value: ['go'] },
        {
          fieldId: dateFieldId,
          operator: 'isAfter',
          value: {
            mode: 'exactDate',
            exactDate: '2026-07-30T01:00:00.000Z',
            timeZone: 'Asia/Singapore',
          },
        },
      ],
    });
  });

  it('fails loudly when a symbol operator cannot be mapped for an unknown field', () => {
    const result = normalizeLegacyRecordFilterForV2(
      { fieldId: 'fldMissing', operator: 'IN', value: ['go'], isSymbol: true },
      fields
    );

    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("Cannot convert symbol filter operator 'IN'");
    expect(error.details).toMatchObject({ fieldId: 'fldMissing', operator: 'IN' });
  });

  it('fails loudly when the field type does not support the symbol operator', () => {
    const result = normalizeLegacyRecordFilterForV2(
      { fieldId: checkboxFieldId, operator: 'IN', value: ['true'], isSymbol: true },
      fields
    );

    const error = result._unsafeUnwrapErr();
    expect(error.message).toContain("Filter operator 'IN' is not supported by field type");
    expect(error.details).toMatchObject({
      fieldId: checkboxFieldId,
      fieldType: FieldType.Checkbox,
    });
  });
});
