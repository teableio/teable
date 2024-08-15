import type { IRole } from '@teable/core';
import type { ISpaceRoleStatic } from '@teable/sdk/hooks';

export const getRolesWithLowerPermissions = (
  role: IRole,
  spaceRoleStatic: ISpaceRoleStatic[],
  includeRole: boolean = true
) => {
  const roleLevel = spaceRoleStatic.find((spaceRole) => spaceRole.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return spaceRoleStatic.filter(({ level }) =>
    includeRole ? level >= roleLevel : level > roleLevel
  );
};

export const getRolesWithHigherPermissions = (
  role: IRole,
  spaceRoleStatic: ISpaceRoleStatic[],
  includeRole: boolean = true
) => {
  const roleLevel = spaceRoleStatic.find((spaceRole) => spaceRole.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return spaceRoleStatic.filter(({ level }) =>
    includeRole ? level <= roleLevel : level < roleLevel
  );
};
