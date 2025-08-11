import { z } from '../../../zod';
import { timeZoneStringSchema, unionFormattingSchema } from '../formatting';
import { unionShowAsSchema } from '../show-as';

export const formulaFieldOptionsSchema = z.object({
  expression: z.string().openapi({
    description:
      'The formula including fields referenced by their IDs. For example, LEFT(4, {Birthday}) input will be returned as LEFT(4, {fldXXX}) via API.',
  }),
  timeZone: timeZoneStringSchema.optional(),
  formatting: unionFormattingSchema.optional(),
  showAs: unionShowAsSchema.optional(),
});

export type IFormulaFieldOptions = z.infer<typeof formulaFieldOptionsSchema>;

export const formulaFieldMetaSchema = z.object({
  persistedAsGeneratedColumn: z.boolean().optional().default(false).openapi({
    description:
      'Whether this formula field is persisted as a generated column in the database. When true, the field value is computed and stored as a database generated column.',
  }),
});

export type IFormulaFieldMeta = z.infer<typeof formulaFieldMetaSchema>;
