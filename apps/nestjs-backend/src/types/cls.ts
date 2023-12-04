import type { PermissionAction } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { ClsStore } from 'nestjs-cls';
import type { IRawOpMap } from '../share-db/interface';

export interface IClsStore extends ClsStore {
  user: {
    id: string;
    name: string;
    email: string;
  };
  tx: {
    client?: Prisma.TransactionClient;
    timeStr?: string;
    id?: string;
    rawOpMap?: IRawOpMap;
    stashOpMap?: IRawOpMap;
  };
  shareViewId?: string;
  permissions: PermissionAction[];
}
