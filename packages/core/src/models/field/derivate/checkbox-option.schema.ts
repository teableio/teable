import { z } from '../../../zod';

export const checkboxFieldOptionsSchema = z
  .object({ defaultValue: z.boolean().optional().nullable() })
  .strict();

export type ICheckboxFieldOptions = z.infer<typeof checkboxFieldOptionsSchema>;
