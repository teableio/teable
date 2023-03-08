import { Injectable } from '@nestjs/common';
import type {
  IOtOperation,
  IRecord,
  IRecordSnapshotQuery,
  IFieldSnapshotQuery,
  IAggregateQuery,
  ISnapshotQuery,
  ISnapshotBase,
} from '@teable-group/core';
import { IdPrefix, OpBuilder } from '@teable-group/core';
import type { Prisma } from '@teable-group/db-main-prisma';
import { groupBy } from 'lodash';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { SnapshotMeta } from 'sharedb/lib/sharedb';
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
    query: IRecordSnapshotQuery | IFieldSnapshotQuery | IAggregateQuery,
    projection: IProjection,
    options: unknown,
    callback: ShareDb.DBQueryCallback
  ) => {
    console.log(`query: ${collection}`);
    this.queryPoll(collection, query, options, (error, results) => {
      // console.log('query pull result: ', ids);
      if (error) {
        return callback(error, []);
      }
      this.getSnapshotBulk(
        collection,
        results as string[],
        projection,
        options,
        (error, snapshots) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          callback(error, snapshots!);
        }
      );
    });
  };

  // return a specific id for row count fetch
  private async getAggregateIds(
    prisma: Prisma.TransactionClient,
    collection: string,
    query: IAggregateQuery
  ) {
    let viewId = query.viewId;
    if (!viewId) {
      const view = await prisma.view.findFirstOrThrow({
        where: { tableId: collection },
        select: { id: true },
      });
      viewId = view.id;
    }
    return [`${query.aggregateKey}_${viewId}`];
  }

  async queryPoll(
    collection: string,
    query: ISnapshotQuery,
    _options: unknown,
    callback: (error: ShareDb.Error | null, ids: string[]) => void
  ) {
    try {
      const prisma = this.transactionService.get(collection) || this.prismaService;

      if (query.type === IdPrefix.Aggregate) {
        const ids = await this.getAggregateIds(prisma, collection, query);
        callback(null, ids);
        return;
      }

      const ids = await this.getService(query.type).getDocIdsByQuery(prisma, collection, query);
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
    const docType = docId.slice(0, 3) as IdPrefix;
    const ops2Contexts = OpBuilder.ops2Contexts(ops);
    const service = this.getService(docType);
    // group by op name execute faster
    const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
    for (const opName in ops2ContextsGrouped) {
      const opContexts = ops2ContextsGrouped[opName];
      await service.update(prisma, version, collection, docId, opContexts);
    }
  }

  private async createSnapshot(
    prisma: Prisma.TransactionClient,
    collection: string,
    docId: string,
    snapshot: unknown
  ) {
    const docType = docId.slice(0, 3) as IdPrefix;
    await this.getService(docType).create(prisma, collection, snapshot);
  }

  // Persists an op and snapshot if it is for the next version. Calls back with
  // callback(err, succeeded)
  async commit(
    collection: string,
    id: string,
    rawOp: CreateOp | DeleteOp | EditOp,
    snapshot: ICollectionSnapshot,
    options: unknown,
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

    // console.log('commit', collection, id, rawOp, snapshot);

    let endTransaction = (_?: unknown): void => undefined;
    let prisma = this.transactionService.get(collection);
    if (!prisma) {
      console.log('new transaction');
      const newTran = await this.transactionService.newTransaction();
      prisma = newTran.prisma;
      endTransaction = newTran.endTransaction;
    }

    try {
      const opsResult = await prisma.ops.aggregate({
        _max: { version: true },
        where: { collection, docId: id },
      });

      const maxVersion = opsResult._max.version || 0;

      if (snapshot.v !== maxVersion + 1) {
        throw new Error(`version mismatch: maxVersion: ${maxVersion} snapshotV: ${snapshot.v}`);
      }

      // 1. save op in db;
      await prisma.ops.create({
        data: {
          docId: id,
          collection,
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

      endTransaction();
      callback(null, true);
    } catch (err) {
      endTransaction(err);
      callback(err);
    }
  }

  // Get the named document from the database. The callback is called with (err,
  // snapshot). A snapshot with a version of zero is returned if the document
  // has never been created in the database.
  async getSnapshotBulk(
    collection: string,
    ids: string[],
    projection: IProjection | undefined,
    options: unknown,
    callback: (err: ShareDb.Error | null, data?: Snapshot[]) => void
  ) {
    // console.log('getSnapshotBulk:', collection, ids);
    try {
      const prisma = this.transactionService.get(collection) || this.prismaService;
      let docType: IdPrefix;
      if (collection === 'node') {
        docType = IdPrefix.Table;
      } else {
        docType = ids[0].slice(0, 3) as IdPrefix;
        if (ids.find((id) => id.slice(0, 3) !== docType)) {
          throw new Error('get snapshot bulk ids must be same type');
        }
      }

      let snapshotData: ISnapshotBase[] = [];
      if (docType === IdPrefix.Aggregate) {
        snapshotData = await this.recordService.getAggregateBulk(prisma, collection, ids);
      } else {
        snapshotData = await this.getService(docType).getSnapshotBulk(
          prisma,
          collection,
          ids,
          projection && projection['$submit'] ? undefined : projection
        );
      }

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
        callback(null, snapshots);
      } else {
        const snapshots = ids.map((id) => new Snapshot(id, 0, null, undefined, null));
        callback(null, snapshots);
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
    options: unknown,
    callback: (err: unknown, data?: Snapshot) => void
  ) {
    this.getSnapshotBulk(collection, [id], projection, options, (err, data) => {
      if (err) {
        callback(err);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        callback(null, data![0]);
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
    options: unknown,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      const prisma = this.transactionService.get(collection) || this.prismaService;
      const res = await prisma.$queryRawUnsafe<
        { collection: string; id: string; from: number; to: number; operation: string }[]
      >(
        'SELECT version, operation FROM ops WHERE collection = ? AND doc_id = ? AND version >= ? AND version < ?',
        collection,
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
