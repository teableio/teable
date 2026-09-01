import type { IFieldVo } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { createFieldInstance } from '../model/field/factory';
import { normalizeCellValueForDisplay } from './normalize-cell-value';

const createSelectField = (type: FieldType.SingleSelect | FieldType.MultipleSelect): IFieldVo => ({
  id: 'fldSpecies00000001',
  name: 'Species',
  dbFieldName: 'Species',
  type,
  options: {
    choices: [
      { id: 'choCat0000000001', name: '猫', color: 'orangeBright' },
      { id: 'choDog0000000001', name: '狗', color: 'yellowBright' },
      { id: 'choHorse00000001', name: '马', color: 'redBright' },
    ],
  },
  unique: false,
  cellValueType: CellValueType.String,
  isMultipleCellValue: type === FieldType.MultipleSelect,
  dbFieldType: type === FieldType.MultipleSelect ? DbFieldType.Json : DbFieldType.Text,
});

describe('normalizeCellValueForDisplay T6459', () => {
  it('proves the old grid validate-only path blanks transitional select values', () => {
    const field = createFieldInstance(createSelectField(FieldType.MultipleSelect));
    const staleCellValue = '马';

    // Previous use-grid-columns path: validate only → undefined → blank cell.
    const validateOnly = field.validateCellValue(staleCellValue);
    const blanked = validateOnly.success ? validateOnly.data : undefined;
    expect(blanked).toBeUndefined();

    // Fixed path keeps the value visible.
    expect(normalizeCellValueForDisplay(field, staleCellValue)).toEqual(['马']);
  });

  it('keeps singleSelect string values visible after convert to multipleSelect', () => {
    const field = createFieldInstance(createSelectField(FieldType.MultipleSelect));

    expect(normalizeCellValueForDisplay(field, '马')).toEqual(['马']);
    expect(normalizeCellValueForDisplay(field, '猫')).toEqual(['猫']);
  });

  it('keeps multipleSelect array values visible after convert to singleSelect', () => {
    const field = createFieldInstance(createSelectField(FieldType.SingleSelect));

    expect(normalizeCellValueForDisplay(field, ['狗'])).toBe('狗');
    expect(normalizeCellValueForDisplay(field, ['马', '猫'])).toBe('马');
  });

  it('does not blank valid values of either shape', () => {
    const single = createFieldInstance(createSelectField(FieldType.SingleSelect));
    const multiple = createFieldInstance(createSelectField(FieldType.MultipleSelect));

    expect(normalizeCellValueForDisplay(single, '猫')).toBe('猫');
    expect(normalizeCellValueForDisplay(multiple, ['猫', '狗'])).toEqual(['猫', '狗']);
  });

  it('returns nullish values unchanged', () => {
    const field = createFieldInstance(createSelectField(FieldType.MultipleSelect));

    expect(normalizeCellValueForDisplay(field, null)).toBeNull();
    expect(normalizeCellValueForDisplay(field, undefined)).toBeUndefined();
  });
});
