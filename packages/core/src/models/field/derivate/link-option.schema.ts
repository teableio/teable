import { z } from '../../../zod';
import { filterSchema } from '../../view/filter';
import { Relationship } from '../constant';

export const linkFieldOptionsSchema = z
  .object({
    baseId: z.string().optional().openapi({
      description:
        'the base id of the table that this field is linked to, only required for cross base link',
    }),
    relationship: z.nativeEnum(Relationship).openapi({
      description: 'describe the relationship from this table to the foreign table',
    }),
    foreignTableId: z.string().openapi({
      description: 'the table this field is linked to',
    }),
    lookupFieldId: z.string().openapi({
      description: 'the field in the foreign table that will be displayed as the current field',
    }),
    isOneWay: z.boolean().optional().openapi({
      description:
        'whether the field is a one-way link, when true, it will not generate a symmetric field, it is generally has better performance',
    }),
    fkHostTableName: z.string().openapi({
      description:
        'the table name for storing keys, in many-to-many relationships, keys are stored in a separate intermediate table; in other relationships, keys are stored on one side as needed',
    }),
    selfKeyName: z.string().openapi({
      description: 'the name of the field that stores the current table primary key',
    }),
    foreignKeyName: z.string().openapi({
      description: 'The name of the field that stores the foreign table primary key',
    }),
    symmetricFieldId: z.string().optional().openapi({
      description: 'the symmetric field in the foreign table, empty if the field is a one-way link',
    }),
    filterByViewId: z.string().nullable().optional().openapi({
      description: 'the view id that limits the number of records in the link field',
    }),
    visibleFieldIds: z.array(z.string()).nullable().optional().openapi({
      description: 'the fields that will be displayed in the link field',
    }),
    filter: filterSchema.optional(),
  })
  .strip();

export type ILinkFieldOptions = z.infer<typeof linkFieldOptionsSchema>;

export const linkFieldMetaSchema = z.object({
  hasOrderColumn: z.boolean().optional().default(false).openapi({
    description:
      'Whether this link field has an order column for maintaining insertion order. When true, the field uses a separate order column to preserve the order of linked records.',
  }),
});

export type ILinkFieldMeta = z.infer<typeof linkFieldMetaSchema>;

export const linkFieldOptionsRoSchema = linkFieldOptionsSchema
  .pick({
    baseId: true,
    relationship: true,
    foreignTableId: true,
    isOneWay: true,
    filterByViewId: true,
    visibleFieldIds: true,
    filter: true,
  })
  .merge(
    z.object({
      lookupFieldId: z.string().optional(),
    })
  );

export type ILinkFieldOptionsRo = z.infer<typeof linkFieldOptionsRoSchema>;
