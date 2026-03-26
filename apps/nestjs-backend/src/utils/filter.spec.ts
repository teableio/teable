import { CellValueType, FieldType, isNot, isNotExactly } from '@teable/core';
import type { IFieldInstance } from '../features/field/model/factory';
import { generateFilterItem } from './filter';

const createField = (partial: Partial<IFieldInstance>): IFieldInstance =>
  ({
    id: 'fld_test',
    type: FieldType.SingleSelect,
    cellValueType: CellValueType.String,
    isMultipleCellValue: false,
    ...partial,
  }) as IFieldInstance;

describe('generateFilterItem', () => {
  const testValue = 'Supplier A';

  it('uses isNotExactly for multi-value singleSelect fields', () => {
    const field = createField({
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
      isMultipleCellValue: true,
    });

    const result = generateFilterItem(field, [testValue]);

    expect(result.operator).toBe(isNotExactly.value);
    expect(result.value).toEqual([testValue]);
  });

  it('keeps isNot for single-value singleSelect fields', () => {
    const field = createField({
      type: FieldType.SingleSelect,
      cellValueType: CellValueType.String,
      isMultipleCellValue: false,
    });

    const result = generateFilterItem(field, testValue);

    expect(result.operator).toBe(isNot.value);
    expect(result.value).toBe(testValue);
  });
});
