import { z } from '../../../zod';
import { singleLineTextShowAsSchema } from '../show-as';

export const singlelineTextFieldOptionsSchema = z.object({
  showAs: singleLineTextShowAsSchema.optional(),
  defaultValue: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : value)),
});

export type ISingleLineTextFieldOptions = z.infer<typeof singlelineTextFieldOptionsSchema>;
