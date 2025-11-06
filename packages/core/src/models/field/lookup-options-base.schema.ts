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

export const lookupOptionsVoSchema = z.union([
  lookupLinkOptionsVoSchema.strict(),
  lookupConditionalOptionsVoSchema.strict(),
]);

export const lookupOptionsRoSchema = z.union([
  lookupLinkOptionsRoSchema.strict(),
  lookupConditionalOptionsRoSchema.strict(),
]);

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
