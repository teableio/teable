import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
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
import { isTableProvisionPendingError, TABLE_PROVISION_PENDING_CODE } from '@teable/v2-core';
// Cancellation classification only; this import does not make HTTP requests.
// eslint-disable-next-line no-restricted-imports
import { isCancel } from 'axios';
import { omit } from 'lodash';
import { ClsService } from 'nestjs-cls';
import type { CreateOp, DeleteOp, EditOp } from 'sharedb';
import ShareDb from 'sharedb';
import type { SnapshotMeta } from 'sharedb/lib/sharedb';
import { FieldService } from '../features/field/field.service';
import { TableService } from '../features/table/table.service';
import type { IClsStore } from '../types/cls';
import { exceptionParse } from '../utils/exception-parse';
import {
  RawOpType,
  type ICreateOp,
  type IEditOp,
  type IShareDbReadonlyAdapterService,
} from './interface';
import { getQueryCancellationSignal, ShareDbQueryCancelledError } from './query-cancellation';
import { shouldSkipQueryPoll } from './query-poll-skip';
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

/**
 * Runs a callback-style ShareDB method that is implemented with async/await. ShareDB expects
 * these methods to return void, so the promise is settled here and an unexpected rejection is
 * forwarded to the trailing callback instead of becoming an unhandled rejection.
 */
const settle = (promise: Promise<unknown>, args: readonly unknown[]): void => {
  promise.catch((error) => {
    const callback = args[args.length - 1];
    if (typeof callback === 'function') callback(error);
  });
};

@Injectable()
export class ShareDbAdapter extends ShareDb.DB {
  private readonly logger = new Logger(ShareDbAdapter.name);

  // Read by sharedb QueryEmitter (lib/query-emitter.js): ops arriving while a
  // poll is in flight or within this window are coalesced into a single
  // trailing poll, instead of one poll per op.
  pollDebounce = Number(process.env.SHAREDB_QUERY_POLL_DEBOUNCE_MS ?? 200);

  closed: boolean;

  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly tableService: TableReadonlyServiceAdapter,
    private readonly recordService: RecordReadonlyServiceAdapter,
    private readonly fieldService: FieldReadonlyServiceAdapter,
    private readonly viewService: ViewReadonlyServiceAdapter,
    private readonly tableServiceInner: TableService,
    @Optional() private readonly fieldServiceInner?: FieldService
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

  // Translate the query's field-id projection (string[]) into the snapshot
  // projection shape ({ [fieldId]: true }). Returns undefined when the query
  // carries no projection, leaving the ShareDB native projection in place.
  private queryProjection(query: unknown): IProjection | undefined {
    const projection = (query as { projection?: string[] } | undefined)?.projection;
    if (!Array.isArray(projection) || projection.length === 0) {
      return undefined;
    }
    return projection.reduce<IProjection>((acc, fieldId) => {
      acc[fieldId] = true;
      return acc;
    }, {});
  }

  query = (
    collection: string,
    query: unknown,
    projection: IProjection,
    options: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (err: any, snapshots: Snapshot[], extra?: any) => void
  ) => {
    const signal = getQueryCancellationSignal(options);
    this.queryPoll(collection, query, options, (error, results, extra) => {
      if (error) {
        if (signal?.aborted && error instanceof ShareDbQueryCancelledError) {
          return callback(null, [], undefined);
        }
        return callback(error, []);
      }
      if (signal?.aborted) return callback(null, [], undefined);
      if (!results.length) {
        return callback(undefined, [], extra);
      }

      this.getSnapshotBulk(
        collection,
        results as string[],
        // ShareDB's native projection arg is only populated for registered
        // projection collections (we register none), so it is always empty.
        // The field selection the client cares about rides inside the query
        // (e.g. a view's visible field ids) — forward it so the bulk snapshot
        // only carries those fields.
        this.queryProjection(query) ?? projection,
        options,
        (error, snapshots) => {
          if (error) {
            if (signal?.aborted && error instanceof ShareDbQueryCancelledError) {
              return callback(null, [], undefined);
            }
            return callback(error, []);
          }
          if (signal?.aborted) return callback(null, [], undefined);
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

  private toShareDbError(error: Error) {
    const exception = exceptionParse(error);
    const data = 'data' in error ? error.data : undefined;
    // ShareDB serializes only code/message. Preserve the pending identity there,
    // before HTTP normalization discards the domain metadata.
    if (
      data &&
      typeof data === 'object' &&
      'domainCode' in data &&
      isTableProvisionPendingError({ code: data.domainCode })
    ) {
      exception.code = TABLE_PROVISION_PENDING_CODE;
    }
    return exception;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getAuthHeaders(options: any) {
    const cookie = options?.cookie || options?.agentCustom?.cookie;
    const shareId = options?.shareId || options?.agentCustom?.shareId;
    const baseShareId = options?.baseShareId || options?.agentCustom?.baseShareId;
    const templateHeader = options?.templateHeader || options?.agentCustom?.templateHeader;
    if (!cookie && !shareId && !baseShareId && !templateHeader) {
      this.logger.error(`No cookie found in options agentCustom: ${JSON.stringify(options)}`);
      throw new UnauthorizedException('Unauthorized request not authorized');
    }
    return { cookie, shareViewId: shareId, baseShareId, templateHeader };
  }

  queryPoll(...args: Parameters<ShareDbAdapter['queryPollAsync']>): void {
    settle(this.queryPollAsync(...args), args);
  }

  async queryPollAsync(
    collection: string,
    query: unknown,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (error: any, ids: string[], extra?: any) => void
  ) {
    const signal = getQueryCancellationSignal(options);
    try {
      if (signal?.aborted) throw new ShareDbQueryCancelledError();
      const authHeaders = this.getAuthHeaders(options);
      await this.cls.runWith(
        {
          ...this.cls.get(),
          ...authHeaders,
          interactiveQueryAbort: signal,
        },
        async () => {
          const [docType, collectionId] = collection.split('_');
          const queryResult = await this.getReadonlyService(docType as IdPrefix).getDocIdsByQuery(
            collectionId,
            query
          );
          if (signal?.aborted) throw new ShareDbQueryCancelledError();
          callback(null, queryResult.ids, queryResult.extra);
        }
      );
    } catch (e) {
      if (signal?.aborted && (e instanceof ShareDbQueryCancelledError || isCancel(e))) {
        return callback(new ShareDbQueryCancelledError(), []);
      }
      this.logger.error(e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback(this.toShareDbError(e as Error), []);
    }
  }

  // Return true to avoid polling if there is no possibility that an op could
  // affect a query's results; the decision logic lives in query-poll-skip/
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  skipPoll(
    collection: string,
    _id: string,
    op: CreateOp | DeleteOp | EditOp,
    query: unknown
  ): boolean {
    // decision counts are observed via otel metrics inside query-poll-skip;
    // per-event logging is debug-only — this fires hundreds of thousands of
    // times a day in production
    const isShouldSkipQueryPoll = shouldSkipQueryPoll(collection, _id, op, query);
    if (isShouldSkipQueryPoll) {
      this.logger.debug(
        `skipping poll for op on ${collection} ${_id} because modified fields do not affect the query`
      );
    }
    return isShouldSkipQueryPoll;
  }

  close(callback: () => void) {
    this.closed = true;

    if (callback) callback();
  }

  commit() {
    throw new Error('Method not implemented.');
  }

  private snapshots2Map<T>(snapshots: ({ id: string } & T)[]): Record<string, T> {
    return snapshots.reduce<Record<string, T>>((pre, cur) => {
      pre[cur.id] = cur;
      return pre;
    }, {});
  }

  private snapshots2MapWithMissing(
    ids: string[],
    snapshotData: ISnapshotBase<unknown>[]
  ): Record<string, Snapshot> {
    const snapshotDataMap = new Map(snapshotData.map((snapshot) => [snapshot.id, snapshot]));
    const snapshots = ids.map((id) => {
      const snapshot = snapshotDataMap.get(id);
      if (!snapshot) {
        return new Snapshot(id, 0, null, undefined, null);
      }
      return new Snapshot(snapshot.id, snapshot.v, snapshot.type, snapshot.data, null);
    });
    return this.snapshots2Map(snapshots);
  }

  // Get the named document from the database. The callback is called with (err,
  // snapshot). A snapshot with a version of zero is returned if the document
  // has never been created in the database.
  getSnapshotBulk(...args: Parameters<ShareDbAdapter['getSnapshotBulkAsync']>): void {
    settle(this.getSnapshotBulkAsync(...args), args);
  }

  async getSnapshotBulkAsync(
    collection: string,
    ids: string[],
    projection: IProjection | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (err: unknown, data?: Record<string, Snapshot>) => void
  ) {
    // QueryEmitter's inserted-snapshot path only passes agentCustom. Its callback
    // runs in queryPoll's CLS child, which still owns this subscription's signal.
    const signal = collection.startsWith(`${IdPrefix.Record}_`)
      ? getQueryCancellationSignal(options) ?? this.cls.get('interactiveQueryAbort')
      : undefined;
    try {
      if (signal?.aborted) throw new ShareDbQueryCancelledError();
      const [docType, collectionId] = collection.split('_');
      let authHeaders;
      try {
        authHeaders = this.getAuthHeaders(options);
      } catch {
        // For internal (server-side) connections without auth, resolve field docs directly
        if (docType === IdPrefix.Field && this.fieldServiceInner) {
          const snapshotData = await this.fieldServiceInner.getSnapshotBulk(collectionId, ids);
          callback(null, this.snapshots2MapWithMissing(ids, snapshotData));
          return;
        }
        throw new UnauthorizedException('Unauthorized request not authorized');
      }
      const snapshotData = await this.cls.runWith(
        {
          ...this.cls.get(),
          ...authHeaders,
          interactiveQueryAbort: signal,
        },
        () =>
          this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(
            collectionId,
            ids,
            projection && projection['$submit'] ? undefined : projection
          )
      );
      if (signal?.aborted) throw new ShareDbQueryCancelledError();
      callback(null, this.snapshots2MapWithMissing(ids, snapshotData));
    } catch (err) {
      if (signal?.aborted && (err instanceof ShareDbQueryCancelledError || isCancel(err))) {
        return callback(new ShareDbQueryCancelledError());
      }
      this.logger.error(err);
      callback(this.toShareDbError(err as Error));
    }
  }

  getSnapshot(...args: Parameters<ShareDbAdapter['getSnapshotAsync']>): void {
    settle(this.getSnapshotAsync(...args), args);
  }

  async getSnapshotAsync(
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
    docType: string,
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
      () => this.getReadonlyService(docType as IdPrefix).getSnapshotBulk(collectionId, ids)
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

  private getIdsWithGapVersion(
    fromMap: Record<string, number>,
    versionAndTypeMap: Record<string, { version: number; type: RawOpType }>
  ): string[] {
    const ids: string[] = [];
    for (const [id, from] of Object.entries(fromMap)) {
      const versionAndType = versionAndTypeMap[id];
      if (!versionAndType) continue;
      if (
        this.hasGapVersion({
          opType: versionAndType.type,
          currentVersion: versionAndType.version,
          fromVersion: from,
        })
      ) {
        ids.push(id);
      }
    }
    return ids;
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
      callback(this.toShareDbError(err as Error));
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
  getOps(...args: Parameters<ShareDbAdapter['getOpsAsync']>): void {
    settle(this.getOpsAsync(...args), args);
  }

  async getOpsAsync(
    collection: string,
    id: string,
    from: number,
    to: number | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      const [docType] = collection.split('_');
      const readonlyService = this.getReadonlyService(docType as IdPrefix);
      await this.internalGetOps(collection, id, from, to, options, callback, {
        getVersionAndType: async (...args) => await readonlyService.getVersionAndType(...args),
        getSnapshotData: async (...args) => await this.getSnapshotData(...args),
      });
    } catch (err) {
      this.logger.error(err);
      callback(this.toShareDbError(err as Error));
    }
  }

  getOpsBulk(...args: Parameters<ShareDbAdapter['getOpsBulkAsync']>): void {
    settle(this.getOpsBulkAsync(...args), args);
  }

  async getOpsBulkAsync(
    collection: string,
    fromMap: Record<string, number>,
    toMap: Record<string, number | null> | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
    callback: (error: unknown, data?: unknown) => void
  ) {
    try {
      const [docType, collectionId] = collection.split('_');
      const versionAndTypeMap = await this.getReadonlyService(
        docType as IdPrefix
      ).getVersionAndTypeMap(collectionId, Object.keys(fromMap));
      const needGetSnapshotDataIds = this.getIdsWithGapVersion(fromMap, versionAndTypeMap);

      const snapshots = await this.getSnapshotData(
        docType,
        collectionId,
        needGetSnapshotDataIds,
        options
      );
      const snapshotDataMap = snapshots.reduce(
        (acc, snapshot) => {
          acc[snapshot.id] = snapshot;
          return acc;
        },
        {} as Record<string, ISnapshotBase<unknown>>
      );
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
    } catch (err) {
      this.logger.error(err);
      callback(this.toShareDbError(err as Error));
    }
  }

  private getOpsFromSnapshot(docType: string, snapshot: unknown): IOtOperation[] {
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
