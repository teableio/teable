import type { IFieldVo, IRecord } from '@teable/core';
import { CellValueType, DbFieldType, FieldType } from '@teable/core';
import { describe, expect, it } from 'vitest';
import { createFieldInstance } from '../field/factory';
import { createRecordInstance, recordInstanceFieldMap } from './factory';

const createSelectField = (type: FieldType.SingleSelect | FieldType.MultipleSelect): IFieldVo => ({
  id: 'fldStatus0000000001',
  name: 'Status',
  dbFieldName: 'Status',
  type,
  options: {
    choices: [{ id: 'optOpen000000001', name: 'Open', color: 'blueBright' }],
  },
  unique: false,
  cellValueType: CellValueType.String,
  isMultipleCellValue: type === FieldType.MultipleSelect,
  dbFieldType: type === FieldType.MultipleSelect ? DbFieldType.Json : DbFieldType.Text,
});

const createTextField = (
  overrides: Partial<Pick<IFieldVo, 'id' | 'name' | 'dbFieldName' | 'isPrimary'>> = {}
): IFieldVo => ({
  id: overrides.id ?? 'fldPrimary000000001',
  name: overrides.name ?? 'Name',
  dbFieldName: overrides.dbFieldName ?? 'Name',
  type: FieldType.SingleLineText,
  options: {},
  unique: false,
  isPrimary: overrides.isPrimary ?? true,
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Text,
});

const createRecord = (value: unknown) =>
  ({
    id: 'recStatus000000001',
    fields: {
      fldStatus0000000001: value,
    },
  }) as IRecord;

describe('sdk Record cell value normalization', () => {
  it('repairs stale single-select string values for multipleSelect fields', () => {
    const field = createFieldInstance(createSelectField(FieldType.MultipleSelect));
    const record = recordInstanceFieldMap(createRecordInstance(createRecord('Open')), {
      [field.id]: field,
    });

    expect(record.getCellValue(field.id)).toEqual(['Open']);
    expect(record.getCellValueAsString(field.id)).toBe('Open');
    expect(record.fields[field.id]).toBe('Open');
  });

  it('repairs stale multipleSelect array values for singleSelect fields', () => {
    const field = createFieldInstance(createSelectField(FieldType.SingleSelect));
    const record = recordInstanceFieldMap(createRecordInstance(createRecord(['Open'])), {
      [field.id]: field,
    });

    expect(record.getCellValue(field.id)).toBe('Open');
    expect(record.getCellValueAsString(field.id)).toBe('Open');
    expect(record.fields[field.id]).toEqual(['Open']);
  });

  it('keeps already-valid multipleSelect arrays unchanged', () => {
    const field = createFieldInstance(createSelectField(FieldType.MultipleSelect));
    const record = recordInstanceFieldMap(createRecordInstance(createRecord(['Open'])), {
      [field.id]: field,
    });

    expect(record.getCellValue(field.id)).toEqual(['Open']);
  });

  it('keeps displaying select values when realtime mutates field options', () => {
    const field = createFieldInstance(createSelectField(FieldType.SingleSelect));

    expect(field.displayChoiceMap.Open).toBeDefined();

    field.options.choices.push({
      id: 'optClosed00000001',
      name: 'Closed',
      color: 'greenBright',
    });

    const record = recordInstanceFieldMap(createRecordInstance(createRecord('Closed')), {
      [field.id]: field,
    });

    expect(record.getCellValue(field.id)).toBe('Closed');
    expect(record.getCellValueAsString(field.id)).toBe('Closed');
    expect(field.displayChoiceMap.Closed).toBeDefined();
  });

  it('keeps displaying the value when the same record instance is rebound from singleSelect to text', () => {
    const singleSelectField = createFieldInstance(createSelectField(FieldType.SingleSelect));
    const textField = createFieldInstance(
      createTextField({
        id: singleSelectField.id,
        name: singleSelectField.name,
        dbFieldName: singleSelectField.dbFieldName,
        isPrimary: false,
      })
    );
    const record = createRecordInstance(createRecord('Open'));

    recordInstanceFieldMap(record, { [singleSelectField.id]: singleSelectField });

    expect(record.getCellValue(singleSelectField.id)).toBe('Open');
    expect(record.getCellValueAsString(singleSelectField.id)).toBe('Open');

    recordInstanceFieldMap(record, { [textField.id]: textField });

    expect(record.getCellValue(textField.id)).toBe('Open');
    expect(record.getCellValueAsString(textField.id)).toBe('Open');
  });

  it('keeps displaying the value when the same record instance is rebound from multipleSelect to text', () => {
    const multipleSelectField = createFieldInstance(createSelectField(FieldType.MultipleSelect));
    const textField = createFieldInstance(
      createTextField({
        id: multipleSelectField.id,
        name: multipleSelectField.name,
        dbFieldName: multipleSelectField.dbFieldName,
        isPrimary: false,
      })
    );
    const record = createRecordInstance(createRecord(['Open']));

    recordInstanceFieldMap(record, { [multipleSelectField.id]: multipleSelectField });

    expect(record.getCellValue(multipleSelectField.id)).toEqual(['Open']);
    expect(record.getCellValueAsString(multipleSelectField.id)).toBe('Open');

    recordInstanceFieldMap(record, { [textField.id]: textField });

    expect(record.getCellValue(textField.id)).toBe('Open');
    expect(record.getCellValueAsString(textField.id)).toBe('Open');
  });

  it('keeps undefined singleLineText values empty instead of repairing to literal text', () => {
    const field = createFieldInstance(createTextField());
    const record = recordInstanceFieldMap(
      createRecordInstance({
        id: 'recPrimary00000001',
        fields: {
          [field.id]: undefined,
        },
      } as IRecord),
      {
        [field.id]: field,
      }
    );

    expect(record.getCellValue(field.id)).toBeUndefined();
    expect(record.getCellValueAsString(field.id)).toBe('');
    expect(record.title).toBe('');
  });

  it('keeps null singleLineText values clear', () => {
    const field = createFieldInstance(createTextField());
    const record = recordInstanceFieldMap(
      createRecordInstance({
        id: 'recPrimary00000002',
        fields: {
          [field.id]: null,
        },
      } as IRecord),
      {
        [field.id]: field,
      }
    );

    expect(record.getCellValue(field.id)).toBeNull();
    expect(record.getCellValueAsString(field.id)).toBe('');
    expect(record.title).toBe('');
  });
});
