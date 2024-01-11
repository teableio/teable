import { z } from 'zod';

export const extraFilterSchema = z.object({
  withUserId: z.string().optional(),
});
