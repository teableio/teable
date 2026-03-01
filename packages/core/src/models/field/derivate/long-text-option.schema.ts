import { z } from '../../../zod';
import { longTextShowAsSchema } from '../show-as';

export const longTextFieldOptionsSchema = z.object({
  showAs: longTextShowAsSchema.optional(),
  defaultValue: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .optional()
    .nullable(),
});

export type ILongTextFieldOptions = z.infer<typeof longTextFieldOptionsSchema>;
