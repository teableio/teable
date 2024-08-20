import { z } from '../../zod';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Role = {
  Owner: 'owner',
  Creator: 'creator',
  Editor: 'editor',
  Commenter: 'commenter',
  Viewer: 'viewer',
} as const;

// eslint-disable-next-line @typescript-eslint/naming-convention
export const RoleLevel = ['owner', 'creator', 'editor', 'commenter', 'viewer'];

export const roleSchema = z.nativeEnum(Role);

export type IRole = z.infer<typeof roleSchema>;
