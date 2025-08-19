import { roleSchema } from '@teable/core';
import { z } from '../zod';

export enum CollaboratorType {
  Space = 'space',
  Base = 'base',
}

export enum PrincipalType {
  User = 'user',
  Department = 'department',
}

export const userCollaboratorItem = z.object({
  userId: z.string(),
  userName: z.string(),
  email: z.string(),
  role: roleSchema,
  avatar: z.string().nullable(),
  createdTime: z.string(),
  type: z.literal(PrincipalType.User),
  resourceType: z.nativeEnum(CollaboratorType),
  isSystem: z.boolean().optional(),
  billable: z.boolean().optional(),
  base: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

export type UserCollaboratorItem = z.infer<typeof userCollaboratorItem>;

export const departmentCollaboratorItem = z.object({
  departmentId: z.string(),
  departmentName: z.string(),
  role: roleSchema,
  createdTime: z.string(),
  type: z.literal(PrincipalType.Department),
  resourceType: z.nativeEnum(CollaboratorType),
  base: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

export type DepartmentCollaboratorItem = z.infer<typeof departmentCollaboratorItem>;

export const collaboratorItem = z.discriminatedUnion('type', [
  userCollaboratorItem,
  departmentCollaboratorItem,
]);

export type CollaboratorItem = z.infer<typeof collaboratorItem>;
