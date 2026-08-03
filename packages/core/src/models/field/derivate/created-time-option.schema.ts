import { z } from '../../../zod';
import { datetimeFormattingSchema } from '../formatting';

export const createdTimeFieldOptionsSchema = z.object({
  expression: z.literal('CREATED_TIME()'),
  formatting: datetimeFormattingSchema,
});

export type ICreatedTimeFieldOptions = z.infer<typeof createdTimeFieldOptionsSchema>;

export const createdTimeFieldOptionsRoSchema = createdTimeFieldOptionsSchema.omit({
  expression: true,
});

export type ICreatedTimeFieldOptionsRo = z.infer<typeof createdTimeFieldOptionsRoSchema>;
