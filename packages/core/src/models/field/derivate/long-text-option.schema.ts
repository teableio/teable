import { z } from '../../../zod';

export const longTextFieldOptionsSchema = z
  .object({
    defaultValue: z
      .string()
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim() : value))
      .optional(),
  })
  .strict();

export type ILongTextFieldOptions = z.infer<typeof longTextFieldOptionsSchema>;
