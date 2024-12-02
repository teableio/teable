import type { RefinementCtx } from 'zod';
import { assertNever } from '../../asserts';
import type { IEnsureKeysMatchInterface } from '../../types';
import { IdPrefix } from '../../utils';
import { z } from '../../zod';
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
  createdByFieldOptionsSchema,
  lastModifiedByFieldOptionsSchema,
} from './derivate';
import { unionFormattingSchema } from './formatting';
import { unionShowAsSchema } from './show-as';

export const lookupOptionsVoSchema = linkFieldOptionsSchema
  .pick({
    foreignTableId: true,
    lookupFieldId: true,
    relationship: true,
    fkHostTableName: true,
    selfKeyName: true,
    foreignKeyName: true,
    filter: true,
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
  filter: true,
});

export type ILookupOptionsRo = z.infer<typeof lookupOptionsRoSchema>;

export const unionFieldOptions = z.union([
  rollupFieldOptionsSchema.strict(),
  formulaFieldOptionsSchema.strict(),
  linkFieldOptionsSchema.strict(),
  dateFieldOptionsSchema.strict(),
  checkboxFieldOptionsSchema.strict(),
  attachmentFieldOptionsSchema.strict(),
  singlelineTextFieldOptionsSchema.strict(),
  ratingFieldOptionsSchema.strict(),
  userFieldOptionsSchema.strict(),
  createdByFieldOptionsSchema.strict(),
  lastModifiedByFieldOptionsSchema.strict(),
]);

export const unionFieldOptionsVoSchema = z.union([
  unionFieldOptions,
  linkFieldOptionsSchema.strict(),
  selectFieldOptionsSchema.strict(),
  numberFieldOptionsSchema.strict(),
  autoNumberFieldOptionsSchema.strict(),
  createdTimeFieldOptionsSchema.strict(),
  lastModifiedTimeFieldOptionsSchema.strict(),
]);

export const unionFieldOptionsRoSchema = z.union([
  unionFieldOptions,
  linkFieldOptionsRoSchema.strict(),
  selectFieldOptionsRoSchema.strict(),
  numberFieldOptionsRoSchema.strict(),
  autoNumberFieldOptionsRoSchema.strict(),
  createdTimeFieldOptionsRoSchema.strict(),
  lastModifiedTimeFieldOptionsRoSchema.strict(),
]);

export const commonOptionsSchema = z.object({
  showAs: unionShowAsSchema.optional(),
  formatting: unionFormattingSchema.optional(),
});

export type IFieldOptionsRo = z.infer<typeof unionFieldOptionsRoSchema>;
export type IFieldOptionsVo = z.infer<typeof unionFieldOptionsVoSchema>;

export const fieldVoSchema = z.object({
  id: z.string().startsWith(IdPrefix.Field).openapi({
    description: 'The id of the field.',
  }),

  name: z.string().openapi({
    description: 'The name of the field. can not be duplicated in the table.',
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

  isComputed: z.boolean().optional().openapi({
    description:
      'Whether this field is computed field, you can not modify cellValue in computed field.',
  }),

  isPending: z.boolean().optional().openapi({
    description: "Whether this field's calculation is pending.",
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

  dbFieldName: z
    .string()
    .min(1, { message: 'name cannot be empty' })
    .regex(/^\w{0,63}$/, {
      message: 'Invalid name format',
    })
    .openapi({
      description:
        'Field(column) name in backend database. Limitation: 1-63 characters, can only contain letters, numbers and underscore, case sensitive, cannot be duplicated with existing db field name in the table.',
    }),
});

export type IFieldVo = z.infer<typeof fieldVoSchema>;

export type IFieldPropertyKey = keyof Omit<IFieldVo, 'id'>;

export const FIELD_RO_PROPERTIES = [
  'type',
  'name',
  'dbFieldName',
  'isLookup',
  'description',
  'lookupOptions',
  'options',
] as const;

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
  'isComputed',
  'isPending',
  'hasError',
  'cellValueType',
  'isMultipleCellValue',
  'dbFieldType',
  'dbFieldName',
] as const;

/**
 * make sure FIELD_VO_PROPERTIES is exactly equals IFieldVo
 * if here shows lint error, you should update FIELD_VO_PROPERTIES
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
    case FieldType.Number:
      return numberFieldOptionsRoSchema;
    case FieldType.Rating:
      return ratingFieldOptionsSchema;
    case FieldType.Formula:
      return formulaFieldOptionsSchema;
    case FieldType.Rollup:
      return rollupFieldOptionsSchema;
    case FieldType.Link:
      return linkFieldOptionsRoSchema;
    case FieldType.CreatedTime:
      return createdTimeFieldOptionsRoSchema;
    case FieldType.LastModifiedTime:
      return lastModifiedTimeFieldOptionsRoSchema;
    case FieldType.AutoNumber:
      return autoNumberFieldOptionsRoSchema;
    case FieldType.CreatedBy:
      return createdByFieldOptionsSchema;
    case FieldType.LastModifiedBy:
      return lastModifiedByFieldOptionsSchema;
    case FieldType.Duration:
    case FieldType.Count:
    case FieldType.Button:
      throw new Error('no implementation');
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

  if (isLookup) {
    const result = commonOptionsSchema.safeParse(options);
    if (!result.success) {
      ctx.addIssue({
        path: ['options'],
        code: z.ZodIssueCode.custom,
        message: `RefineOptionsInLookupError: ${result.error.message}`,
      });
    }
    return;
  }

  const schema = getOptionsSchema(type);
  const result = schema && schema.safeParse(options);

  if (result && !result.success) {
    ctx.addIssue({
      path: ['options'],
      code: z.ZodIssueCode.custom,
      message: `RefineOptionsError: ${result.error.message}`,
    });
  }
};

const baseFieldRoSchema = fieldVoSchema
  .partial()
  .pick({
    type: true,
    name: true,
    unique: true,
    notNull: true,
    dbFieldName: true,
    isLookup: true,
    description: true,
  })
  .required({
    type: true,
  })
  .merge(
    z.object({
      name: fieldVoSchema.shape.name.min(1).optional(),
      description: fieldVoSchema.shape.description.nullable(),
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

export const convertFieldRoSchema = baseFieldRoSchema.superRefine(refineOptions);
export const createFieldRoSchema = baseFieldRoSchema
  .merge(
    z.object({
      id: z.string().startsWith(IdPrefix.Field).optional().openapi({
        description:
          'The id of the field that start with "fld", followed by exactly 16 alphanumeric characters `/^fld[\\da-zA-Z]{16}$/`. It is sometimes useful to specify an id at creation time',
        example: 'fldxxxxxxxxxxxxxxxx',
      }),
      order: z
        .object({
          viewId: z.string().openapi({
            description: 'You can only specify order in one view when create field',
          }),
          orderIndex: z.number(),
        })
        .optional(),
    })
  )
  .superRefine(refineOptions);

export const updateFieldRoSchema = z.object({
  name: baseFieldRoSchema.shape.name,
  description: baseFieldRoSchema.shape.description,
  dbFieldName: baseFieldRoSchema.shape.dbFieldName,
});

export type IFieldRo = z.infer<typeof createFieldRoSchema>;

export type IConvertFieldRo = z.infer<typeof convertFieldRoSchema>;

export type IUpdateFieldRo = z.infer<typeof updateFieldRoSchema>;

export const getFieldsQuerySchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    description: 'The id of the view.',
  }),
  filterHidden: z.coerce.boolean().optional(),
  excludeFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
});

export type IGetFieldsQuery = z.infer<typeof getFieldsQuerySchema>;
