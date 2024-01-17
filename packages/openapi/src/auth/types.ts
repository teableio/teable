import { z } from '../zod';

export const passwordSchema = z.string().min(8, 'Minimum 8 chars').openapi({
  description: 'Minimum 8 chars',
});
