import { z } from '../../../zod';
import { datetimeFormattingSchema } from '../formatting';

// Last modified time field options
export const lastModifiedTimeFieldOptionsSchema = z.object({
  expression: z.literal('LAST_MODIFIED_TIME()'),
  formatting: datetimeFormattingSchema,
});

export type ILastModifiedTimeFieldOptions = z.infer<typeof lastModifiedTimeFieldOptionsSchema>;

export const lastModifiedTimeFieldOptionsRoSchema = lastModifiedTimeFieldOptionsSchema.omit({
  expression: true,
});

export type ILastModifiedTimeFieldOptionsRo = z.infer<typeof lastModifiedTimeFieldOptionsRoSchema>;
