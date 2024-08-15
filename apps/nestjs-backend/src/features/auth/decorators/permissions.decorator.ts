import { SetMetadata } from '@nestjs/common';
import type { Action } from '@teable/core';

export const PERMISSIONS_KEY = 'permissions';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const Permissions = (...permissions: Action[]) => SetMetadata(PERMISSIONS_KEY, permissions);
