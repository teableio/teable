import type { RefinementCtx } from 'zod';
import { assertNever } from '../../asserts';
import type { IEnsureKeysMatchInterface } from '../../types';
import { IdPrefix } from '../../utils';
import { z } from '../../zod';
import { fieldAIConfigSchema } from './ai-config';
import { CellValueType, DbFieldType, FieldType } from './constant';
import { selectFieldOptionsRoSchema } from './derivate/abstract/select.field.abstract';
import { attachmentFieldOptionsSchema } from './derivate/attachment-option.schema';
import { autoNumberFieldOptionsRoSchema } from './derivate/auto-number-option.schema';
import { buttonFieldOptionsSchema } from './derivate/button-option.schema';
import { checkboxFieldOptionsSchema } from './derivate/checkbox-option.schema';
import { conditionalRollupFieldOptionsSchema } from './derivate/conditional-rollup-option.schema';
import { createdByFieldOptionsSchema } from './derivate/created-by-option.schema';
import { createdTimeFieldOptionsRoSchema } from './derivate/created-time-option.schema';
import { dateFieldOptionsSchema } from './derivate/date-option.schema';
import { formulaFieldOptionsSchema } from './derivate/formula-option.schema';
import { lastModifiedByFieldOptionsSchema } from './derivate/last-modified-by-option.schema';
import { lastModifiedTimeFieldOptionsRoSchema } from './derivate/last-modified-time-option.schema';
import { linkFieldOptionsRoSchema } from './derivate/link-option.schema';
import { longTextFieldOptionsSchema } from './derivate/long-text-option.schema';
import { numberFieldOptionsRoSchema } from './derivate/number-option.schema';
import { ratingFieldOptionsSchema } from './derivate/rating-option.schema';
import { rollupFieldOptionsSchema } from './derivate/rollup-option.schema';
import { singlelineTextFieldOptionsSchema } from './derivate/single-line-text-option.schema';
import { userFieldOptionsSchema } from './derivate/user-option.schema';
import {
  type IFieldOptionsRo,
  unionFieldMetaVoSchema,
  unionFieldOptionsRoSchema,
  unionFieldOptionsVoSchema,
} from './field-unions.schema';
import type { ILookupOptionsRo } from './lookup-options-base.schema';
import { lookupOptionsRoSchema, lookupOptionsVoSchema } from './lookup-options-base.schema';
import { validateFieldOptions } from './zod-error';

// All union schemas and types are now imported from field-unions.schema.ts

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

  meta: unionFieldMetaVoSchema.optional().openapi({
    description:
      "The metadata of the field. The structure of the field's meta depend on the field's type. Currently formula and link fields have meta.",
  }),

  aiConfig: fieldAIConfigSchema.nullable().optional().openapi({
    description: 'The AI configuration of the field.',
  }),

  isLookup: z.boolean().optional().openapi({
    description:
      'Whether this field is lookup field. witch means cellValue and [fieldType] is looked up from the linked table.',
  }),

  isConditionalLookup: z.boolean().optional().openapi({
    description:
      'Whether this lookup field applies a conditional filter when resolving linked records.',
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
  recordRead: z.boolean().optional().openapi({
    description:
      'Field record read permission. When set to false, reading records is denied. When true or not set, reading records is allowed.',
  }),

  recordCreate: z.boolean().optional().openapi({
    description:
      'Field record create permission. When set to false, creating records is denied. When true or not set, creating records is allowed.',
  }),
});

export type IFieldVo = z.infer<typeof fieldVoSchema>;

export type IFieldPropertyKey = keyof Omit<IFieldVo, 'id'>;

export const FIELD_RO_PROPERTIES = [
  'type',
  'name',
  'dbFieldName',
  'isLookup',
  'isConditionalLookup',
  'description',
  'lookupOptions',
  'options',
] as const;

export const FIELD_VO_PROPERTIES = [
  'type',
  'description',
  'options',
  'meta',
  'aiConfig',
  'name',
  'isLookup',
  'isConditionalLookup',
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
  'recordRead',
  'recordCreate',
] as const;

/**
 * make sure FIELD_VO_PROPERTIES is exactly equals IFieldVo
 * if here shows lint error, you should update FIELD_VO_PROPERTI ES
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
    case FieldType.ConditionalRollup:
      return conditionalRollupFieldOptionsSchema;
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
    case FieldType.Button:
      return buttonFieldOptionsSchema;
    default:
      assertNever(type);
  }
};

const refineOptions = (
  data: {
    type: FieldType;
    isLookup?: boolean;
    isConditionalLookup?: boolean;
    lookupOptions?: ILookupOptionsRo;
    options?: IFieldOptionsRo;
  },
  ctx: RefinementCtx
) => {
  if (data.isConditionalLookup && !data.isLookup) {
    ctx.addIssue({
      path: ['isConditionalLookup'],
      code: z.ZodIssueCode.custom,
      message: 'isConditionalLookup requires isLookup to be true.',
    });
  }

  const validateRes = validateFieldOptions(data);
  validateRes.forEach((item) => {
    ctx.addIssue({
      path: item.path,
      code: z.ZodIssueCode.custom,
      message: item.message,
    });
  });
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
    isConditionalLookup: true,
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
      aiConfig: fieldAIConfigSchema.nullable().optional().openapi({
        description: 'The AI configuration of the field.',
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
  projection: z.array(z.string().startsWith(IdPrefix.Field)).optional().openapi({
    description:
      'If you want to get only some fields, pass in this parameter, otherwise all visible fields will be obtained',
  }),
});

export type IGetFieldsQuery = z.infer<typeof getFieldsQuerySchema>;
