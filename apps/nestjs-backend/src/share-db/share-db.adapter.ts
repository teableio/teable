import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  IFieldPropertyKey,
  IFieldVo,
  IOtOperation,
  IRecord,
  ITablePropertyKey,
} from '@teable/core';
import {
  FieldOpBuilder,
  getRandomString,
  IdPrefix,
  RecordOpBuilder,
  TableOpBuilder,
} from '@teable/core';
import type { ITableVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { SnapshotMeta } from 'sharedb/lib/sharedb';
import { TableService } from '../features/table/table.service';
import type { IClsStore } from '../types/cls';
import { exceptionParse } from '../utils/exception-parse';
import {
  RawOpType,
  type ICreateOp,
  type IEditOp,
  type IShareDbReadonlyAdapterService,
} from './interface';
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
    private readonly tableServiceInner: TableService
  ) {
    super();
    this.closed = false;
  }

  getReadonlyService(type: IdPrefix): IShareDbReadonlyAdapterService {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getCookieAndShareId(options: any) {
    const cookie = options?.cookie || options?.agentCustom?.cookie;
    const shareId = options?.shareId || options?.agentCustom?.shareId;
    if (!cookie && !shareId) {
      this.logger.error(`No cookie found in options agentCustom: ${JSON.stringify(options)}`);
    }
    return { cookie, shareId };
  }

  async queryPoll(
    collection: string,
    query: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error: any | null, ids: string[], extra?: any) => void
  ) {
    const { cookie, shareId } = this.getCookieAndShareId(options);
    try {
      await this.cls.runWith(
        {
          ...this.cls.get(),
          cookie,
          shareViewId: shareId,
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
    const { cookie, shareId } = this.getCookieAndShareId(options);
    await this.cls.runWith(
      {
        ...this.cls.get(),
        cookie,
        shareViewId: shareId,
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getSnapshotData(docType: IdPrefix, collectionId: string, id: string, options: any) {
    if (docType === IdPrefix.Table) {
      return await this.tableServiceInner.getSnapshotBulk(collectionId, [id], {
        ignoreDefaultViewId: true,
      });
    }
    const { cookie, shareId } = this.getCookieAndShareId(options);
    return await this.cls.runWith(
      {
        ...this.cls.get(),
        cookie,
        shareViewId: shareId,
      },
      async () => {
        return await this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(collectionId, [
          id,
        ]);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [docType, collectionId] = collection.split('_');
      const { version, type } = await this.getReadonlyService(
        docType as IdPrefix
      ).getVersionAndType(collectionId, id);

      if (type === RawOpType.Del) {
        callback(null, []);
        return;
      }

      if (from > version) {
        callback(null, []);
        return;
      }

      const snapshotData = await this.getSnapshotData(
        docType as IdPrefix,
        collectionId,
        id,
        options
      );

      if (!snapshotData.length) {
        throw new NotFoundException(`docType: ${docType}, id: ${id} not found`);
      }

      const { data } = snapshotData[0];
      const baseRaw = {
        src: getRandomString(21),
        seq: 1,
        v: version,
      };
      if (type === RawOpType.Create) {
        callback(null, [
          {
            ...baseRaw,
            create: {
              type: 'json0',
              data,
            },
          } as ICreateOp,
        ]);
        return;
      }

      const editOp = this.getOpsFromSnapshot(docType as IdPrefix, data);
      const gapVersion = Math.max((to || baseRaw.v + 1) - from, 0);
      const editOps = new Array(gapVersion).fill(0).map((_, i) => {
        return {
          ...baseRaw,
          src: getRandomString(21),
          v: from + i,
        } as IEditOp;
      });
      if (gapVersion > 0) {
        editOps[gapVersion - 1].op = editOp;
      }
      callback(null, editOps);
    } catch (err) {
      this.logger.error(err);
      callback(exceptionParse(err as Error));
    }
  }

  private getOpsFromSnapshot(docType: IdPrefix, snapshot: unknown): IOtOperation[] {
    switch (docType) {
      case IdPrefix.Record:
        return Object.entries((snapshot as IRecord).fields).map(([fieldId, fieldValue]) => {
          return RecordOpBuilder.editor.setRecord.build({
            fieldId,
            newCellValue: fieldValue,
            oldCellValue: undefined,
          });
        });
      case IdPrefix.Field:
        return Object.entries(snapshot as IFieldVo)
          .filter(([key]) => key !== 'id')
          .map(([key, value]) => {
            return FieldOpBuilder.editor.setFieldProperty.build({
              key: key as IFieldPropertyKey,
              newValue: value,
              oldValue: undefined,
            });
          });
      case IdPrefix.Table:
        return Object.entries(snapshot as ITableVo)
          .filter(([key]) => key !== 'id')
          .map(([key, value]) => {
            return TableOpBuilder.editor.setTableProperty.build({
              key: key as ITablePropertyKey,
              newValue: value,
              oldValue: undefined,
            });
          });
      default:
        return [];
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
