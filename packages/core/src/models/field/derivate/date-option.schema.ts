import { z } from '../../../zod';
import { datetimeFormattingSchema } from '../formatting';

export const dateFieldOptionsSchema = z.object({
  formatting: datetimeFormattingSchema,
  defaultValue: z
    .enum(['now'] as const)
    .optional()
    .openapi({
      description:
        'Whether the new row is automatically filled with the current time, caveat: the defaultValue is just a flag, it dose not effect the storing value of the record',
    }),
});

export type IDateFieldOptions = z.infer<typeof dateFieldOptionsSchema>;
