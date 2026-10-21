import { BillableRoles, RoleLevel } from './types';

export const canManageRole = (managerRole: string, targetRole: string) => {
  return RoleLevel.indexOf(managerRole) < RoleLevel.indexOf(targetRole);
};

export const isBillableRole = (role: string) => {
  return (BillableRoles as readonly string[]).includes(role);
};
