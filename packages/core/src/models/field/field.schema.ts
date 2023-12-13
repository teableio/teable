import type { RefinementCtx } from 'zod';
import { assertNever } from '../../asserts';
import type { IEnsureKeysMatchInterface } from '../../types';
import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { StatisticsFunc } from '../aggregation';
import { CellValueType, DbFieldType, FieldType } from './constant';
import {
  checkboxFieldOptionsSchema,
  numberFieldOptionsSchema,
  selectFieldOptionsSchema,
  singlelineTextFieldOptionsSchema,
  formulaFieldOptionsSchema,
  linkFieldOptionsSchema,
  dateFieldOptionsSchema,
  attachmentFieldOptionsSchema,
  rollupFieldOptionsSchema,
  linkFieldOptionsRoSchema,
  numberFieldOptionsRoSchema,
  selectFieldOptionsRoSchema,
  ratingFieldOptionsSchema,
  longTextFieldOptionsSchema,
  createdTimeFieldOptionsSchema,
  lastModifiedTimeFieldOptionsSchema,
  autoNumberFieldOptionsSchema,
  createdTimeFieldOptionsRoSchema,
  lastModifiedTimeFieldOptionsRoSchema,
  autoNumberFieldOptionsRoSchema,
  userFieldOptionsSchema,
} from './derivate';

export const lookupOptionsVoSchema = linkFieldOptionsSchema
  .pick({
    foreignTableId: true,
    lookupFieldId: true,
    relationship: true,
    fkHostTableName: true,
    selfKeyName: true,
    foreignKeyName: true,
  })
  .merge(
    z.object({
      linkFieldId: z.string().openapi({
        description: 'The id of Linked record field to use for lookup',
      }),
    })
  );

export type ILookupOptionsVo = z.infer<typeof lookupOptionsVoSchema>;

export const lookupOptionsRoSchema = lookupOptionsVoSchema.pick({
  foreignTableId: true,
  lookupFieldId: true,
  linkFieldId: true,
});

export type ILookupOptionsRo = z.infer<typeof lookupOptionsRoSchema>;

export const columnSchema = z.object({
  order: z.number().openapi({
    description: 'Order is a floating number, column will sort by it in the view.',
  }),
  width: z.number().optional().openapi({
    description: 'Column width in the view.',
  }),
  hidden: z.boolean().optional().openapi({
    description: 'If column hidden in the view.',
  }),
  statisticFunc: z.nativeEnum(StatisticsFunc).optional().openapi({
    description: 'Statistic function of the column in the view.',
  }),
  required: z.boolean().optional().openapi({
    description: 'If column is required',
  }),
});

export type IColumn = z.infer<typeof columnSchema>;

export const columnMetaSchema = z.record(z.string().startsWith(IdPrefix.View), columnSchema);

export type IColumnMeta = z.infer<typeof columnMetaSchema>;

export const unionFieldOptions = z.union([
  rollupFieldOptionsSchema,
  formulaFieldOptionsSchema,
  linkFieldOptionsSchema,
  dateFieldOptionsSchema,
  checkboxFieldOptionsSchema,
  attachmentFieldOptionsSchema,
  singlelineTextFieldOptionsSchema,
  ratingFieldOptionsSchema,
  userFieldOptionsSchema,
]);

export const unionFieldOptionsVoSchema = z.union([
  unionFieldOptions,
  linkFieldOptionsSchema,
  selectFieldOptionsSchema,
  numberFieldOptionsSchema,
  autoNumberFieldOptionsSchema,
  createdTimeFieldOptionsSchema,
  lastModifiedTimeFieldOptionsSchema,
]);

export const unionFieldOptionsRoSchema = z.union([
  unionFieldOptions,
  linkFieldOptionsRoSchema,
  selectFieldOptionsRoSchema,
  numberFieldOptionsRoSchema,
  autoNumberFieldOptionsRoSchema,
  createdTimeFieldOptionsRoSchema,
  lastModifiedTimeFieldOptionsRoSchema,
]);

export type IFieldOptionsRo = z.infer<typeof unionFieldOptionsRoSchema>;

export const fieldVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.Field).openapi({
    description: 'The id of the field.',
  }),

  name: z.string().openapi({
    description: 'The name of the field.',
    example: 'Tags',
  }),

  type: z.nativeEnum(FieldType).openapi({
    description: 'The field types supported by teable.',
    example: FieldType.SingleSelect,
  }),

  description: z.string().optional().openapi({
    description: 'The description of the field.',
    example: 'this is a summary',
  }),

  options: unionFieldOptionsVoSchema.openapi({
    description:
      "The configuration options of the field. The structure of the field's options depend on the field's type.",
  }),

  isLookup: z.boolean().optional().openapi({
    description:
      'Whether this field is lookup field. witch means cellValue and [fieldType] is looked up from the linked table.',
  }),

  lookupOptions: lookupOptionsVoSchema.optional().openapi({
    description: 'field lookup options.',
  }),

  notNull: z.boolean().optional().openapi({
    description: 'Whether this field is not null.',
  }),

  unique: z.boolean().optional().openapi({
    description: 'Whether this field is not unique.',
  }),

  isPrimary: z.boolean().optional().openapi({
    description: 'Whether this field is primary field.',
  }),

  columnMeta: columnMetaSchema.openapi({
    description: 'A mapping of view IDs to their corresponding column metadata.',
  }),

  isComputed: z.boolean().optional().openapi({
    description:
      'Whether this field is computed field, you can not modify cellValue in computed field.',
  }),

  hasError: z.boolean().optional().openapi({
    description:
      "Whether This field has a configuration error. Check the fields referenced by this field's formula or configuration.",
  }),

  cellValueType: z.nativeEnum(CellValueType).openapi({
    description: 'The cell value type of the field.',
  }),

  isMultipleCellValue: z.boolean().optional().openapi({
    description: 'Whether this field has multiple cell value.',
  }),

  dbFieldType: z.nativeEnum(DbFieldType).openapi({
    description: 'The field type of database that cellValue really store.',
  }),

  dbFieldName: z.string().openapi({
    description: 'The field name of database that cellValue really store.',
  }),
});

export type IFieldVo = z.infer<typeof fieldVoSchema>;

export type IFieldPropertyKey = keyof Omit<IFieldVo, 'id'>;

export const FIELD_RO_PROPERTIES = [
  'type',
  'name',
  'isLookup',
  'description',
  'columnMeta',
  'lookupOptions',
  'options',
] as const;

/**
 * make sure FIELD_RO_PROPERTIES is exactly equals IFieldVo
 * if here throw error, you should update FIELD_RO_PROPERTIES
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validator1: IEnsureKeysMatchInterface<IUpdateFieldRo, typeof FIELD_RO_PROPERTIES> = true;

export const FIELD_VO_PROPERTIES = [
  'type',
  'description',
  'options',
  'name',
  'isLookup',
  'lookupOptions',
  'notNull',
  'unique',
  'isPrimary',
  'columnMeta',
  'isComputed',
  'hasError',
  'cellValueType',
  'isMultipleCellValue',
  'dbFieldType',
  'dbFieldName',
] as const;

/**
 * make sure FIELD_VO_PROPERTIES is exactly equals IFieldVo
 * if here throw error, you should update FIELD_VO_PROPERTIES
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _validator2: IEnsureKeysMatchInterface<
  Omit<IFieldVo, 'id'>,
  typeof FIELD_VO_PROPERTIES
> = true;

export const getOptionsSchema = (type: FieldType) => {
  switch (type) {
    case FieldType.SingleLineText:
      return singlelineTextFieldOptionsSchema;
    case FieldType.LongText:
      return longTextFieldOptionsSchema;
    case FieldType.User:
      return userFieldOptionsSchema;
    case FieldType.Attachment:
      return attachmentFieldOptionsSchema;
    case FieldType.Checkbox:
      return checkboxFieldOptionsSchema;
    case FieldType.MultipleSelect:
      return selectFieldOptionsRoSchema;
    case FieldType.SingleSelect:
      return selectFieldOptionsRoSchema;
    case FieldType.Date:
      return dateFieldOptionsSchema;
      return false;
    case FieldType.Number:
      return numberFieldOptionsRoSchema;
      return false;
    case FieldType.Duration:
      return false;
    case FieldType.Rating:
      return ratingFieldOptionsSchema;
    case FieldType.Formula:
      return formulaFieldOptionsSchema;
    case FieldType.Rollup:
      return rollupFieldOptionsSchema;
    case FieldType.Count:
      return false;
    case FieldType.Link:
      return linkFieldOptionsRoSchema;
    case FieldType.CreatedTime:
      return createdTimeFieldOptionsRoSchema;
    case FieldType.LastModifiedTime:
      return lastModifiedTimeFieldOptionsRoSchema;
    case FieldType.CreatedBy:
      return false;
    case FieldType.LastModifiedBy:
      return false;
    case FieldType.AutoNumber:
      return autoNumberFieldOptionsRoSchema;
    case FieldType.Button:
      return false;
    default:
      assertNever(type);
  }
};

const refineOptions = (
  data: {
    type: FieldType;
    isLookup?: boolean;
    lookupOptions?: ILookupOptionsRo;
    options?: IFieldOptionsRo;
  },
  ctx: RefinementCtx
) => {
  const { type, isLookup, lookupOptions, options } = data;
  if (isLookup && !lookupOptions) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lookupOptions is required when isLookup is true.',
    });
  }

  if (!isLookup && lookupOptions && type !== FieldType.Rollup) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'lookupOptions is not allowed when isLookup is not true.',
    });
  }

  if (!options) {
    return;
  }
  const schema = getOptionsSchema(data.type);
  const result = schema && schema.safeParse(data.options);

  if (result && !result.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error.message,
    });
  }
};

const baseFieldRoSchema = fieldVoSchema
  .partial()
  .pick({
    type: true,
    name: true,
    isLookup: true,
    description: true,
    columnMeta: true,
  })
  .required({
    type: true,
  })
  .merge(
    z.object({
      lookupOptions: lookupOptionsRoSchema.optional().openapi({
        description:
          'The lookup options for field, you need to configure it when isLookup attribute is true or field type is rollup.',
      }),
      options: unionFieldOptionsRoSchema.optional().openapi({
        description:
          "The options of the field. The configuration of the field's options depend on the it's specific type.",
      }),
    })
  );

export const updateFieldRoSchema = baseFieldRoSchema.superRefine(refineOptions);
export const fieldRoSchema = baseFieldRoSchema
  .merge(
    z.object({
      id: z.string().startsWith(IdPrefix.Field).optional().openapi({
        description:
          'The id of the field that start with "fld", followed by exactly 16 alphanumeric characters `/^fld[\\da-zA-Z]{16}$/`. It is sometimes useful to specify an id at creation time',
        example: 'fldxxxxxxxxxxxxxxxx',
      }),
    })
  )
  .superRefine(refineOptions);

export type IFieldRo = z.infer<typeof fieldRoSchema>;

export type IUpdateFieldRo = z.infer<typeof updateFieldRoSchema>;

export const getFieldsQuerySchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    description: 'The id of the view.',
  }),
  filterHidden: z.boolean().optional(),
});

export type IGetFieldsQuery = z.infer<typeof getFieldsQuerySchema>;
