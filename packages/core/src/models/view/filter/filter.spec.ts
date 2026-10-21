import { CellValueType, FieldType } from '../../field/constant';
import type { IFilter } from './filter';
import {
  analyzeFilterValidationIssues,
  filterSchema,
  stripFilterByReadableFieldIds,
  stripInProgressFilterItems,
} from './filter';

describe('Filter Parse', () => {
  it('should parse single filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'contains',
          value: '1',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a nested filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          filterSet: [
            {
              fieldId: 'fldbbM45OO5VOWuce4r',
              operator: 'contains',
              value: '2',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'or',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a multi nested filter', async () => {
    const data: IFilter = {
      filterSet: [
        {
          filterSet: [
            {
              filterSet: [
                {
                  fieldId: 'fldbbM45OO5VOWuce4r',
                  operator: 'contains',
                  value: '2',
                },
              ],
              conjunction: 'and',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should parse a mix filter', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'contains',
          value: '1',
        },
        {
          filterSet: [
            {
              fieldId: 'fldbbM45OO5VOWuce4r',
              operator: 'contains',
              value: '2',
            },
          ],
          conjunction: 'or',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual(data);
  });

  it('should normalize unary filter items without explicit value to null', async () => {
    const data = {
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'isNotEmpty',
        },
      ],
      conjunction: 'and',
    };

    const parse = filterSchema.parse(data);
    expect(parse).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldbbM45OO5VOWuce4r',
          operator: 'isNotEmpty',
          value: null,
        },
      ],
    });
  });
});

describe('analyzeFilterValidationIssues', () => {
  const dateFieldId = 'fldDate0000000000';
  const dateReferenceFieldId = 'fldDateRef0000000';
  const numberFieldId = 'fldNumber00000000';

  const fieldMetaMap = {
    [dateFieldId]: {
      type: FieldType.Date,
      cellValueType: CellValueType.DateTime,
    },
    [dateReferenceFieldId]: {
      type: FieldType.Date,
      cellValueType: CellValueType.DateTime,
    },
    [numberFieldId]: {
      type: FieldType.Number,
      cellValueType: CellValueType.Number,
    },
  };

  it('reports invalid operator for the field type', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberFieldId,
          operator: 'contains',
          value: 'abc',
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'OPERATOR_NOT_ALLOWED',
      fieldId: numberFieldId,
      operator: 'contains',
      path: [0],
    });
  });

  it('reports nested path for invalid sub-operator mode', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberFieldId,
          operator: 'is',
          value: 1,
        },
        {
          conjunction: 'or',
          filterSet: [
            {
              fieldId: dateFieldId,
              operator: 'isWithIn',
              value: { mode: 'notAMode', exactDate: null, timeZone: 'UTC' } as never,
            },
          ],
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'MODE_NOT_ALLOWED',
      fieldId: dateFieldId,
      mode: 'notAMode',
      path: [1, 0],
    });
  });

  it('reports shape mismatch when isWithIn value is a primitive', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'isWithIn',
          value: 'today' as never,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'VALUE_SHAPE_INVALID',
      fieldId: dateFieldId,
      operator: 'isWithIn',
      path: [0],
    });
    expect(errors[0].message).toContain('Valid modes:');
    expect(errors[0].message).toContain('pastWeek');
  });

  it('reports shape mismatch when isBefore value is a plain date string', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'isBefore',
          value: '2026-04-27T00:00:00.000Z' as never,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'VALUE_SHAPE_INVALID',
      fieldId: dateFieldId,
      operator: 'isBefore',
      path: [0],
    });
    expect(errors[0].message).toContain('Valid modes:');
    expect(errors[0].message).toContain('today');
  });

  it('reports invalid mode when value is an object with unknown mode', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'isWithIn',
          value: { mode: 'notAMode', exactDate: null, timeZone: 'UTC' } as never,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'MODE_NOT_ALLOWED',
      fieldId: dateFieldId,
      mode: 'notAMode',
      path: [0],
    });
  });

  it('treats null value as in-progress, not an error', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'isWithIn',
          value: null,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toEqual([]);
  });

  it('allows date field reference comparisons without requiring mode', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'is',
          value: {
            type: 'field',
            fieldId: dateReferenceFieldId,
          },
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toEqual([]);
  });

  it('reports date field reference arrays as invalid date value shape', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: dateFieldId,
          operator: 'is',
          value: [
            {
              type: 'field',
              fieldId: dateReferenceFieldId,
            },
          ] as never,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'VALUE_SHAPE_INVALID',
      fieldId: dateFieldId,
      operator: 'is',
      path: [0],
    });
  });

  it('treats symbol operator as compatible when mapping exists', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: numberFieldId,
          isSymbol: true,
          operator: '=',
          value: 3,
        },
      ],
    };

    const errors = analyzeFilterValidationIssues(filter, fieldMetaMap);
    expect(errors).toEqual([]);
  });
});

describe('stripFilterByReadableFieldIds', () => {
  const readable = new Set(['fldA', 'fldB']);

  it('passes the filter through when the readable set is undefined', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldC', operator: 'is', value: 'x' }],
    };

    expect(stripFilterByReadableFieldIds(filter, undefined)).toBe(filter);
  });

  it('drops conditions on unreadable fields and prunes emptied groups', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldA', operator: 'is', value: 'x' },
        {
          conjunction: 'or',
          filterSet: [
            { fieldId: 'fldC', operator: 'is', value: 'y' },
            {
              conjunction: 'and',
              filterSet: [{ fieldId: 'fldC', operator: 'is', value: 'z' }],
            },
          ],
        },
        { fieldId: 'fldB', operator: 'is', value: 'w' },
      ],
    };

    expect(stripFilterByReadableFieldIds(filter, readable)).toEqual({
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldA', operator: 'is', value: 'x' },
        { fieldId: 'fldB', operator: 'is', value: 'w' },
      ],
    });
  });

  it('drops conditions whose value references an unreadable field', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldA',
          operator: 'is',
          value: { type: 'field', fieldId: 'fldC' },
        },
        {
          fieldId: 'fldA',
          operator: 'is',
          value: { type: 'field', fieldId: 'fldB' },
        },
      ],
    };

    expect(stripFilterByReadableFieldIds(filter, readable)).toEqual({
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldA',
          operator: 'is',
          value: { type: 'field', fieldId: 'fldB' },
        },
      ],
    });
  });

  it('returns undefined when every condition is stripped', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldC', operator: 'is', value: 'x' }],
    };

    expect(stripFilterByReadableFieldIds(filter, readable)).toBeUndefined();
  });
});

describe('stripInProgressFilterItems', () => {
  const textMeta = { cellValueType: CellValueType.String };
  const boolMeta = { cellValueType: CellValueType.Boolean };
  const fieldMetaMap = {
    fldText: textMeta,
    fldCheck: boolMeta,
  };

  it('drops conditions with a missing value', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldText', operator: 'is', value: null },
        { fieldId: 'fldText', operator: 'contains', value: 'x' },
      ],
    };

    expect(stripInProgressFilterItems(filter, fieldMetaMap)).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldText', operator: 'contains', value: 'x' }],
    });
  });

  it('returns undefined when every condition is in-progress', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldText', operator: 'is', value: null }],
    };

    expect(stripInProgressFilterItems(filter, fieldMetaMap)).toBeUndefined();
  });

  it('keeps value-less operators and boolean cell null values', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        { fieldId: 'fldText', operator: 'isEmpty', value: null },
        { fieldId: 'fldCheck', operator: 'is', value: null },
      ],
    };

    expect(stripInProgressFilterItems(filter, fieldMetaMap)).toEqual(filter);
  });

  it('strips in-progress conditions inside nested sets and drops empty sets', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [
        {
          conjunction: 'or',
          filterSet: [
            { fieldId: 'fldText', operator: 'is', value: null },
            { fieldId: 'fldText', operator: 'isNot', value: null },
          ],
        } as NonNullable<IFilter>,
        { fieldId: 'fldText', operator: 'contains', value: 'x' },
      ],
    };

    expect(stripInProgressFilterItems(filter, fieldMetaMap)).toEqual({
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldText', operator: 'contains', value: 'x' }],
    });
  });

  it('keeps conditions for fields missing from the meta map', () => {
    const filter: IFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId: 'fldUnknown', operator: 'is', value: null }],
    };

    expect(stripInProgressFilterItems(filter, fieldMetaMap)).toEqual(filter);
  });
});
