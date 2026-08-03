import { canManageRole, type IRole } from '@teable/core';

export const getMaxLevelRole = (collaborators: { roleName: string | IRole }[]): IRole => {
  return collaborators.sort((a, b) => {
    return canManageRole(a.roleName as IRole, b.roleName as IRole) ? -1 : 1;
  })[0].roleName as IRole;
};
