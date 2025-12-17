import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type {
  IFieldPropertyKey,
  IFieldVo,
  IOtOperation,
  IRecord,
  ISnapshotBase,
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
import { omit } from 'lodash';
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
        options,
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
  private getAuthHeaders(options: any) {
    const cookie = options?.cookie || options?.agentCustom?.cookie;
    const shareId = options?.shareId || options?.agentCustom?.shareId;
    const templateHeader = options?.templateHeader || options?.agentCustom?.templateHeader;
    if (!cookie && !shareId && !templateHeader) {
      this.logger.error(`No cookie found in options agentCustom: ${JSON.stringify(options)}`);
      throw new UnauthorizedException('Unauthorized request not authorized');
    }
    return { cookie, shareViewId: shareId, templateHeader };
  }

  async queryPoll(
    collection: string,
    query: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error: any | null, ids: string[], extra?: any) => void
  ) {
    try {
      const authHeaders = this.getAuthHeaders(options);
      await this.cls.runWith(
        {
          ...this.cls.get(),
          ...authHeaders,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (err: unknown | null, data?: Record<string, Snapshot>) => void
  ) {
    try {
      const [docType, collectionId] = collection.split('_');

      const authHeaders = this.getAuthHeaders(options);
      const snapshotData = await this.cls.runWith(
        {
          ...this.cls.get(),
          ...authHeaders,
        },
        async () => {
          return this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(
            collectionId,
            ids,
            projection && projection['$submit'] ? undefined : projection
          );
        }
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
    await this.getSnapshotBulk(collection, [id], projection, options, (err, data) => {
      if (err) {
        callback(err);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        callback(null, data![id]);
      }
    });
  }

  private async getSnapshotData(
    docType: IdPrefix,
    collectionId: string,
    ids: string[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any
  ) {
    if (ids.length === 0) {
      return [];
    }
    if (docType === IdPrefix.Table) {
      return await this.tableServiceInner.getSnapshotBulk(collectionId, ids, {
        ignoreDefaultViewId: true,
      });
    }
    const authHeaders = this.getAuthHeaders(options);
    const snapshots = await this.cls.runWith(
      {
        ...this.cls.get(),
        ...authHeaders,
      },
      async () => {
        return await this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(
          collectionId,
          ids
        );
      }
    );

    // Filter out meta field for Field type to prevent it from being sent to frontend
    if (docType === IdPrefix.Field) {
      return snapshots.map((snapshot) => ({
        ...snapshot,
        data: omit(snapshot.data as object, ['meta']),
      }));
    }

    return snapshots;
  }

  private hasGapVersion({
    opType,
    currentVersion,
    fromVersion,
  }: {
    opType: RawOpType;
    currentVersion: number;
    fromVersion: number;
  }) {
    if (opType === RawOpType.Del) {
      return false;
    }

    if (fromVersion > currentVersion) {
      return false;
    }
    return true;
  }

  async internalGetOps(
    collection: string,
    id: string,
    from: number,
    to: number | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (error: unknown, data?: unknown) => void,
    dataFunctions: {
      getVersionAndType: (
        collectionId: string,
        id: string
      ) => Promise<{ version: number; type: RawOpType }>;
      getSnapshotData: (
        docType: IdPrefix,
        collectionId: string,
        ids: string[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: any
      ) => Promise<ISnapshotBase<unknown>[]>;
    }
  ) {
    const { getVersionAndType, getSnapshotData } = dataFunctions;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [docType, collectionId] = collection.split('_');

      const { version, type } = await getVersionAndType(collectionId, id);

      if (!this.hasGapVersion({ opType: type, currentVersion: version, fromVersion: from })) {
        callback(null, []);
        return;
      }

      const snapshotData = await getSnapshotData(docType as IdPrefix, collectionId, [id], options);

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
    const [docType] = collection.split('_');
    const readonlyService = this.getReadonlyService(docType as IdPrefix);
    await this.internalGetOps(collection, id, from, to, options, callback, {
      getVersionAndType: async (...args) => await readonlyService.getVersionAndType(...args),
      getSnapshotData: async (...args) => await this.getSnapshotData(...args),
    });
  }

  async getOpsBulk(
    collection: string,
    fromMap: Record<string, number>,
    toMap: Record<string, number | null> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (error: unknown, data?: unknown) => void
  ) {
    const [docType, collectionId] = collection.split('_');
    const readonlyService = this.getReadonlyService(docType as IdPrefix);
    const versionAndTypeMap = await readonlyService.getVersionAndTypeMap(
      collectionId,
      Object.keys(fromMap)
    );
    const needGetSnapshotDataIds: string[] = [];
    for (const [id, from] of Object.entries(fromMap)) {
      const versionAndType = versionAndTypeMap[id];
      if (!versionAndType) {
        continue;
      }
      if (
        this.hasGapVersion({
          opType: versionAndType.type,
          currentVersion: versionAndType.version,
          fromVersion: from,
        })
      ) {
        needGetSnapshotDataIds.push(id);
      }
    }

    const snapshotDataMap = await this.getSnapshotData(
      docType as IdPrefix,
      collectionId,
      needGetSnapshotDataIds,
      options
    ).then((snapshots) => {
      return snapshots.reduce(
        (acc, snapshot) => {
          acc[snapshot.id] = snapshot;
          return acc;
        },
        {} as Record<string, ISnapshotBase<unknown>>
      );
    });
    const result: Record<string, unknown> = {};
    for (const [id, from] of Object.entries(fromMap)) {
      let resultError: unknown = null;
      await this.internalGetOps(
        collection,
        id,
        from,
        toMap?.[id] ?? null,
        options,
        (err, data) => {
          if (err) {
            resultError = err;
          }
          result[id] = data;
        },
        {
          getVersionAndType: async (_collectionId, id) =>
            versionAndTypeMap[id] ?? { version: 0, type: RawOpType.Del },
          getSnapshotData: async (...args) => {
            const ids = args[2];
            return ids.map((id) => snapshotDataMap[id]).filter(Boolean);
          },
        }
      );
      if (resultError) {
        callback(resultError);
        return;
      }
    }
    callback(null, result);
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
