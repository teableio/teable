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

// Main tableFieldInputSchema - discriminated union of all field types
export const tableFieldInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('singleLineText'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: singleLineTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('longText'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: longTextOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('number'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: numberOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('rating'),
    id: z.string().optional(),
    name: z.string().optional(),
    max: z.number().optional(),
    options: ratingOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('singleSelect'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('multipleSelect'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: z.union([z.array(z.string()), selectOptionsSchema]).optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('checkbox'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: checkboxOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('attachment'),
    id: z.string().optional(),
    name: z.string().optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('date'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: dateOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('createdTime'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: createdTimeOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('lastModifiedTime'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: lastModifiedTimeOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('user'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: userOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('createdBy'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: createdByOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('lastModifiedBy'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: lastModifiedByOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('autoNumber'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: autoNumberOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('button'),
    id: z.string().optional(),
    name: z.string().optional(),
    options: buttonOptionsSchema.optional(),
    isPrimary: z.boolean().optional(),
    notNull: z.boolean().optional(),
    unique: z.boolean().optional(),
  }),
  z
    .object({
      type: z.literal('formula'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: formulaOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('link'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: linkOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('rollup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: rollupOptionsSchema,
      config: rollupConfigSchema,
      cellValueType: cellValueTypeSchema.optional(),
      isMultipleCellValue: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('lookup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: lookupOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('conditionalRollup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: conditionalRollupOptionsSchema,
      config: conditionalRollupConfigSchema,
      cellValueType: cellValueTypeSchema.optional(),
      isMultipleCellValue: z.boolean().optional(),
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('conditionalLookup'),
      id: z.string().optional(),
      name: z.string().optional(),
      options: conditionalLookupOptionsSchema,
      isPrimary: z.boolean().optional(),
      notNull: z.boolean().optional(),
      unique: z.boolean().optional(),
    })
    .strict(),
]);

export type ITableFieldInput = z.output<typeof tableFieldInputSchema>;
export type ResolvedTableFieldInput = ITableFieldInput & { name: string };
