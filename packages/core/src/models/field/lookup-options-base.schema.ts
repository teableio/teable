import { z } from '../../zod';
import { filterSchema } from '../view/filter';
import { SortFunc } from '../view/sort';
import { CONDITIONAL_QUERY_MAX_LIMIT } from './conditional.constants';
import { Relationship } from './constant';

const lookupLinkOptionsVoSchema = z.object({
  baseId: z.string().optional().meta({
    description:
      'the base id of the table that this field is linked to, only required for cross base link',
  }),
  relationship: z.enum(Relationship).meta({
    description: 'describe the relationship from this table to the foreign table',
  }),
  foreignTableId: z.string().meta({
    description: 'the table this field is linked to',
  }),
  lookupFieldId: z.string().meta({
    description: 'the field in the foreign table that will be displayed as the current field',
  }),
  fkHostTableName: z.string().meta({
    description:
      'the table name for storing keys, in many-to-many relationships, keys are stored in a separate intermediate table; in other relationships, keys are stored on one side as needed',
  }),
  selfKeyName: z.string().meta({
    description: 'the name of the field that stores the current table primary key',
  }),
  foreignKeyName: z.string().meta({
    description: 'The name of the field that stores the foreign table primary key',
  }),
  filter: filterSchema.optional(),
  linkFieldId: z.string().meta({
    description: 'The id of Linked record field to use for lookup',
  }),
});

const lookupLinkOptionsRoSchema = lookupLinkOptionsVoSchema.pick({
  foreignTableId: true,
  lookupFieldId: true,
  linkFieldId: true,
  filter: true,
});

const lookupConditionalOptionsVoSchema = z.object({
  baseId: z.string().optional().meta({
    description:
      'the base id of the table that this field is linked to, only required for cross base link',
  }),
  foreignTableId: z.string().meta({
    description: 'the table this field is linked to',
  }),
  lookupFieldId: z.string().meta({
    description: 'the field in the foreign table that will be displayed as the current field',
  }),
  filter: filterSchema.meta({
    description: 'Filter to apply when resolving conditional lookup values.',
  }),
  sort: z
    .object({
      fieldId: z.string().meta({
        description: 'The field in the foreign table used to order lookup records.',
      }),
      order: z
        .enum(SortFunc)
        .meta({ description: 'Ordering direction to apply to the sorted field.' }),
    })
    .optional()
    .meta({
      description: 'Optional sort configuration applied before aggregating lookup values.',
    }),
  limit: z.number().int().positive().max(CONDITIONAL_QUERY_MAX_LIMIT).optional().meta({
    description: 'Maximum number of matching records to include in the lookup result.',
  }),
});

const lookupConditionalOptionsRoSchema = lookupConditionalOptionsVoSchema;

// Helper function for lookup options error handling
function getLookupOptionsError(input: Record<string, unknown>) {
  // Check for common mistake: expression in lookupOptions
  if ('expression' in input) {
    return 'Rollup field configuration error: "expression" (e.g., "sum({values})") should be in "options", not "lookupOptions". lookupOptions should contain: { linkFieldId, lookupFieldId, foreignTableId } for link lookup, or { foreignTableId, lookupFieldId, filter } for conditional lookup';
  }

  // Determine which schema to use based on discriminator
  // Link lookup has linkFieldId, conditional lookup has filter
  const hasLinkFieldId = 'linkFieldId' in input;
  const hasFilter = 'filter' in input;

  let targetSchema;
  let schemaType;

  if (hasLinkFieldId) {
    targetSchema = lookupLinkOptionsVoSchema.strict();
    schemaType = 'Link lookup';
  } else if (hasFilter) {
    targetSchema = lookupConditionalOptionsVoSchema.strict();
    schemaType = 'Conditional lookup';
  } else {
    return 'Lookup options must be either link lookup (with linkFieldId) or conditional lookup (with filter)';
  }

  // Parse with specific schema to get accurate error
  const result = targetSchema.safeParse(input);
  if (!result.success) {
    return `${schemaType} error: ${result.error.issues[0].message}`;
  }

  return undefined;
}

export const lookupOptionsVoSchema = z.union(
  [lookupLinkOptionsVoSchema.strict(), lookupConditionalOptionsVoSchema.strict()],
  {
    error: (issue) => {
      if (issue.input && typeof issue.input === 'object') {
        return getLookupOptionsError(issue.input as Record<string, unknown>);
      }
      return undefined;
    },
  }
);

export const lookupOptionsRoSchema = z.union(
  [lookupLinkOptionsRoSchema.strict(), lookupConditionalOptionsRoSchema.strict()],
  {
    error: (issue) => {
      if (issue.input && typeof issue.input === 'object') {
        const input = issue.input as Record<string, unknown>;

        // Check for common mistake first
        if ('expression' in input) {
          return 'Rollup field configuration error: "expression" (e.g., "sum({values})") should be in "options", not "lookupOptions". lookupOptions should contain: { linkFieldId, lookupFieldId, foreignTableId }';
        }

        // Determine schema based on discriminator
        const hasLinkFieldId = 'linkFieldId' in input;
        const hasFilter = 'filter' in input;

        let targetSchema;
        let schemaType;

        if (hasLinkFieldId) {
          targetSchema = lookupLinkOptionsRoSchema.strict();
          schemaType = 'Link lookup';
        } else if (hasFilter) {
          targetSchema = lookupConditionalOptionsRoSchema.strict();
          schemaType = 'Conditional lookup';
        } else {
          return 'Lookup options must be either link lookup (with linkFieldId) or conditional lookup (with filter)';
        }

        // Parse with specific schema
        const result = targetSchema.safeParse(input);
        if (!result.success) {
          return `${schemaType} error: ${result.error.issues[0].message}`;
        }
      }
      return undefined;
    },
  }
);

export type ILookupOptionsVo = z.infer<typeof lookupOptionsVoSchema>;
export type ILookupOptionsRo = z.infer<typeof lookupOptionsRoSchema>;
export type ILookupLinkOptions = z.infer<typeof lookupLinkOptionsRoSchema>;
export type ILookupConditionalOptions = z.infer<typeof lookupConditionalOptionsRoSchema>;
export type IConditionalLookupOptions = ILookupConditionalOptions;
export type ILookupLinkOptionsVo = z.infer<typeof lookupLinkOptionsVoSchema>;
export type ILookupConditionalOptionsVo = z.infer<typeof lookupConditionalOptionsVoSchema>;

export const isLinkLookupOptions = <T extends ILookupOptionsRo | ILookupOptionsVo | undefined>(
  options: T
): options is Extract<T, ILookupLinkOptions | ILookupLinkOptionsVo> => {
  return Boolean(options && typeof options === 'object' && 'linkFieldId' in options);
};

export const isConditionalLookupOptions = (
  options: ILookupOptionsRo | ILookupOptionsVo | undefined
): options is ILookupConditionalOptions | ILookupConditionalOptionsVo => {
  return Boolean(options && typeof options === 'object' && !('linkFieldId' in options));
};
