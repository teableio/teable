import { z } from '../../../zod';

export const autoNumberFieldOptionsSchema = z.object({
  expression: z.literal('AUTO_NUMBER()'),
});

export type IAutoNumberFieldOptions = z.infer<typeof autoNumberFieldOptionsSchema>;

export const autoNumberFieldOptionsRoSchema = autoNumberFieldOptionsSchema.omit({
  expression: true,
});

export type IAutoNumberFieldOptionsRo = z.infer<typeof autoNumberFieldOptionsRoSchema>;
