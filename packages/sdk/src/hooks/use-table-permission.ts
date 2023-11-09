import { getPermissionMap } from '@teable-group/core';
import { useBase } from './use-base';

export const useTablePermission = () => {
  const base = useBase();
  return getPermissionMap(base.role);
};
