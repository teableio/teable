import { Injectable, Logger } from '@nestjs/common';
import type { IRecord } from '@teable/core';
import { IdPrefix } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { Knex } from 'knex';
import { InjectModel } from 'nest-knexjs';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { SnapshotMeta } from 'sharedb/lib/sharedb';
import type { IClsStore } from '../types/cls';
import { exceptionParse } from '../utils/exception-parse';
import type { IReadonlyAdapterService } from './interface';
import { FieldReadonlyServiceAdapter } from './readonly/field-readonly.service';
import { RecordReadonlyServiceAdapter } from './readonly/record-readonly.service';
import { TableReadonlyServiceAdapter } from './readonly/table-readonly.service';
import { ViewReadonlyServiceAdapter } from './readonly/view-readonly.service';

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
    private readonly tableService: TableReadonlyServiceAdapter,
    private readonly recordService: RecordReadonlyServiceAdapter,
    private readonly fieldService: FieldReadonlyServiceAdapter,
    private readonly viewService: ViewReadonlyServiceAdapter,
    private readonly prismaService: PrismaService,
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex
  ) {
    super();
    this.closed = false;
  }

  getReadonlyService(type: IdPrefix): IReadonlyAdapterService {
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
    throw new Error(`QueryType: ${type} has no readonly adapter service implementation`);
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
        return callback(undefined, [], extra);
      }

      this.getSnapshotBulk(
        collection,
        results as string[],
        projection,
        undefined,
        (error, snapshots) => {
          if (error) {
            return callback(error, []);
          }
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error: any | null, ids: string[], extra?: any) => void
  ) {
    if (!options.cookie) {
      this.logger.error(`No cookie found in options: ${JSON.stringify(options)}`);
    }
    try {
      await this.cls.runWith(
        {
          ...this.cls.get(),
          cookie: options.cookie,
          shareViewId: options.shareId,
        },
        async () => {
          const [docType, collectionId] = collection.split('_');
          const queryResult = await this.getReadonlyService(docType as IdPrefix).getDocIdsByQuery(
            collectionId,
            query
          );
          callback(null, queryResult.ids, queryResult.extra);
        }
      );
    } catch (e) {
      this.logger.error(e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback(exceptionParse(e as Error), []);
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

  async commit() {
    throw new Error('Method not implemented.');
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
    callback: (err: unknown | null, data?: Record<string, Snapshot>) => void
  ) {
    try {
      const [docType, collectionId] = collection.split('_');

      const snapshotData = await this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(
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
      this.logger.error(err);
      callback(exceptionParse(err as Error));
    }
  }

  async getSnapshot(
    collection: string,
    id: string,
    projection: IProjection | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (err: unknown, data?: Snapshot) => void
  ) {
    if (!options.agentCustom.cookie) {
      this.logger.error(`No cookie found in options agentCustom: ${JSON.stringify(options)}`);
    }
    await this.cls.runWith(
      {
        ...this.cls.get(),
        cookie: options.agentCustom.cookie,
        shareViewId: options.agentCustom.shareId,
      },
      async () => {
        return this.getSnapshotBulk(collection, [id], projection, options, (err, data) => {
          if (err) {
            callback(err);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            callback(null, data![id]);
          }
        });
      }
    );
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
    to: number | null,
    options: unknown,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, collectionId] = collection.split('_');
      const query = this.knex('ops')
        .select('operation')
        .where({
          collection: collectionId,
          doc_id: id,
        })
        .andWhere('version', '>=', from)
        .limit(1000);

      if (to) {
        query.andWhere('version', '<', to);
      }

      const sql = query.toQuery();

      const res = await this.prismaService.txClient().$queryRawUnsafe<{ operation: string }[]>(sql);
      callback(
        null,
        res.map(function (row) {
          return JSON.parse(row.operation);
        })
      );
    } catch (err) {
      callback(exceptionParse(err as Error));
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
