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
    id?: string;
    rawOpMap?: IRawOpMap;
  };
}
