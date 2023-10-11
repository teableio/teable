import type { Prisma } from '@teable-group/db-main-prisma';
import type { ClsStore } from 'nestjs-cls';

export interface IClsStore extends ClsStore {
  user: {
    id: string;
    name: string;
    email: string;
  };
  tx: {
    client?: Prisma.TransactionClient;
    id?: string;
  };
}
