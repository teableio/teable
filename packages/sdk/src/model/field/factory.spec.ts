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

describe('createFieldInstance lookup normalization', () => {
  it('normalizes v2 conditionalLookup payload shape', () => {
    const field = {
      ...createBaseField(),
      type: 'conditionalLookup',
      options: {
        foreignTableId: 'tblForeign00000001',
        lookupFieldId: 'fldLookup000000001',
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
      foreignTableId: 'tblForeign00000001',
      lookupFieldId: 'fldLookup000000001',
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
        linkFieldId: 'fldLink000000000001',
        lookupFieldId: 'fldLookup000000001',
        foreignTableId: 'tblForeign00000001',
      },
    } as unknown as IFieldVo;

    const instance = createFieldInstance(field);

    expect(instance.type).toBe(FieldType.Number);
    expect(instance.isLookup).toBe(true);
    expect(instance.isConditionalLookup).toBeUndefined();
    expect(instance.lookupOptions).toMatchObject({
      linkFieldId: 'fldLink000000000001',
      lookupFieldId: 'fldLookup000000001',
      foreignTableId: 'tblForeign00000001',
    });
  });
});
