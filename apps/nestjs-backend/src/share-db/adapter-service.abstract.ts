import type { ISnapshotBase, ISnapshotQuery } from '@teable-group/core';
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
    collection: string,
    docId: string,
    opContext: unknown
  ): Promise<void>;

  abstract getSnapshotBulk(
    prisma: Prisma.TransactionClient,
    collection: string,
    ids: string[],
    projection?: { [fieldKey: string]: boolean },
    extra?: unknown
  ): Promise<ISnapshotBase<unknown>[]>;

  abstract getDocIdsByQuery(
    prisma: Prisma.TransactionClient,
    collection: string,
    query: ISnapshotQuery
  ): Promise<string[]>;
}
