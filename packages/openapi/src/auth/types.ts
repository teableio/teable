import { z } from '../zod';

export const passwordSchema = z.string().min(8).openapi({
  description: 'Minimum 8 chars',
});

export const signupPasswordSchema = passwordSchema.regex(
  /^(?=.*[A-Z])(?=.*\d).{8,}$/i,
  'Must contain at least one letter and one number'
);
