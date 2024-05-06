/* eslint-disable @typescript-eslint/naming-convention */
/**
 * TODO: need to distinguish between the resources that this role targets, such as spaceRole or baseRole
 */
import { keys } from 'lodash';
import type { AllActions } from './actions';
import type { BaseRole, TableRole, SpaceRole } from './role';
import { basePermissions, shareViewPermissions, spacePermissions, tablePermissions } from './role';
import { RoleType } from './types';

export type PermissionAction = AllActions;

export type PermissionMap = Record<PermissionAction, boolean>;

export const checkPermissions = (role: SpaceRole, actions: PermissionAction[]) => {
  return actions.every((action) => Boolean(spacePermissions[role][action]));
};

export const getPermissions = (type: RoleType, role?: SpaceRole | BaseRole | TableRole) => {
  const permissionMap = getPermissionMap(type, role);
  return (keys(permissionMap) as PermissionAction[]).filter((key) => permissionMap[key]);
};

export const getPermissionMap = (
  type: RoleType,
  role?: SpaceRole | BaseRole | TableRole
): PermissionMap => {
  switch (type) {
    case RoleType.Space:
      return spacePermissions[role as SpaceRole] as PermissionMap;
    case RoleType.Base: {
      return basePermissions[role as BaseRole] as PermissionMap;
    }
    case RoleType.Table:
      return tablePermissions[role as TableRole] as PermissionMap;
    case RoleType.Share:
      return shareViewPermissions as PermissionMap;
    default:
      return {} as PermissionMap;
  }
};

export const hasPermission = (role: SpaceRole, action: PermissionAction) => {
  return checkPermissions(role, [action]);
};
