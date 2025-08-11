import { z } from '../../../zod';
import { numberFormattingSchema } from '../formatting';
import { numberShowAsSchema } from '../show-as';

// Number field options
export const numberFieldOptionsSchema = z.object({
  formatting: numberFormattingSchema,
  showAs: numberShowAsSchema.optional(),
  defaultValue: z.number().optional(),
});

export const numberFieldOptionsRoSchema = numberFieldOptionsSchema.partial({
  formatting: true,
  showAs: true,
});

export type INumberFieldOptions = z.infer<typeof numberFieldOptionsSchema>;
export type INumberFieldOptionsRo = z.infer<typeof numberFieldOptionsRoSchema>;
