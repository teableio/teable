import { z } from '../../../zod';
import { numberFormattingSchema } from '../formatting';
import { numberShowAsSchema } from '../show-as';

export const numberFieldOptionsSchema = z.object({
  formatting: numberFormattingSchema,
  showAs: numberShowAsSchema.optional(),
  defaultValue: z.number().optional(),
});

export const numberFieldOptionsRoSchema = numberFieldOptionsSchema.partial({
  formatting: true,
  showAs: true,
});

export type INumberFieldOptionsRo = z.infer<typeof numberFieldOptionsRoSchema>;

export type INumberFieldOptions = z.infer<typeof numberFieldOptionsSchema>;
