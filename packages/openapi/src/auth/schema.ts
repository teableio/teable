import { z } from 'zod';

export const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Minimum 8 chars').openapi({
    description: 'Minimum 8 chars',
  }),
});

export type Signin = z.infer<typeof signinSchema>;

export const signinVoSchema = z.object({
  access_token: z.string(),
});

export type SigninVo = z.infer<typeof signinVoSchema>;

export const signupSchema = signinSchema;

export type Signup = z.infer<typeof signupSchema>;

export const signupVoSchema = signinVoSchema;

export type SignupVo = z.infer<typeof signupVoSchema>;

export const userMeVoSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().nullable().optional(),
  email: z.string().email(),
  phone: z.string().nullable().optional(),
});

export type UserMeVo = z.infer<typeof userMeVoSchema>;
