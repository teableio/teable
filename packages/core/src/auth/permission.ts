/* eslint-disable @typescript-eslint/naming-convention */
/**
 * TODO: need to distinguish between the resources that this role targets, such as spaceRole or baseRole
 */
import { keys } from 'lodash';
import type { Action } from './actions';
import { Role, RolePermission } from './role';
import type { IRole } from './role/types';

export const checkPermissions = (role: IRole, actions: Action[]) => {
  return actions.every((action) => Boolean(RolePermission[role][action]));
};

export const getPermissions = (role: IRole) => {
  const permissionMap = getPermissionMap(role);
  return (keys(permissionMap) as Action[]).filter((key) => permissionMap[key]);
};

export const getPermissionMap = (role: IRole) => {
  return RolePermission[role];
};

export const hasPermission = (role: IRole, action: Action) => {
  return checkPermissions(role, [action]);
};

export const isRestrictedRole = (role: IRole) => {
  return role !== Role.Owner;
};
