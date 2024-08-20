import type { IRole } from '@teable/core';
import type { IRoleStatic } from './types';

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
