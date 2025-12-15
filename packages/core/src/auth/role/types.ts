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

// Billable roles are roles that count towards seat-based billing
// eslint-disable-next-line @typescript-eslint/naming-convention
export const BillableRoles = [Role.Owner, Role.Creator, Role.Editor] as const;

export const roleSchema = z.enum(Role);

export type IRole = z.infer<typeof roleSchema>;
