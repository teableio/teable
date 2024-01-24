import { Injectable, Logger } from '@nestjs/common';
import type { IOtOperation, IRecord } from '@teable-group/core';
import {
  FieldOpBuilder,
  RecordOpBuilder,
  TableOpBuilder,
  ViewOpBuilder,
  IdPrefix,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { groupBy } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { SnapshotMeta } from 'sharedb/lib/sharedb';
import { FieldService } from '../features/field/field.service';
import { RecordService } from '../features/record/record.service';
import { TableService } from '../features/table/table.service';
import { ViewService } from '../features/view/view.service';
import type { IClsStore } from '../types/cls';
import type { IAdapterService } from './interface';

export interface ICollectionSnapshot {
  type: string;
  v: number;
  data: IRecord;
}

type IProjection = { [fieldNameOrId: string]: boolean };

@Injectable()
export class ShareDbAdapter extends ShareDb.DB {
  private logger = new Logger(ShareDbAdapter.name);

  closed: boolean;

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableService,
    private readonly recordService: RecordService,
    private readonly fieldService: FieldService,
    private readonly viewService: ViewService,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {
    super();
    this.closed = false;
  }

  getService(type: IdPrefix): IAdapterService {
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
    this.queryPoll(collection, query, options, (error, results, extra) => {
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
            results.map((id) => snapshots![id]),
            extra
          );
        }
      );
    });
  };

  async queryPoll(
    collection: string,
    query: unknown,
    _options: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error: ShareDb.Error | null, ids: string[], extra?: any) => void
  ) {
    try {
      const [docType, collectionId] = collection.split('_');

      const queryResult = await this.getService(docType as IdPrefix).getDocIdsByQuery(
        collectionId,
        query
      );
      callback(null, queryResult.ids, queryResult.extra);
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
    _query: unknown
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
    version: number,
    collection: string,
    docId: string,
    ops: IOtOperation[]
  ) {
    const [docType, collectionId] = collection.split('_');
    let opBuilder;
    switch (docType as IdPrefix) {
      case IdPrefix.View:
        opBuilder = ViewOpBuilder;
        break;
      case IdPrefix.Field:
        opBuilder = FieldOpBuilder;
        break;
      case IdPrefix.Record:
        opBuilder = RecordOpBuilder;
        break;
      case IdPrefix.Table:
        opBuilder = TableOpBuilder;
        break;
      default:
        throw new Error(`UpdateSnapshot: ${docType} has no service implementation`);
    }

    const ops2Contexts = opBuilder.ops2Contexts(ops);
    const service = this.getService(docType as IdPrefix);
    // group by op name execute faster
    const ops2ContextsGrouped = groupBy(ops2Contexts, 'name');
    for (const opName in ops2ContextsGrouped) {
      const opContexts = ops2ContextsGrouped[opName];
      await service.update(version, collectionId, docId, opContexts);
    }
  }

  private async createSnapshot(collection: string, _docId: string, snapshot: unknown) {
    const [docType, collectionId] = collection.split('_');
    await this.getService(docType as IdPrefix).create(collectionId, snapshot);
  }

  private async deleteSnapshot(version: number, collection: string, docId: string) {
    const [docType, collectionId] = collection.split('_');
    await this.getService(docType as IdPrefix).del(version, collectionId, docId);
  }

  // Persists an op and snapshot if it is for the next version. Calls back with
  // callback(err, succeeded)
  async commit(
    collection: string,
    id: string,
    rawOp: CreateOp | DeleteOp | EditOp,
    snapshot: ICollectionSnapshot,
    options: unknown,
    callback: (err: unknown, succeed?: boolean, complete?: boolean) => void
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

    const [docType, collectionId] = collection.split('_');

    try {
      await this.prismaService.$tx(async (prisma) => {
        const opsResult = await prisma.ops.aggregate({
          _max: { version: true },
          where: { collection: collectionId, docId: id },
        });

        const maxVersion = opsResult._max.version == null ? 0 : opsResult._max.version + 1;

        if (rawOp.v !== maxVersion) {
          this.logger.log({ message: 'op crashed', crashed: rawOp.op });
          throw new Error(`${id} version mismatch: maxVersion: ${maxVersion} rawOpV: ${rawOp.v}`);
        }

        // 1. save op in db;
        await prisma.ops.create({
          data: {
            docId: id,
            docType,
            collection: collectionId,
            version: rawOp.v,
            operation: JSON.stringify(rawOp),
            createdBy: this.cls.get('user.id'),
          },
        });

        // create snapshot
        if (rawOp.create) {
          await this.createSnapshot(collection, id, rawOp.create.data);
        }

        // update snapshot
        if (rawOp.op) {
          await this.updateSnapshot(snapshot.v, collection, id, rawOp.op);
        }

        // delete snapshot
        if (rawOp.del) {
          await this.deleteSnapshot(snapshot.v, collection, id);
        }
      });
      callback(null, true, true);
    } catch (err) {
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
    options: unknown,
    callback: (err: ShareDb.Error | null, data?: Record<string, Snapshot>) => void
  ) {
    try {
      const [docType, collectionId] = collection.split('_');

      const snapshotData = await this.getService(docType as IdPrefix).getSnapshotBulk(
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
    options: unknown,
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
    options: unknown,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, collectionId] = collection.split('_');
      const nativeSql = this.knex('ops')
        .select('operation')
        .where({
          collection: collectionId,
          doc_id: id,
        })
        .andWhere('version', '>=', from)
        .andWhere('version', '<', to)
        .toSQL()
        .toNative();

      const res = await this.prismaService.$queryRawUnsafe<{ operation: string }[]>(
        nativeSql.sql,
        ...nativeSql.bindings
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
