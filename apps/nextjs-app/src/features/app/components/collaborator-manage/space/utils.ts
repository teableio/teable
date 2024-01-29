import type { SpaceRole } from '@teable-group/core';
import type { ISpaceRoleStatic } from '@teable-group/sdk/hooks';

export const getRolesWithLowerPermissions = (
  role: SpaceRole,
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
  role: SpaceRole,
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
