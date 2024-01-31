import { getPermissionMap, spacePermissions } from '@teable/core';
import { useBase } from './use-base';

export const useTablePermission = () => {
  const base = useBase();
  return base ? getPermissionMap(base.role) : spacePermissions.viewer;
};
