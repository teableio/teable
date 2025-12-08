import { SetMetadata } from '@nestjs/common';
import type { BaseNodeAction } from '../../base-node/types';

export const BASE_NODE_PERMISSIONS_KEY = 'baseNodePermissions';

// eslint-disable-next-line @typescript-eslint/naming-convention
export const BaseNodePermissions = (...permissions: BaseNodeAction[]) =>
  SetMetadata(BASE_NODE_PERMISSIONS_KEY, permissions);
