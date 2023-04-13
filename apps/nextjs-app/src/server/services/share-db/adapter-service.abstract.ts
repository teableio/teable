import type { ISnapshotBase } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';

export abstract class AdapterService {
  abstract create(
    prisma: Prisma.TransactionClient,
    collection: string,
    snapshot: unknown
  ): Promise<void>;

  abstract update(
    prisma: Prisma.TransactionClient,
    version: number,
    collectionId: string,
    docId: string,
    opContexts: unknown[]
  ): Promise<void>;

  abstract getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    ids: string[],
    projection?: { [fieldKey: string]: boolean },
    extra?: unknown
  ): Promise<ISnapshotBase<unknown>[]>;

  abstract getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    collectionId: string,
    query: unknown
  ): Promise<string[]>;
}
