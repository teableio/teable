import { z } from '../../../zod';

export const longTextShowAsSchema = z.object({
  type: z.literal('markdown'),
});

export type ILongTextShowAs = z.infer<typeof longTextShowAsSchema>;

export const longTextFieldOptionsSchema = z.object({
  showAs: longTextShowAsSchema.optional().nullable(),
  defaultValue: z
    .string()
    .optional()
    .transform((value) => (typeof value === 'string' ? value.trim() : value))
    .optional()
    .nullable(),
});

export type ILongTextFieldOptions = z.infer<typeof longTextFieldOptionsSchema>;
