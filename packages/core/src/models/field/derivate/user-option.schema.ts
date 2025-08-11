import { z } from '../../../zod';

// User field options
export const userFieldOptionsSchema = z.object({
  isMultiple: z.boolean().optional(),
  shouldNotify: z.boolean().optional(),
});

export type IUserFieldOptions = z.infer<typeof userFieldOptionsSchema>;
