import { z } from 'zod';

import { fieldColorSchema } from '../../domain/table/fields/types/FieldColor';
import { TIME_ZONE_LIST } from '../../domain/table/fields/types/TimeZone';
import {
  cellValueTypeSchema,
  dateFormattingSchema,
  fieldConditionSchema,
  formulaFormattingSchema,
  formulaShowAsSchema,
  linkRelationshipSchema,
  numberFormattingSchema,
  numberShowAsSchema,
  ratingColorSchema,
  ratingIconSchema,
  singleLineTextShowAsSchema,
  trackedFieldIdsSchema,
} from './common.schema';

// Field options schemas
export const singleLineTextOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z.string().optional(),
});

export const longTextOptionsSchema = z.object({
  defaultValue: z.string().optional(),
});

export const numberOptionsSchema = z.object({
  formatting: numberFormattingSchema.optional(),
  showAs: numberShowAsSchema.optional(),
  defaultValue: z.number().optional(),
});

export const ratingOptionsSchema = z.object({
  icon: ratingIconSchema.optional(),
  color: ratingColorSchema.optional(),
  max: z.number().optional(),
});

export const selectChoiceSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  color: fieldColorSchema,
});

export const selectOptionsSchema = z.object({
  choices: z.array(selectChoiceSchema).optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
  preventAutoNewOptions: z.boolean().optional(),
});

export const checkboxOptionsSchema = z.object({
  defaultValue: z.boolean().optional(),
});

export const dateOptionsSchema = z.object({
  formatting: dateFormattingSchema.optional(),
  defaultValue: z.enum(['now']).optional(),
});

export const createdTimeOptionsSchema = z.object({
  formatting: dateFormattingSchema.optional(),
});

export const lastModifiedTimeOptionsSchema = z.object({
  formatting: dateFormattingSchema.optional(),
  trackedFieldIds: trackedFieldIdsSchema.optional(),
});

export const createdByOptionsSchema = z.object({});

export const lastModifiedByOptionsSchema = z.object({
  trackedFieldIds: trackedFieldIdsSchema.optional(),
});

export const autoNumberOptionsSchema = z.object({});

export const userOptionsSchema = z.object({
  isMultiple: z.boolean().optional(),
  shouldNotify: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
});

export const buttonWorkflowSchema = z.object({
  id: z.string().startsWith('wfl').optional(),
  name: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const buttonOptionsSchema = z.object({
  label: z.string().optional(),
  color: fieldColorSchema.optional(),
  maxCount: z.number().optional(),
  resetCount: z.boolean().optional(),
  workflow: buttonWorkflowSchema.optional().nullable(),
});

export const formulaOptionsSchema = z.object({
  expression: z.string(),
  timeZone: z.enum(TIME_ZONE_LIST).optional(),
  formatting: formulaFormattingSchema.optional(),
  showAs: formulaShowAsSchema.optional(),
});

export const linkOptionsSchema = z
  .object({
    baseId: z.string().optional(),
    relationship: linkRelationshipSchema,
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    isOneWay: z.boolean().optional(),
    symmetricFieldId: z.string().optional(),
    filterByViewId: z.string().nullable().optional(),
    visibleFieldIds: z.array(z.string()).nullable().optional(),
    filter: fieldConditionSchema.shape.filter,
  })
  .strict();

export const rollupOptionsSchema = z
  .object({
    expression: z.string(),
    timeZone: z.enum(TIME_ZONE_LIST).optional(),
    formatting: formulaFormattingSchema.optional(),
    showAs: formulaShowAsSchema.optional(),
  })
  .strict();

export const rollupConfigSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
  })
  .strict();

export const lookupOptionsSchema = z
  .object({
    linkFieldId: z.string(),
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    filter: fieldConditionSchema.shape.filter,
    sort: fieldConditionSchema.shape.sort,
    limit: fieldConditionSchema.shape.limit,
  })
  .strict();

export const conditionalRollupConfigSchema = z
  .object({
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    condition: fieldConditionSchema,
  })
  .strict()
  .refine(
    (data) => {
      const filter = data.condition?.filter;
      return (
        filter !== null &&
        filter !== undefined &&
        filter.filterSet !== undefined &&
        filter.filterSet.length > 0
      );
    },
    {
      message: 'ConditionalRollupConfig condition must have at least one filter item',
      path: ['condition'],
    }
  );

export const conditionalRollupOptionsSchema = z
  .object({
    expression: z.string(),
    timeZone: z.enum(TIME_ZONE_LIST).optional(),
    formatting: formulaFormattingSchema.optional(),
    showAs: formulaShowAsSchema.optional(),
  })
  .strict();

export const conditionalLookupOptionsSchema = z
  .object({
    foreignTableId: z.string(),
    lookupFieldId: z.string(),
    condition: fieldConditionSchema,
  })
  .strict()
  .refine(
    (data) => {
      const filter = data.condition?.filter;
      return (
        filter !== null &&
        filter !== undefined &&
        filter.filterSet !== undefined &&
        filter.filterSet.length > 0
      );
    },
    {
      message: 'ConditionalLookupOptions condition must have at least one filter item',
      path: ['condition'],
    }
  );

const tableFieldCommonShape = {
  id: z.string().optional(),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
  notNull: z.boolean().optional(),
  unique: z.boolean().optional(),
} satisfies z.ZodRawShape;

const tableFieldSchema = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...tableFieldCommonShape,
    ...shape,
  });

// Main tableFieldInputSchema - discriminated union of all field types
export const tableFieldInputSchema = z.discriminatedUnion('type', [
  tableFieldSchema({
    type: z.literal('singleLineText'),
    options: singleLineTextOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('longText'),
    options: longTextOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('number'),
    options: numberOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('rating'),
    max: z.number().optional(),
    options: ratingOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('singleSelect'),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
  }),
  tableFieldSchema({
    type: z.literal('multipleSelect'),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
  }),
  tableFieldSchema({
    type: z.literal('checkbox'),
    options: checkboxOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('attachment'),
  }),
  tableFieldSchema({
    type: z.literal('date'),
    options: dateOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('createdTime'),
    options: createdTimeOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('lastModifiedTime'),
    options: lastModifiedTimeOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('user'),
    options: userOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('createdBy'),
    options: createdByOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('lastModifiedBy'),
    options: lastModifiedByOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('autoNumber'),
    options: autoNumberOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('button'),
    options: buttonOptionsSchema.optional(),
  }),
  tableFieldSchema({
    type: z.literal('formula'),
    options: formulaOptionsSchema,
  }).strict(),
  tableFieldSchema({
    type: z.literal('link'),
    options: linkOptionsSchema,
  }).strict(),
  tableFieldSchema({
    type: z.literal('rollup'),
    options: rollupOptionsSchema,
    config: rollupConfigSchema,
    cellValueType: cellValueTypeSchema.optional(),
    isMultipleCellValue: z.boolean().optional(),
  }).strict(),
  tableFieldSchema({
    type: z.literal('lookup'),
    options: lookupOptionsSchema,
  }).strict(),
  tableFieldSchema({
    type: z.literal('conditionalRollup'),
    options: conditionalRollupOptionsSchema,
    config: conditionalRollupConfigSchema,
    cellValueType: cellValueTypeSchema.optional(),
    isMultipleCellValue: z.boolean().optional(),
  }).strict(),
  tableFieldSchema({
    type: z.literal('conditionalLookup'),
    options: conditionalLookupOptionsSchema,
  }).strict(),
]);

export type ITableFieldInput = z.output<typeof tableFieldInputSchema>;
export type ResolvedTableFieldInput = ITableFieldInput & { name: string };
