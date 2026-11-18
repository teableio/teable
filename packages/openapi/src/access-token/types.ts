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
  /**
   * Set when the token may depend on a key/iv the server no longer issues under. `stopped`: its
   * sign records a key/iv that is no longer accepted at all, so the token no longer works.
   * Otherwise it still works: its sign records an older key/iv, or records none (it was issued
   * before signs did) while the server still decrypts with an older key/iv. This is then only set
   * when it has over 7 days left, and, unless that key/iv may be one the server keeps only until
   * a key rotation is over, when it is meant to live long (valid for over 80 days).
   * Regenerating the token clears it.
   */
  legacyCipher: z.object({ stopped: z.boolean() }).optional(),
});

export type AccessTokenItem = z.infer<typeof accessTokenItemSchema>;
