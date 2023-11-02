import type { SpaceRole } from '../../auth';
import { SPACE_ROLE_LIST } from './constant';

export const getRolesWithLowerPermissions = (role: SpaceRole, includeRole: boolean = true) => {
  const roleLevel = SPACE_ROLE_LIST.find((spaceRole) => spaceRole.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return SPACE_ROLE_LIST.filter(({ level }) =>
    includeRole ? level >= roleLevel : level > roleLevel
  );
};

export const getRolesWithHigherPermissions = (role: SpaceRole, includeRole: boolean = true) => {
  const roleLevel = SPACE_ROLE_LIST.find((spaceRole) => spaceRole.role === role)?.level;
  if (roleLevel == undefined) {
    return [];
  }
  return SPACE_ROLE_LIST.filter(({ level }) =>
    includeRole ? level <= roleLevel : level < roleLevel
  );
};
