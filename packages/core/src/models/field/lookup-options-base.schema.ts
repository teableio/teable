import { z } from '../../zod';
import { filterSchema } from '../view/filter';
import { Relationship } from './constant';

export const lookupOptionsVoSchema = z.object({
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
  filter: filterSchema.optional(),
  linkFieldId: z.string().openapi({
    description: 'The id of Linked record field to use for lookup',
  }),
});

export const lookupOptionsRoSchema = lookupOptionsVoSchema.pick({
  foreignTableId: true,
  lookupFieldId: true,
  linkFieldId: true,
  filter: true,
});

export type ILookupOptionsVo = z.infer<typeof lookupOptionsVoSchema>;
export type ILookupOptionsRo = z.infer<typeof lookupOptionsRoSchema>;
