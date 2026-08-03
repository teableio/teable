import type { IRole } from '@teable/core';
import { useMemo } from 'react';
import { useRoleStatic } from '../useRoleStatic';
import { getRolesWithLowerPermissions } from '../utils';

export const useFilteredRoleStatic = (role: IRole) => {
  const spaceRoleStatic = useRoleStatic();
  return useMemo(
    () => getRolesWithLowerPermissions(role, spaceRoleStatic),
    [role, spaceRoleStatic]
  );
};
