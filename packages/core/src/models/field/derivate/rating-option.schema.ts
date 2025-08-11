import { z } from '../../../zod';

// Rating field options
export const ratingFieldOptionsSchema = z.object({
  icon: z.string().optional(),
  max: z.number().int().min(1).max(10).optional(),
  color: z.string().optional(),
});

export type IRatingFieldOptions = z.infer<typeof ratingFieldOptionsSchema>;
