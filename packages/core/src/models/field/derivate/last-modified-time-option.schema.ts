import { z } from '../../../zod';
import { datetimeFormattingSchema } from '../formatting';

export const lastModifiedTimeFieldOptionsSchema = z
  .object({
    expression: z.literal('LAST_MODIFIED_TIME()').default('LAST_MODIFIED_TIME()'),
    formatting: datetimeFormattingSchema.optional(),
    trackedFieldIds: z.array(z.string()).optional(),
  })
  .passthrough();

export type ILastModifiedTimeFieldOptions = z.infer<typeof lastModifiedTimeFieldOptionsSchema>;

export const lastModifiedTimeFieldOptionsRoSchema = lastModifiedTimeFieldOptionsSchema;

export type ILastModifiedTimeFieldOptionsRo = z.infer<typeof lastModifiedTimeFieldOptionsRoSchema>;
