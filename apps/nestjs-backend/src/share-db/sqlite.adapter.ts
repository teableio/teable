import { Injectable } from '@nestjs/common';
import type { IOtOperation, IRecord, IRecordSnapshotQuery } from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import type { CreateOp, DeleteOp, EditOp } from '@teable/sharedb';
import ShareDb from '@teable/sharedb';
import type { SnapshotMeta } from '@teable/sharedb/lib/sharedb';
import { groupBy } from 'lodash';
import { FieldService } from '../features/field/field.service';
import { RecordService } from '../features/record/record.service';
import { TableService } from '../features/table/table.service';
import { ViewService } from '../features/view/view.service';
import { PrismaService } from '../prisma.service';
import type { AdapterService } from './adapter-service.abstract';
import { TransactionService } from './transaction.service';

export interface ICollectionSnapshot {
  type: string;
  v: number;
  data: IRecord;
}

type IProjection = { [fieldKey: string]: boolean };

interface IOptions {
  transactionKey?: string;
  opCounter: number;
}

@Injectable()
export class SqliteDbAdapter extends ShareDb.DB {
  closed: boolean;

  constructor(
    private readonly tableService: TableService,
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly viewService: ViewService,
    private readonly prismaService: PrismaService,
    private readonly transactionService: TransactionService
  ) {
    super();
    this.closed = false;
  }

  getService(type: IdPrefix): AdapterService {
    switch (type) {
      case IdPrefix.View:
        return this.viewService;
      case IdPrefix.Field:
        return this.fieldService;
      case IdPrefix.Record:
        return this.recordService;
      case IdPrefix.Table:
        return this.tableService;
    }
    throw new Error(`QueryType: ${type} has no service implementation`);
  }

  query = async (
    collection: string,
    query: unknown,
    projection: IProjection,
    options: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (err: any, snapshots: Snapshot[], extra?: any) => void
  ) => {
    // console.log(`query: ${collection} ${JSON.stringify(query)}`);
    this.queryPoll(collection, query, options, (error, results) => {
      // console.log('query pull result: ', ids);
      if (error) {
        return callback(error, []);
      }
      if (!results.length) {
        return callback(undefined, []);
      }

      this.getSnapshotBulk(
        collection,
        results as string[],
        projection,
        undefined,
        (error, snapshots) => {
          callback(
            error,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            results.map((id) => snapshots![id])
          );
        }
      );
    });
  };

  async queryPoll(
    collection: string,
    query: unknown,
    _options: unknown,
    callback: (error: ShareDb.Error | null, ids: string[]) => void
  ) {
    // console.log('queryPoll:', collection, query);
    try {
      const [docType, collectionId] = collection.split('_');

      const ids = await this.getService(docType as IdPrefix).getDocIdsByQuery(
        this.prismaService,
        collectionId,
        query
      );
      // console.log('queryPollResult:', collection, ids);
      callback(null, ids);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback(e as any, []);
    }
  }

  // Return true to avoid polling if there is no possibility that an op could
  // affect a query's results
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  skipPoll(
    _collection: string,
    _id: string,
    op: CreateOp | DeleteOp | EditOp,
    _query: IRecordSnapshotQuery
  ): boolean {
    // ShareDB is in charge of doing the validation of ops, so at this point we
    // should be able to assume that the op is structured validly
    if (op.create || op.del) return false;
    return !op.op;
  }

  close(callback: () => void) {
    this.closed = true;

    if (callback) callback();
  }

  private async updateSnapshot(
    prisma: Prisma.TransactionClient,
    version: number,
    collection: string,
    docId: string,
    ops: IOtOperation[]
  ) {
    const [docType, collectionId] = collection.split('_');
    const ops2Contexts = OpBuilder.ops2Contexts(ops);
    const service = this.getService(docType as IdPrefix);
    // group by op name execute faster
    const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
    for (const opName in ops2ContextsGrouped) {
      const opContexts = ops2ContextsGrouped[opName];
      await service.update(prisma, version, collectionId, docId, opContexts);
    }
  }

  private async createSnapshot(
    prisma: Prisma.TransactionClient,
    collection: string,
    _docId: string,
    snapshot: unknown
  ) {
    const [docType, collectionId] = collection.split('_');
    await this.getService(docType as IdPrefix).create(prisma, collectionId, snapshot);
  }

  // Persists an op and snapshot if it is for the next version. Calls back with
  // callback(err, succeeded)
  async commit(
    collection: string,
    id: string,
    rawOp: CreateOp | DeleteOp | EditOp,
    snapshot: ICollectionSnapshot,
    options: { transactionKey: string; opCount: number },
    callback: (err: unknown, succeed?: boolean) => void
  ) {
    /*
     * op: CreateOp {
     *   src: '24545654654646',
     *   seq: 1,
     *   v: 0,
     *   create: { type: 'http://sharejs.org/types/JSONv0', data: { ... } },
     *   m: { ts: 12333456456 } }
     * }
     * snapshot: PostgresSnapshot
     */

    // console.log('commit', collection, id, rawOp, options);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, collectionId] = collection.split('_');
    const prisma = await this.transactionService.getTransaction(options);

    try {
      const opsResult = await prisma.ops.aggregate({
        _max: { version: true },
        where: { collection: collectionId, docId: id },
      });

      const maxVersion = opsResult._max.version || 0;

      if (snapshot.v !== maxVersion + 1) {
        throw new Error(`version mismatch: maxVersion: ${maxVersion} snapshotV: ${snapshot.v}`);
      }

      // 1. save op in db;
      await prisma.ops.create({
        data: {
          docId: id,
          collection: collectionId,
          version: snapshot.v,
          operation: JSON.stringify(rawOp),
        },
      });

      // create snapshot
      if (rawOp.create) {
        await this.createSnapshot(prisma, collection, id, rawOp.create.data);
      }

      // update snapshot
      if (rawOp.op) {
        await this.updateSnapshot(prisma, snapshot.v, collection, id, rawOp.op);
      }

      await this.transactionService.taskComplete(undefined, options);
      callback(null, true);
    } catch (err) {
      await this.transactionService.taskComplete(err, options);
      callback(err);
    }
  }

  private snapshots2Map<T>(snapshots: ({ id: string } & T)[]): Record<string, T> {
    return snapshots.reduce<Record<string, T>>((pre, cur) => {
      pre[cur.id] = cur;
      return pre;
    }, {});
  }

  // Get the named document from the database. The callback is called with (err,
  // snapshot). A snapshot with a version of zero is returned if the document
  // has never been created in the database.
  async getSnapshotBulk(
    collection: string,
    ids: string[],
    projection: IProjection | undefined,
    options: IOptions | undefined,
    callback: (err: ShareDb.Error | null, data?: Record<string, Snapshot>) => void
  ) {
    // console.log('getSnapshotBulk:', collection, ids);
    try {
      const [docType, collectionId] = collection.split('_');
      const prisma = await this.transactionService.getTransaction(options);

      const snapshotData = await this.getService(docType as IdPrefix).getSnapshotBulk(
        prisma,
        collectionId,
        ids,
        projection && projection['$submit'] ? undefined : projection
      );

      if (snapshotData.length) {
        const snapshots = snapshotData.map(
          (snapshot) =>
            new Snapshot(
              snapshot.id,
              snapshot.v,
              snapshot.type,
              snapshot.data,
              null // TODO: metadata
            )
        );
        callback(null, this.snapshots2Map(snapshots));
      } else {
        const snapshots = ids.map((id) => new Snapshot(id, 0, null, undefined, null));
        callback(null, this.snapshots2Map(snapshots));
      }
    } catch (err) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback(err as any);
    }
  }

  async getSnapshot(
    collection: string,
    id: string,
    projection: IProjection | undefined,
    options: IOptions | undefined,
    callback: (err: unknown, data?: Snapshot) => void
  ) {
    this.getSnapshotBulk(collection, [id], projection, options, (err, data) => {
      if (err) {
        callback(err);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        callback(null, data![id]);
      }
    });
  }

  // Get operations between [from, to) non-inclusively. (Ie, the range should
  // contain start but not end).
  //
  // If end is null, this function should return all operations from start onwards.
  //
  // The operations that getOps returns don't need to have a version: field.
  // The version will be inferred from the parameters if it is missing.
  //
  // Callback should be called as callback(error, [list of ops]);
  async getOps(
    collection: string,
    id: string,
    from: number,
    to: number,
    options: IOptions | undefined,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, collectionId] = collection.split('_');
      const prisma = await this.transactionService.getTransaction(options);
      const res = await prisma.$queryRawUnsafe<
        { collection: string; id: string; from: number; to: number; operation: string }[]
      >(
        'SELECT version, operation FROM ops WHERE collection = ? AND doc_id = ? AND version >= ? AND version < ?',
        collectionId,
        id,
        from,
        to
      );

      callback(
        null,
        res.map(function (row) {
          return JSON.parse(row.operation);
        })
      );
    } catch (err) {
      callback(err);
    }
  }
}

class Snapshot implements ShareDb.Snapshot {
  constructor(
    public id: string,
    public v: number,
    public type: string | null,
    public data: unknown,
    public m: SnapshotMeta | null
  ) {}
}
