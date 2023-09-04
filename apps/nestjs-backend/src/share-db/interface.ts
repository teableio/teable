import type { IOtOperation, ISnapshotBase } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { DB } from '@teable/sharedb';
export interface IAdapterService {
  create(prisma: Prisma.TransactionClient, collectionId: string, snapshot: unknown): Promise<void>;

  del(prisma: Prisma.TransactionClient, collectionId: string, docId: string): Promise<void>;

  update(
    prisma: Prisma.TransactionClient,
    version: number,
    collectionId: string,
    docId: string,
    opContexts: unknown[]
  ): Promise<void>;

  getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    ids: string[],
    projection?: { [fieldNameOrId: string]: boolean },
    extra?: unknown
  ): Promise<ISnapshotBase<unknown>[]>;

  getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    query: unknown
  ): Promise<{ ids: string[]; extra?: unknown }>;
}

export interface ISupplementService {
  createForeignKey(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    snapshot: unknown
  ): Promise<unknown>;
}

export interface IShareDbConfig {
  db: DB;
}

export interface IRawOp {
  src: string;
  seq: number;
  op: IOtOperation[];
  v: number;
  m: {
    ts: number;
  };
  c?: string;
  d?: string;
}

export interface IRawOpMap {
  [tableId: string]: {
    [recordId: string]: IRawOp;
  };
}
