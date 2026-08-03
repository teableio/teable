import { z } from '../../../zod';
import { singleLineTextShowAsSchema } from '../show-as';

export const singlelineTextFieldOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z
    .string()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .optional()
    .nullable(),
});

export type ISingleLineTextFieldOptions = z.infer<typeof singlelineTextFieldOptionsSchema>;
