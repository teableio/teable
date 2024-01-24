/* eslint-disable @typescript-eslint/naming-convention */

import { keys, pickBy } from 'lodash';
import type { AllActions } from './actions';
import type { SpaceRole } from './role';
import { spacePermissions } from './role';

export type PermissionAction = AllActions;

export type PermissionMap = Record<PermissionAction, boolean>;

export const checkPermissions = (role: SpaceRole, actions: PermissionAction[]) => {
  return actions.every((action) => Boolean(spacePermissions[role][action]));
};

export const getPermissions = (role: SpaceRole) => {
  const result = pickBy(spacePermissions[role], (value) => value);
  return keys(result) as PermissionAction[];
};

export const getPermissionMap = (role: SpaceRole) => {
  return spacePermissions[role] as PermissionMap;
};

export const hasPermission = (role: SpaceRole, action: PermissionAction) => {
  return checkPermissions(role, [action]);
};
