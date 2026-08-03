import { RoleLevel } from './types';

export const canManageRole = (managerRole: string, targetRole: string) => {
  return RoleLevel.indexOf(managerRole) < RoleLevel.indexOf(targetRole);
};
