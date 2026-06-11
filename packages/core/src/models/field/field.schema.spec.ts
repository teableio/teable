import type { IFilter } from '../view/filter';
import { Colors } from './colors';
import { CellValueType, DbFieldType, FieldType, Relationship } from './constant';
import { RollupFieldCore, SingleLineTextFieldCore } from './derivate';
import { unionFieldOptionsRoSchema } from './field-unions.schema';
import type { IFieldRo } from './field.schema';
import { createFieldRoSchema, fieldVoSchema } from './field.schema';
import { NumberFormattingType } from './formatting';
import type { ILookupConditionalOptions } from './lookup-options-base.schema';
import type { IUnionShowAs } from './show-as';
import { SingleNumberDisplayType } from './show-as';

describe('field Schema Test', () => {
  it('should return true when options validate', () => {
    const options = {
      expression: '1 + 1',
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
      timeZone: 'Asia/Shanghai',
    };

    const result = unionFieldOptionsRoSchema.safeParse(options);
    expect(result.success).toBe(true);
    result.success && expect(result.data).toEqual(options);
  });

  it('should return true when options and type match', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return true when isLookup with lookupOptions', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return false when isLookup without lookupOptions', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return false when lookupOptions without isLookup', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return true when lookupOptions without isLookup in rollup field', () => {
    const fieldRo = {
      type: FieldType.Rollup,
      options: RollupFieldCore.defaultOptions(CellValueType.String),
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return true when isLookup field with formatting or showAs options', () => {
    const fieldRo = {
      type: FieldType.Rollup,
      options: {
        formatting: {
          type: NumberFormattingType.Decimal,
          precision: 2,
        },
        showAs: {
          type: SingleNumberDisplayType.Ring,
          color: Colors.Blue,
          showValue: true,
          maxValue: 100,
        } as IUnionShowAs,
      },
      lookupOptions: {
        foreignTableId: 'tableId',
        lookupFieldId: 'fieldId',
        linkFieldId: 'fieldId',
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);

    const lookUpFieldRo = {
      isLookup: true,
      ...fieldRo,
    };

    const result2 = createFieldRoSchema.safeParse(lookUpFieldRo);
    expect(result2.success).toBe(true);
  });

  it('should return false when conditional lookup missing filter', () => {
    const fieldRo = {
      type: FieldType.SingleLineText,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeign',
      } as ILookupConditionalOptions,
    } satisfies IFieldRo;

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should return true when conditional lookup has filter', () => {
    const filter = {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: 'fldFilter',
          operator: 'is',
          value: 'foo',
        },
      ],
    } as IFilter;

    const fieldRo: IFieldRo = {
      type: FieldType.SingleLineText,
      isLookup: true,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeign',
        filter,
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should allow omitted options for simple text field', () => {
    const fieldRo: IFieldRo = {
      type: FieldType.SingleLineText,
      name: 'Title',
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(true);
  });

  it('should return false when isConditionalLookup true without isLookup flag', () => {
    const fieldRo: IFieldRo = {
      type: FieldType.SingleLineText,
      isConditionalLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeign',
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: 'fldFilter',
              operator: 'is',
              value: 'foo',
            },
          ],
        } as IFilter,
      },
    };

    const result = createFieldRoSchema.safeParse(fieldRo);
    expect(result.success).toBe(false);
  });

  it('should normalize realtime-cleared optional field shape props from null to undefined', () => {
    const fieldVo = {
      id: 'fldRealtimeLink',
      name: 'Link Field',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyOne,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldLookup',
      },
      description: null,
      meta: null,
      isLookup: null,
      isConditionalLookup: null,
      lookupOptions: null,
      isComputed: null,
      isMultipleCellValue: null,
      recordRead: null,
      recordCreate: null,
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      dbFieldName: 'Link_Field',
    };

    const result = fieldVoSchema.safeParse(fieldVo);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.description).toBeUndefined();
    expect(result.data.meta).toBeUndefined();
    expect(result.data.isLookup).toBeUndefined();
    expect(result.data.isConditionalLookup).toBeUndefined();
    expect(result.data.lookupOptions).toBeUndefined();
    expect(result.data.isComputed).toBeUndefined();
    expect(result.data.isMultipleCellValue).toBeUndefined();
    expect(result.data.recordRead).toBeUndefined();
    expect(result.data.recordCreate).toBeUndefined();
  });

  it('should parse lookup field VO with link display config in lookupOptions', () => {
    const fieldVo = {
      id: 'fldLookupDisplayCfg',
      name: 'Lookup Field',
      type: FieldType.SingleLineText,
      options: SingleLineTextFieldCore.defaultOptions(),
      isLookup: true,
      lookupOptions: {
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeign',
        linkFieldId: 'fldLink',
        relationship: Relationship.ManyOne,
        fkHostTableName: 'table_foreign',
        selfKeyName: 'self_id',
        foreignKeyName: 'foreign_id',
        filterByViewId: 'viwForeign',
        visibleFieldIds: ['fldForeign', 'fldAnother'],
      },
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
      dbFieldName: 'lookup_field',
    };

    const result = fieldVoSchema.safeParse(fieldVo);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.lookupOptions).toMatchObject({
      filterByViewId: 'viwForeign',
      visibleFieldIds: ['fldForeign', 'fldAnother'],
    });
  });

  it('should parse persisted lookup formula field VO with extended link metadata', () => {
    const fieldVo = {
      id: 'fldLookupFormulaCfg',
      name: '正式坐席数量',
      type: FieldType.Formula,
      options: {
        expression: '1',
        timeZone: 'Asia/Shanghai',
        formatting: {
          type: 'decimal',
          precision: 0,
        },
      },
      isLookup: true,
      lookupOptions: {
        baseId: 'bseForeign',
        relationship: Relationship.OneMany,
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldForeign',
        fkHostTableName: 'bseForeign.table_foreign',
        selfKeyName: '__fk_lookup',
        foreignKeyName: '__id',
        filterByViewId: 'viwForeign',
        isOneWay: false,
        symmetricFieldId: 'fldSymmetric',
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: 'fldStatus', operator: 'is', value: '有效' }],
        },
        linkFieldId: 'fldLink',
      },
      unique: false,
      isComputed: true,
      cellValueType: CellValueType.Number,
      isMultipleCellValue: true,
      dbFieldType: DbFieldType.Json,
      dbFieldName: 'lookup_formula',
      recordRead: false,
      recordCreate: false,
    };

    const result = fieldVoSchema.safeParse(fieldVo);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.isLookup).toBe(true);
    expect(result.data.type).toBe(FieldType.Formula);
    expect(result.data.lookupOptions).toMatchObject({
      isOneWay: false,
      symmetricFieldId: 'fldSymmetric',
      linkFieldId: 'fldLink',
    });
  });

  it('should parse representative persisted field VOs for other system field types', () => {
    const fieldVos = [
      {
        id: 'fldAttachmentField',
        name: 'Files',
        type: FieldType.Attachment,
        options: {},
        cellValueType: CellValueType.String,
        isMultipleCellValue: true,
        dbFieldType: DbFieldType.Json,
        dbFieldName: 'files',
      },
      {
        id: 'fldAutoNumberField',
        name: 'ID',
        type: FieldType.AutoNumber,
        options: {
          expression: 'AUTO_NUMBER()',
        },
        meta: {
          persistedAsGeneratedColumn: true,
        },
        isComputed: true,
        cellValueType: CellValueType.Number,
        dbFieldType: DbFieldType.Integer,
        dbFieldName: 'id_auto',
      },
      {
        id: 'fldCreatedTime',
        name: 'Created Time',
        type: FieldType.CreatedTime,
        options: {
          expression: 'CREATED_TIME()',
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'UTC',
          },
        },
        meta: {
          persistedAsGeneratedColumn: true,
        },
        isComputed: true,
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        dbFieldName: 'created_time',
      },
      {
        id: 'fldLastModifiedTime',
        name: 'Last Modified Time',
        type: FieldType.LastModifiedTime,
        options: {
          expression: 'LAST_MODIFIED_TIME()',
          formatting: {
            date: 'YYYY-MM-DD',
            time: 'HH:mm',
            timeZone: 'UTC',
          },
          trackedFieldIds: ['fldTracked'],
        },
        meta: {
          persistedAsGeneratedColumn: true,
        },
        isComputed: true,
        cellValueType: CellValueType.DateTime,
        dbFieldType: DbFieldType.DateTime,
        dbFieldName: 'last_modified_time',
      },
      {
        id: 'fldCreatedBy',
        name: 'Created By',
        type: FieldType.CreatedBy,
        options: {},
        meta: {
          persistedAsGeneratedColumn: false,
        },
        isComputed: true,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: 'created_by',
      },
      {
        id: 'fldLastModifiedBy',
        name: 'Last Modified By',
        type: FieldType.LastModifiedBy,
        options: {
          trackedFieldIds: ['fldTracked'],
        },
        meta: {
          persistedAsGeneratedColumn: false,
        },
        isComputed: true,
        cellValueType: CellValueType.String,
        dbFieldType: DbFieldType.Text,
        dbFieldName: 'last_modified_by',
      },
    ];

    fieldVos.forEach((fieldVo) => {
      const result = fieldVoSchema.safeParse(fieldVo);
      expect(result.success).toBe(true);
    });
  });
});
