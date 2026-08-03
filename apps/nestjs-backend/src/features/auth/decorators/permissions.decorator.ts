import { SetMetadata } from '@nestjs/common';
import type { Action } from '@teable/core';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSIONS_KEY = 'anyPermissions';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Permissions = (...permissions: Action[]) => SetMetadata(PERMISSIONS_KEY, permissions);

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AnyPermissions = (...permissionGroups: Action[][]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissionGroups);
