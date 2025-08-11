import { z } from '../../../zod';

// Long text field options
export const longTextFieldOptionsSchema = z
  .object({
    defaultValue: z
      .string()
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim() : value)),
  })
  .strict();

export type ILongTextFieldOptions = z.infer<typeof longTextFieldOptionsSchema>;
