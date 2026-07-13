import type { IFieldVo, IRecord, ISelectFieldOptions } from '@teable/core';
import { CellValueType, Colors, DbFieldType, FieldType, Relationship } from '@teable/core';
import type * as OpenApi from '@teable/openapi';
import { updateRecord } from '@teable/openapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSelectChoice } from '../../utils/select-option';
import { createFieldInstance } from '../field/factory';
import type { SingleSelectField } from '../field/single-select.field';
import { createRecordInstance, recordInstanceFieldMap } from './factory';

vi.mock('@teable/openapi', async () => {
  const actual = await vi.importActual<typeof OpenApi>('@teable/openapi');
  return {
    ...actual,
    updateRecord: vi.fn(),
  };
});

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

const createNumberField = (): IFieldVo => ({
  id: 'fldTargetCount000001',
  name: 'Target Count',
  dbFieldName: 'Target_Count',
  type: FieldType.Number,
  options: {
    formatting: {
      type: 'decimal',
      precision: 2,
    },
  } as IFieldVo['options'],
  unique: false,
  cellValueType: CellValueType.Number,
  dbFieldType: DbFieldType.Real,
});

const createLinkField = (): IFieldVo => ({
  id: 'fldNameLink00000001',
  name: 'Name Link',
  dbFieldName: 'Name_Link',
  type: FieldType.Link,
  options: {
    relationship: Relationship.ManyOne,
    foreignTableId: 'tblSku000000000001',
    lookupFieldId: 'fldSkuName00000001',
    fkHostTableName: 'tblTarget00000001',
    selfKeyName: '__id',
    foreignKeyName: '__fk_fldNameLink00000001',
  },
  unique: false,
  isMultipleCellValue: false,
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

afterEach(() => {
  vi.mocked(updateRecord).mockReset();
});

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
    const field = createFieldInstance(
      createSelectField(FieldType.SingleSelect)
    ) as SingleSelectField;

    expect(field.displayChoiceMap.Open).toBeDefined();

    field.options.choices.push({
      id: 'optClosed00000001',
      name: 'Closed',
      color: Colors.GreenBright,
    });

    const record = recordInstanceFieldMap(createRecordInstance(createRecord('Closed')), {
      [field.id]: field,
    });

    expect(record.getCellValue(field.id)).toBe('Closed');
    expect(record.getCellValueAsString(field.id)).toBe('Closed');
    expect(field.displayChoiceMap.Closed).toBeDefined();
  });

  it('T6007 keeps displaying a newly added select choice before field ops land', () => {
    const field = createFieldInstance(
      createSelectField(FieldType.SingleSelect)
    ) as SingleSelectField;
    const record = recordInstanceFieldMap(createRecordInstance(createRecord('Closed')), {
      [field.id]: field,
    });

    // Without local options sync, validateCellValue rejects the unknown name.
    expect(record.getCellValue(field.id)).toBeNull();

    ensureSelectChoice(field.options as ISelectFieldOptions, 'Closed');

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

  it.each([null, { id: 'recSku000000000001' }])(
    'keeps resolved link titles when a v2 stored update response returns %s',
    async (storedLinkValue) => {
      const numberField = createFieldInstance(createNumberField());
      const linkField = createFieldInstance(createLinkField());
      const linkValue = {
        id: 'recSku000000000001',
        title: 'SKU Grade 4 A+',
      };
      const doc = {
        id: 'recTarget000000001',
        collection: 'rec_tblTarget00000001',
        version: 1,
        data: {
          id: 'recTarget000000001',
          fields: {
            [numberField.id]: 1,
            [linkField.id]: linkValue,
          },
        },
        emit: vi.fn(),
      };
      const sharedDoc = doc as unknown as NonNullable<Parameters<typeof createRecordInstance>[1]>;
      const record = recordInstanceFieldMap(createRecordInstance(doc.data as IRecord, sharedDoc), {
        [numberField.id]: numberField,
        [linkField.id]: linkField,
      });

      const response = {
        data: {
          id: doc.id,
          fields: {
            [numberField.id]: 9999,
            [linkField.id]: storedLinkValue,
          },
        },
      } as unknown as Awaited<ReturnType<typeof updateRecord>>;

      vi.mocked(updateRecord).mockResolvedValueOnce({
        ...response,
      });

      await record.updateCell(numberField.id, 9999);

      expect(doc.data.fields[linkField.id]).toEqual(linkValue);
      expect(record.fields[linkField.id]).toEqual(linkValue);
    }
  );

  it('T6007 does not bump ShareDB doc version during optimistic updateCell', async () => {
    const field = createFieldInstance(createSelectField(FieldType.SingleSelect));
    ensureSelectChoice(field.options as ISelectFieldOptions, '5555');
    const doc = {
      id: 'recStatus000000002',
      collection: 'rec_tblStatus00000001',
      version: 1,
      data: {
        id: 'recStatus000000002',
        fields: {
          [field.id]: null,
        },
      },
      emit: vi.fn(),
    };
    const sharedDoc = doc as unknown as NonNullable<Parameters<typeof createRecordInstance>[1]>;
    const record = recordInstanceFieldMap(createRecordInstance(doc.data as IRecord, sharedDoc), {
      [field.id]: field,
    });

    vi.mocked(updateRecord).mockResolvedValueOnce({
      data: {
        id: doc.id,
        fields: {
          [field.id]: '5555',
        },
      },
    } as never);

    await record.updateCell(field.id, '5555');

    expect(doc.version).toBe(1);
    expect(doc.data.fields[field.id]).toBe('5555');
    expect(record.getCellValue(field.id)).toBe('5555');
  });
});
