import { z } from '../zod';

export const accessTokenItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  scopes: z.array(z.string()),
  spaceIds: z.array(z.string()).optional(),
  baseIds: z.array(z.string()).optional(),
  hasFullAccess: z.boolean().optional(),
  expiredTime: z.string(),
  createdTime: z.string(),
  lastUsedTime: z.string().optional(),
});

export type AccessTokenItem = z.infer<typeof accessTokenItemSchema>;
