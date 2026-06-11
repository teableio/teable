import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { createFieldInstance } from './factory';

const createBaseField = (): IFieldVo => ({
  id: 'fldLookupFactory0001',
  name: 'Lookup Field',
  dbFieldName: 'lookup_field',
  type: FieldType.SingleLineText,
  options: {},
  unique: false,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
});

const foreignTableId = 'tblForeign00000001';
const lookupFieldId = 'fldLookup000000001';
const linkFieldId = 'fldLink000000000001';
const sumExpression = 'sum({values})';

describe('createFieldInstance lookup normalization', () => {
  it('normalizes v2 conditionalLookup payload shape', () => {
    const field = {
      ...createBaseField(),
      type: 'conditionalLookup',
      options: {
        foreignTableId,
        lookupFieldId,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'asc' },
          limit: 5,
        },
        innerType: FieldType.Formula,
        innerOptions: {
          expression: 'NOW()',
        },
      },
    } as unknown as IFieldVo;

    const instance = createFieldInstance(field);

    expect(instance.type).toBe(FieldType.Formula);
    expect(instance.isLookup).toBe(true);
    expect(instance.isConditionalLookup).toBe(true);
    expect(instance.lookupOptions).toMatchObject({
      foreignTableId,
      lookupFieldId,
      sort: { fieldId: 'fldScore0000000001', order: 'asc' },
      limit: 5,
    });
    expect((instance.options as { expression?: string }).expression).toBe('NOW()');
  });

  it('normalizes v2 lookup payload with fallback inner type', () => {
    const field = {
      ...createBaseField(),
      type: 'lookup',
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
      options: {
        linkFieldId,
        lookupFieldId,
        foreignTableId,
      },
    } as unknown as IFieldVo;

    const instance = createFieldInstance(field);

    expect(instance.type).toBe(FieldType.Number);
    expect(instance.isLookup).toBe(true);
    expect(instance.isConditionalLookup).toBeUndefined();
    expect(instance.lookupOptions).toMatchObject({
      linkFieldId,
      lookupFieldId,
      foreignTableId,
    });
  });

  it('normalizes v2 rollup payload shape', () => {
    const field = {
      ...createBaseField(),
      type: FieldType.Rollup,
      options: {
        expression: sumExpression,
        formatting: {
          type: 'decimal',
          precision: 2,
        },
      },
      config: {
        linkFieldId,
        foreignTableId,
        lookupFieldId,
      },
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    } as unknown as IFieldVo;

    const instance = createFieldInstance(field);

    expect(instance.type).toBe(FieldType.Rollup);
    expect((instance.options as { expression?: string }).expression).toBe(sumExpression);
    expect(instance.lookupOptions).toMatchObject({
      linkFieldId,
      foreignTableId,
      lookupFieldId,
    });
  });

  it('normalizes v2 conditionalRollup payload shape', () => {
    const field = {
      ...createBaseField(),
      type: FieldType.ConditionalRollup,
      options: {
        expression: sumExpression,
        formatting: {
          type: 'decimal',
          precision: 2,
        },
      },
      config: {
        foreignTableId,
        lookupFieldId,
        condition: {
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldStatus000000001', operator: 'is', value: 'Active' }],
          },
          sort: { fieldId: 'fldScore0000000001', order: 'desc' },
          limit: 10,
        },
      },
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    } as unknown as IFieldVo;

    const instance = createFieldInstance(field);

    expect(instance.type).toBe(FieldType.ConditionalRollup);
    expect(instance.options).toMatchObject({
      expression: sumExpression,
      foreignTableId,
      lookupFieldId,
      sort: { fieldId: 'fldScore0000000001', order: 'desc' },
      limit: 10,
    });
    expect(
      (instance.options as { filter?: { filterSet?: unknown[] } }).filter?.filterSet
    ).toHaveLength(1);
  });
});
