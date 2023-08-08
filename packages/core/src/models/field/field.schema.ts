import { z } from 'zod';
import { IdPrefix } from '../../utils';
import { StatisticsFunc } from '../view/constant';
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
} from './derivate';

export const lookupOptionsVoSchema = linkFieldOptionsSchema
  .pick({
    foreignTableId: true,
    lookupFieldId: true,
    relationship: true,
    dbForeignKeyName: true,
  })
  .merge(
    z.object({
      linkFieldId: z.string().openapi({
        description: 'The id of Linked record field to use for lookup',
      }),
    })
  )
  .strict();

export type ILookupOptionsVo = z.infer<typeof lookupOptionsVoSchema>;

export const lookupOptionsRoSchema = lookupOptionsVoSchema
  .omit({
    relationship: true,
    dbForeignKeyName: true,
  })
  .strict();

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
});

export type IColumn = z.infer<typeof columnSchema>;

export const columnMetaSchema = z.record(z.string().startsWith(IdPrefix.View), columnSchema);

export type IColumnMeta = z.infer<typeof columnMetaSchema>;

export const unionFieldOptions = z.union([
  rollupFieldOptionsSchema,
  formulaFieldOptionsSchema,
  selectFieldOptionsSchema,
  numberFieldOptionsSchema,
  linkFieldOptionsSchema,
  dateFieldOptionsSchema,
  checkboxFieldOptionsSchema,
  attachmentFieldOptionsSchema,
  singlelineTextFieldOptionsSchema,
]);

export const unionFieldOptionsVoSchema = unionFieldOptions.or(linkFieldOptionsSchema);

export const unionFieldOptionsRoSchema = unionFieldOptions.or(linkFieldOptionsRoSchema);

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

export const fieldRoSchema = fieldVoSchema
  .omit({
    id: true,
    isComputed: true,
    cellValueType: true,
    isMultipleCellValue: true,
    dbFieldType: true,
    dbFieldName: true,
    lookupOptions: true,
    hasError: true,
  })
  .merge(
    z.object({
      id: z.string().startsWith(IdPrefix.Field).optional().openapi({
        description:
          'The id of the field that start with "fld", followed by exactly 16 alphanumeric characters `/^fld[\\da-zA-Z]{16}$/`. It is sometimes useful to specify an id at creation time',
        example: 'fldxxxxxxxxxxxxxxxx',
      }),
      lookupOptions: lookupOptionsRoSchema.optional().openapi({
        description:
          'The lookup options for field, you need to configure it when isLookup attribute is true or field type is rollup.',
      }),
      options: unionFieldOptionsRoSchema.optional().openapi({
        description:
          "The options of the field. The configuration of the field's options depend on the it's specific type.",
      }),
    })
  )
  .partial({
    name: true,
    description: true,
    options: true,
    columnMeta: true,
  });

export type IFieldRo = z.infer<typeof fieldRoSchema>;

export const updateFieldRoSchema = fieldRoSchema.omit({
  id: true,
});

export type IUpdateFieldRo = z.infer<typeof updateFieldRoSchema>;

export const getFieldsQuerySchema = z.object({
  viewId: z.string().startsWith(IdPrefix.View).optional().openapi({
    description: 'The id of the view.',
  }),
  filterHidden: z.boolean().optional(),
});

export type IGetFieldsQuery = z.infer<typeof getFieldsQuerySchema>;
