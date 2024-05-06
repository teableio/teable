import { RoleType, getPermissionMap, spacePermissions } from '@teable/core';
import { useBase } from './use-base';

export const useTablePermission = () => {
  const base = useBase();
  return base ? getPermissionMap(RoleType.Base, base.role) : spacePermissions.viewer;
};
