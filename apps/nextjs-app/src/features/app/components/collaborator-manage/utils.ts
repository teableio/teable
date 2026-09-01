import type { IRole } from '@teable/core';
import { Role } from '@teable/core';
import type { CollaboratorItem, UniqueCollaboratorItem } from '@teable/openapi';
import { CollaboratorType, PrincipalType, z } from '@teable/openapi';
import type { IRoleStatic } from './types';

// Page size for lazily fetching one principal's permission rows. A principal
// can hold at most one row per base plus the space row, so this only
// truncates for spaces with more than ~500 bases granted to one principal.
export const PRINCIPAL_PERMISSIONS_TAKE = 512;

export const getUniqueCollaboratorPrincipalId = (collaborator: UniqueCollaboratorItem) =>
  collaborator.type === PrincipalType.User ? collaborator.userId : collaborator.departmentId;

// Present a principal-level item as its space-level collaborator row so
// row-based components (role select, avatars, permission callbacks) can
// consume it. For base-only principals (spaceRole null) the role falls back
// to Viewer — such synthetic rows are for display only, never for mutations.
export const uniqueCollaboratorToSpaceItem = (item: UniqueCollaboratorItem): CollaboratorItem => {
  const role = item.spaceRole ?? Role.Viewer;
  if (item.type === PrincipalType.User) {
    return {
      type: PrincipalType.User,
      resourceType: CollaboratorType.Space,
      userId: item.userId,
      userName: item.userName,
      email: item.email,
      avatar: item.avatar,
      isSystem: item.isSystem,
      billable: item.billable,
      role,
      createdTime: item.createdTime,
      lastSignTime: item.lastSignTime,
    };
  }
  return {
    type: PrincipalType.Department,
    resourceType: CollaboratorType.Space,
    departmentId: item.departmentId,
    departmentName: item.departmentName,
    role,
    createdTime: item.createdTime,
  };
};

export const getRolesWithLowerPermissions = (
  role: IRole,
  roleStatic: IRoleStatic[],
  includeRole: boolean = true
) => {
  const roleLevel = roleStatic.find((item) => item.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return roleStatic.filter(({ level }) => (includeRole ? level >= roleLevel : level > roleLevel));
};

export const getRolesWithHigherPermissions = (
  role: IRole,
  roleStatic: IRoleStatic[],
  includeRole: boolean = true
) => {
  const roleLevel = roleStatic.find((item) => item.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return roleStatic.filter(({ level }) => (includeRole ? level <= roleLevel : level < roleLevel));
};

export const filterCollaborators = <T extends { userName: string; email: string }>(
  search: string,
  collaborators?: T[]
) => {
  if (!search) return collaborators;
  return collaborators?.filter(({ userName, email }) => {
    const searchLower = search.toLowerCase();
    const usernameLower = userName.toLowerCase();
    const emailLower = email.toLowerCase();
    return !search || usernameLower.includes(searchLower) || emailLower.includes(searchLower);
  });
};

/**
 * Trimmed, case-insensitive identity of a mailbox. Every provider that matters
 * treats a mailbox that way, and the invitation API lowercases the whole batch
 * before it looks anyone up — so two spellings of one address are one
 * invitation, and asking for both is a request it cannot fulfil (it fails the
 * batch outright when the address has no account yet).
 */
export const emailKey = (value: string) => value.trim().toLowerCase();

export const isInviteEmailValid = (value: string) =>
  z.string().email().safeParse(value.trim()).success;

/**
 * The list with `value` appended — or unchanged when it already holds that
 * mailbox. Only the comparison is normalised: what the user typed is what gets
 * kept and sent, so an address they capitalised on purpose still reads back as
 * theirs.
 */
export const withInviteEmail = (emails: string[], value: string) => {
  const address = value.trim();
  return emails.some((email) => emailKey(email) === emailKey(address))
    ? emails
    : emails.concat(address);
};
