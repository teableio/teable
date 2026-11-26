import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath } from 'node:path';
import {
  getPostgresTransaction,
  registerV2PostgresDb,
  registerV2PostgresDataDb,
  registerV2PostgresMetaDb,
  v2DataDbTokens,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { registerV2PostgresStateAdapter } from '@teable/v2-adapter-repository-postgres';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateBaseCommand,
  CreateRecordCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  FieldKeyType,
  RecordByIdsSpec,
  RecordId,
  resolveScopedTableSchemaLease,
  UpdateFieldCommand,
  UpdateRecordCommand,
  UpdateRecordsCommand,
  UpdateRecordsHandler,
  v2CoreTokens,
  ViewId,
  withoutTransaction,
  type CreateBaseResult,
  type CreateRecordResult,
  type CreateRecordsResult,
  type CreateTableResult,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IExecutionContext,
  type IQueryBus,
  type ITableRecordQueryRepository,
} from '@teable/v2-core';
import { container as rootContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  diffSnapshots,
  selectPromotionPatch,
  vcsDomainError,
  type DomainError,
  type IBaseVcsSnapshot,
  type ICloneSnapshotOptions,
  type IVcsCloneRecordsChunk,
  type IVcsHeadInfo,
  type IVcsIncrementalChanges,
  type IVcsPushCasConflict,
  type IVcsPushRequest,
  type IVcsPushResult,
  type IVcsRemoteGateway,
  type Result,
} from '@teable/v2-vcs';
import {
  CloneBaseVcsService,
  DiffBaseVcsService,
  GetBaseVcsStatusService,
  InMemoryVcsStateRepository,
  PullBaseVcsService,
  PushBaseVcsService,
  ResolveBaseVcsConflictsService,
  createV2VcsClientContainer,
} from '@teable/v2-vcs/client';
import { V2EngineSyncAdapter } from '@teable/v2-vcs/engine';
import { FileVcsStateRepository } from '@teable/v2-vcs/node';
import {
  type AllowAllVcsAccessPolicy,
  BaseVcsHistoryService,
  CloneVcsSnapshotService,
  EnableBaseVcsService,
  GetVcsHeadService,
  ListVcsChangesService,
  ListVcsTableRecordsChunkService,
  PushVcsPatchService,
  v2VcsServerTokens,
  type IBaseVcsLogRepository,
} from '@teable/v2-vcs/server';
import { CompiledQuery, sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IBaseVcsDatabase } from './PostgresBaseVcsLogRepository';

const createContext = (actor = 'usr_test_sync'): IExecutionContext => ({
  actorId: ActorId.create(actor)._unsafeUnwrap(),
});

const unwrap = <T, E>(res: Result<T, E>, label = 'result'): T => {
  if (res.isErr()) {
    throw new Error(`${label} failed: ${JSON.stringify(res.error)}`);
  }
  return res.value;
};

const createEmptyTablePatch = (tableId: string) => ({
  tableId,
  fieldsAdded: [],
  fieldsUpdated: [],
  fieldsDeleted: [],
  viewsAdded: [],
  viewsUpdated: [],
  viewsDeleted: [],
  recordsAdded: [],
  recordsUpdated: [],
  recordsDeleted: [],
});

const mapPushDomainErrorToConflictResult = (
  request: IVcsPushRequest,
  error: DomainError
): IVcsPushResult | undefined => {
  if (error.code !== 'vcs.cas_conflict' && error.code !== 'vcs.non_fast_forward') {
    return undefined;
  }
  const details = (error.details ?? {}) as {
    readonly headRevision?: number;
    readonly overlappingKeys?: readonly string[];
    readonly conflicts?: readonly IVcsPushCasConflict[];
  };
  return {
    ok: false,
    dryRun: Boolean(request.dryRun),
    baseId: request.baseId,
    baseRevision: request.baseRevision,
    newRevision: details.headRevision ?? request.baseRevision,
    rebased: false,
    summary: {
      tablesAdded: 0,
      tablesDeleted: 0,
      tablesRenamed: 0,
      fieldsAdded: 0,
      fieldsUpdated: 0,
      fieldsDeleted: 0,
      viewsAdded: 0,
      viewsUpdated: 0,
      viewsDeleted: 0,
      recordsAdded: 0,
      recordsUpdated: 0,
      recordsDeleted: 0,
      cellChanges: 0,
    },
    conflictError: {
      code: error.code,
      message: error.message,
      headRevision: details.headRevision ?? request.baseRevision,
      overlappingKeys: details.overlappingKeys ?? [],
      ...(details.conflicts ? { conflicts: details.conflicts } : {}),
    },
  };
};

class DirectServerVcsRemoteGateway implements IVcsRemoteGateway {
  constructor(
    private readonly params: {
      readonly ctx: IExecutionContext;
      readonly enableService: EnableBaseVcsService;
      readonly getHeadService: GetVcsHeadService;
      readonly cloneService: CloneVcsSnapshotService;
      readonly listChunkService?: ListVcsTableRecordsChunkService;
      readonly listChangesService: ListVcsChangesService;
      readonly pushService: PushVcsPatchService;
    }
  ) {}

  async getHead(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>> {
    return this.params.getHeadService.execute(this.params.ctx, { baseId });
  }

  async enableBaseVcs(baseId: string): Promise<Result<IVcsHeadInfo, DomainError>> {
    const res = await this.params.enableService.execute(this.params.ctx, { baseId });
    if (res.isErr()) {
      return err(res.error);
    }
    return this.getHead(baseId);
  }

  async cloneSnapshot(
    baseId: string,
    options?: ICloneSnapshotOptions
  ): Promise<
    Result<{ snapshot: IBaseVcsSnapshot; remoteMode: IVcsHeadInfo['remoteMode'] }, DomainError>
  > {
    const res = await this.params.cloneService.execute(this.params.ctx, {
      baseId,
      tableIds: options?.tableIds,
      ...(options?.includeRecords !== undefined ? { includeRecords: options.includeRecords } : {}),
    });
    return res.map((value) => ({
      snapshot: value.snapshot,
      remoteMode: value.remoteMode,
    }));
  }

  async cloneTableRecordsChunk(
    baseId: string,
    tableId: string,
    options?: { readonly cursor?: string; readonly limit?: number }
  ): Promise<Result<IVcsCloneRecordsChunk, DomainError>> {
    if (!this.params.listChunkService) {
      return err(
        vcsDomainError.notFound({
          code: 'vcs.chunk_endpoint_not_configured',
          message: 'cloneTableRecordsChunk is not wired on DirectServerVcsRemoteGateway',
        })
      );
    }
    return this.params.listChunkService.execute(this.params.ctx, {
      baseId,
      tableId,
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    });
  }

  async fetchChanges(
    baseId: string,
    sinceRevision: number,
    options?: ICloneSnapshotOptions
  ): Promise<Result<IVcsIncrementalChanges, DomainError>> {
    if (!options?.cursor) {
      return err(
        vcsDomainError.validation({
          code: 'vcs.cursor_required',
          message: 'Direct gateway requires a pull cursor',
        })
      );
    }
    return this.params.listChangesService.execute(this.params.ctx, {
      baseId,
      cursor: options.cursor,
      sinceRevision,
      tableIds: options.tableIds,
    });
  }

  async pushPatch(request: IVcsPushRequest): Promise<Result<IVcsPushResult, DomainError>> {
    const res = await this.params.pushService.execute(this.params.ctx, request);
    if (res.isErr()) {
      const mappedConflict = mapPushDomainErrorToConflictResult(request, res.error);
      if (mappedConflict) {
        return ok(mappedConflict);
      }
      return err(res.error);
    }
    return ok(res.value);
  }
}

const createIsolatedClientEngine = async (ctx: IExecutionContext, tempDir: string) => {
  const container = await createV2NodeTestContainer({
    connectionString: `pglite://${tempDir}`,
    ensureSchema: true,
    seedBase: false,
    schemaCoordination: false,
  });
  const localDb = container.container.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
  const adapter = new V2EngineSyncAdapter({
    commandBus: container.container.resolve<ICommandBus>(v2CoreTokens.commandBus),
    queryBus: container.container.resolve<IQueryBus>(v2CoreTokens.queryBus),
    getExecutionContext: () => ctx,
    flushComputed: async () => {
      await container.processOutbox();
    },
    queryRaw: async (sqlText, params) => {
      const res = await localDb.executeQuery(CompiledQuery.raw(sqlText, params ? [...params] : []));
      return { rows: res.rows as Record<string, unknown>[] };
    },
  });
  return { container, adapter, localDb };
};

const setupSplitSchemaContainer = async (
  parentDataDb: Kysely<IBaseVcsDatabase & Record<string, unknown>>,
  baseConnectionString: string
) => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const metaSchema = `vcs_uc_meta_${suffix}`;
  const dataSchema = `vcs_uc_data_${suffix}`;

  await sql`CREATE SCHEMA ${sql.id(metaSchema)}`.execute(parentDataDb);
  await sql`CREATE SCHEMA ${sql.id(dataSchema)}`.execute(parentDataDb);

  const metaUrl = new URL(baseConnectionString);
  metaUrl.searchParams.set('options', `-c search_path=${metaSchema},public`);
  const dataUrl = new URL(baseConnectionString);
  dataUrl.searchParams.set('options', `-c search_path=${dataSchema},public`);

  const splitContainer = await createV2NodeTestContainer({
    connectionString: metaUrl.toString(),
    ensureSchema: true,
    schemaCoordination: false,
    registerDb: async (c) => {
      await registerV2PostgresMetaDb(c, {
        pg: { connectionString: metaUrl.toString(), schema: metaSchema },
      });
      const dataConfig = {
        pg: { connectionString: dataUrl.toString(), schema: dataSchema },
      };
      await registerV2PostgresDataDb(c, dataConfig);
      const splitDataDb = c.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
      await registerV2PostgresStateAdapter(rootContainer.createChildContainer(), {
        db: splitDataDb,
        ensureSchema: true,
      });
      c.registerInstance(v2PostgresDbTokens.db, splitDataDb);
      c.registerInstance(v2PostgresDbTokens.config, dataConfig);
    },
  });

  const cleanup = async () => {
    await splitContainer.dispose().catch(() => undefined);
    await sql`DROP SCHEMA IF EXISTS ${sql.id(metaSchema)} CASCADE`.execute(parentDataDb);
    await sql`DROP SCHEMA IF EXISTS ${sql.id(dataSchema)} CASCADE`.execute(parentDataDb);
  };

  return { splitContainer, cleanup };
};

describe('VCS server use-cases integration (real PostgreSQL)', () => {
  let testContainer: IV2NodeTestContainer;
  let dataDb: Kysely<IBaseVcsDatabase & Record<string, unknown>>;
  let commandBus: ICommandBus;
  let domainWriteTransaction: IDomainWriteTransaction;
  let logRepository: IBaseVcsLogRepository;
  let enableService: EnableBaseVcsService;
  let getHeadService: GetVcsHeadService;
  let cloneService: CloneVcsSnapshotService;
  let listChunkService: ListVcsTableRecordsChunkService;
  let listChangesService: ListVcsChangesService;
  let pushService: PushVcsPatchService;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer({ ensureSchema: true });
    dataDb = testContainer.dataDb as unknown as Kysely<IBaseVcsDatabase & Record<string, unknown>>;
    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    domainWriteTransaction = testContainer.container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );
    logRepository = testContainer.container.resolve<IBaseVcsLogRepository>(
      v2VcsServerTokens.logRepository
    );
    enableService = testContainer.container.resolve(EnableBaseVcsService);
    getHeadService = testContainer.container.resolve(GetVcsHeadService);
    cloneService = testContainer.container.resolve(CloneVcsSnapshotService);
    listChunkService = testContainer.container.resolve(ListVcsTableRecordsChunkService);
    listChangesService = testContainer.container.resolve(ListVcsChangesService);
    pushService = testContainer.container.resolve(PushVcsPatchService);
  }, 120_000);

  afterAll(async () => {
    await testContainer?.dispose();
  }, 30_000);

  it('rejects oversized new view orders while a PostgreSQL reader holds the table open', async () => {
    const ctx = createContext();
    const { base } = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'View order backfill budget' })._unsafeUnwrap()
      )
    );
    const baseId = base.id().toString();
    const { table } = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'Order target',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      )
    );
    const tableId = table.id().toString();
    const fieldId = table.primaryFieldId().toString();
    const dbTableName = unwrap(table.dbTableName().andThen((name) => name.value()));
    const relation = sql.table(dbTableName);
    const priorRecordId = 'rec00000000000000001';
    await sql`
      INSERT INTO ${relation} (__id, __version, __created_by)
      SELECT 'rec' || lpad(n::text, 17, '0'), 1, ${ctx.actorId.toString()}
      FROM generate_series(1, 1001) AS n
    `.execute(dataDb);
    const {
      rows: [priorRecord],
    } = await sql<{ order: number }>`
      SELECT __auto_number::double precision AS "order" FROM ${relation}
      WHERE __id = ${priorRecordId}
    `.execute(dataDb);
    unwrap(await enableService.execute(ctx, { baseId }));

    const viewId = unwrap(ViewId.generate()).toString();
    const recordId = unwrap(RecordId.generate()).toString();
    const originPushId = 'vcsp_new_view_order_backfill_budget';
    const request = {
      baseId,
      baseRevision: 0,
      originPushId,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch(tableId),
            viewsAdded: [
              { id: viewId, name: 'Manual order', type: 'grid', query: { manualSort: true } },
            ],
            recordsAdded: [
              { id: recordId, fields: { [fieldId]: 'Inserted' }, orders: { [viewId]: -2 } },
            ],
            recordsUpdated: [
              {
                recordId: priorRecordId,
                cellChanges: [],
                orderChanges: [{ viewId, before: priorRecord.order, after: -1 }],
              },
            ],
          },
        ],
      },
    };

    await dataDb.transaction().execute(async (reader) => {
      const read = () =>
        sql`SELECT __id FROM ${relation} WHERE __id = ${priorRecordId}`.execute(reader);
      expect((await read()).rows).toHaveLength(1);
      // This reader's ACCESS SHARE lock is held through the push. Attempting
      // ACCESS EXCLUSIVE before admission would return contention or block.
      const rejected = await pushService.execute(ctx, request);
      expect(rejected._unsafeUnwrapErr()).toMatchObject({
        code: 'vcs.new_view_order_backfill_too_large',
        details: { maxRows: 1000, viewCount: 1 },
      });
      expect((await read()).rows).toHaveLength(1);
    });

    expect(unwrap(await getHeadService.execute(ctx, { baseId })).headRevision).toBe(0);
    expect(
      unwrap(await logRepository.findCommitByOriginPushId(ctx, base.id(), originPushId))
    ).toBeNull();
    const {
      rows: [state],
    } = await sql<{ viewExists: boolean; columnExists: boolean; recordExists: boolean }>`
      SELECT EXISTS(SELECT 1 FROM ${sql.table('view')} WHERE id = ${viewId}) AS "viewExists",
        EXISTS(SELECT 1 FROM pg_attribute
          WHERE attrelid = (SELECT tableoid FROM ${relation} LIMIT 1)
            AND attname = ${`__row_${viewId}`} AND NOT attisdropped) AS "columnExists",
        EXISTS(SELECT 1 FROM ${relation} WHERE __id = ${recordId}) AS "recordExists"
    `.execute(dataDb);
    expect(state).toEqual({ viewExists: false, columnExists: false, recordExists: false });

    // At the boundary the same push remains valid and preserves view-order semantics.
    await sql`DELETE FROM ${relation} WHERE __id = 'rec00000000000001001'`.execute(dataDb);
    expect(unwrap(await pushService.execute(ctx, request)).newRevision).toBe(1);
    const col = sql.id(`__row_${viewId}`);
    const { rows: orders } = await sql<{ id: string; order: number }>`
      SELECT __id AS id, ${col} AS "order" FROM ${relation} ORDER BY ${col} LIMIT 2
    `.execute(dataDb);
    expect(orders).toEqual([
      { id: recordId, order: -2 },
      { id: priorRecordId, order: -1 },
    ]);
  });

  it('exhausts retries in the coordinated push owner and preserves a nested abort for the caller', async () => {
    const ctx = createContext();
    const { base } = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'Coordinated push retries' })._unsafeUnwrap()
      )
    );
    const id = base.id();
    const baseId = id.toString();
    const { table } = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'Retry target',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      )
    );
    const tableId = table.id().toString();
    const fieldId = table.primaryFieldId().toString();
    const { record } = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({ tableId, fields: { [fieldId]: 'before' } })._unsafeUnwrap()
      )
    );
    const recordId = record.id().toString();
    unwrap(await enableService.execute(ctx, { baseId }));
    const originPushId = 'vcsp_coordinated_retry';
    const request = {
      baseId,
      baseRevision: 0,
      originPushId,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch(tableId),
            recordsUpdated: [
              { recordId, cellChanges: [{ fieldId, before: 'before', after: 'after' }] },
            ],
          },
        ],
      },
    };
    const readCell = async () =>
      unwrap(await cloneService.execute(ctx, { baseId, tableIds: [tableId] })).snapshot.tables[0]
        .records[0].fields[fieldId];
    const attempts: { xid: string; leaseXid: string | undefined }[] = [];
    let failAttempts = 4;
    let sqlState: '40001' | '55P03' = '40001';
    const handle = UpdateRecordsHandler.prototype.handle;
    const write = vi
      .spyOn(UpdateRecordsHandler.prototype, 'handle')
      .mockImplementation(async function (this: UpdateRecordsHandler, txCtx, command) {
        const trx = getPostgresTransaction(txCtx, 'data')!;
        const { rows } = await sql<{ xid: string }>`
          SELECT pg_current_xact_id()::text AS xid
        `.execute(trx);
        const lease = resolveScopedTableSchemaLease(txCtx, [tableId], 'shared')?._unsafeUnwrap();
        attempts.push({ xid: rows[0].xid, leaseXid: lease?.fence?.transactionId });
        const result = await handle.call(this, txCtx, command);
        if (result.isOk() && failAttempts-- > 0) {
          await trx.executeQuery(
            CompiledQuery.raw(`DO $$ BEGIN
              RAISE EXCEPTION 'synthetic VCS write abort' USING ERRCODE = '${sqlState}';
            END $$;`)
          );
        }
        return result;
      });

    try {
      const failure = (await pushService.execute(ctx, request))._unsafeUnwrapErr();
      expect(failure).toMatchObject({ code: 'vcs.write_busy', details: { retryable: true } });
      expect((failure.cause as DomainError).cause).toMatchObject({ code: '40001' });
      expect(attempts).toHaveLength(4);
      expect(new Set(attempts.map(({ xid }) => xid)).size).toBe(4);
      const leaseXid = attempts[0].leaseXid;
      expect(leaseXid).toBeDefined();
      expect(
        attempts.every((attempt) => attempt.leaseXid === leaseXid && attempt.xid !== leaseXid)
      ).toBe(true);
      expect(await readCell()).toBe('before');
      expect(unwrap(await getHeadService.execute(ctx, { baseId })).headRevision).toBe(0);
      expect(
        unwrap(await logRepository.findCommitByOriginPushId(ctx, id, originPushId))
      ).toBeNull();

      attempts.length = 0;
      failAttempts = 4;
      sqlState = '55P03';
      const nonRetryable = (await pushService.execute(ctx, request))._unsafeUnwrapErr();
      expect(nonRetryable.code).toBe('unexpected');
      expect(nonRetryable.cause).toMatchObject({ code: '55P03' });
      expect(attempts).toHaveLength(1);

      attempts.length = 0;
      failAttempts = 1;
      sqlState = '40001';
      const result = unwrap(
        await pushService.withWriteCoordination(ctx, [tableId], [], 'shared', (leaseCtx) =>
          domainWriteTransaction.withBatchTransaction(
            leaseCtx,
            async (txCtx) => {
              const pushed = await pushService.execute(txCtx, request);
              if (pushed.isErr()) {
                expect(pushed.error.code).toBe('unexpected');
                expect(pushed.error.cause).toMatchObject({ code: '40001' });
              }
              return pushed;
            },
            { scope: 'data', isolationLevel: 'repeatable read' }
          )
        )
      );
      expect(attempts).toHaveLength(2);
      expect(attempts[0].xid).not.toBe(attempts[1].xid);
      expect(result.newRevision).toBe(1);
      expect(result.commitId).toBeDefined();
      expect(await readCell()).toBe('after');
      expect(unwrap(await pushService.execute(ctx, request)).commitId).toBe(result.commitId);
      expect(write).toHaveBeenCalledTimes(7);
      expect(unwrap(await getHeadService.execute(ctx, { baseId })).headRevision).toBe(1);
    } finally {
      write.mockRestore();
    }
  });

  it('(a) rejects delete operations missing before snapshots or record version', async () => {
    const ctx = createContext();
    const baseId = testContainer.baseId.toString();

    const missingFieldBefore = await pushService.execute(ctx, {
      baseId,
      baseRevision: 0,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch('tblValidation000001'),
            fieldsDeleted: [{ fieldId: 'fldValidation000001' }],
          },
        ],
      },
    });
    expect(missingFieldBefore.isErr()).toBe(true);
    expect(missingFieldBefore._unsafeUnwrapErr().code).toBe('vcs.invalid_push_payload');

    const missingViewBefore = await pushService.execute(ctx, {
      baseId,
      baseRevision: 0,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch('tblValidation000001'),
            viewsDeleted: [{ viewId: 'viwValidation000001' }],
          },
        ],
      },
    });
    expect(missingViewBefore.isErr()).toBe(true);
    expect(missingViewBefore._unsafeUnwrapErr().code).toBe('vcs.invalid_push_payload');

    const missingRecBefore = await pushService.execute(ctx, {
      baseId,
      baseRevision: 0,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch('tblValidation000001'),
            recordsDeleted: [{ recordId: 'recValidation000001' }],
          },
        ],
      },
    });
    expect(missingRecBefore.isErr()).toBe(true);
    expect(missingRecBefore._unsafeUnwrapErr().code).toBe('vcs.invalid_push_payload');

    const missingRecVersion = await pushService.execute(ctx, {
      baseId,
      baseRevision: 0,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch('tblValidation000001'),
            recordsDeleted: [
              {
                recordId: 'recValidation000001',
                before: {
                  id: 'recValidation000001',
                  fields: {},
                },
              },
            ],
          },
        ],
      },
    });
    expect(missingRecVersion.isErr()).toBe(true);
    expect(missingRecVersion._unsafeUnwrapErr().code).toBe('vcs.invalid_push_payload');

    const missingTableBefore = await pushService.execute(ctx, {
      baseId,
      baseRevision: 0,
      patch: {
        tablesAdded: [],
        tablesDeleted: [{ tableId: 'tblValidation000001', tableName: 'Orphan' } as never],
        tablesUpdated: [],
      },
    });
    expect(missingTableBefore.isErr()).toBe(true);
    expect(missingTableBefore._unsafeUnwrapErr().code).toBe('vcs.invalid_push_payload');
  });

  it('(b) rejects stale field/view/record deletes on live CAS and catches A->B->A record edits via __version', async () => {
    const ctx = createContext();
    const baseId = testContainer.baseId.toString();
    unwrap(await enableService.execute(ctx, { baseId }), 'enable(b)');

    const tableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId,
        name: 'CasDeleteTable',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', name: 'Notes' },
        ],
      })._unsafeUnwrap()
    );
    const { table } = unwrap(tableRes, 'createCasDeleteTable');
    const tableId = table.id().toString();
    const primaryFieldId = table.primaryFieldId().toString();
    const notesField = table.getFields().find((f) => f.name().toString() === 'Notes')!;
    const notesFieldId = notesField.id().toString();
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const createdRec = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: {
            [primaryFieldId]: 'Item-1',
            [notesFieldId]: 'Alpha',
          },
        })._unsafeUnwrap()
      ),
      'createCasRecord'
    ).record;
    const recordId = createdRec.id().toString();

    const cloneBefore = unwrap(
      await cloneService.execute(ctx, { baseId, tableIds: [tableId] }),
      'cloneCasBefore'
    );
    const clonedTable = cloneBefore.snapshot.tables.find((t) => t.id === tableId)!;
    const clonedRec = clonedTable.records.find((r) => r.id === recordId)!;
    const clonedNotesField = clonedTable.fields.find((f) => f.id === notesFieldId)!;
    const clonedView = clonedTable.views[0]!;
    expect(clonedRec.version).toBe(1);

    // Mutate A -> B -> A back to 'Alpha' so __version bumps from 1 -> 2 -> 3.
    unwrap(
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId,
          recordId,
          fields: { [notesFieldId]: 'Beta' },
        })._unsafeUnwrap()
      ),
      'mutateAtoB'
    );
    unwrap(
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId,
          recordId,
          fields: { [notesFieldId]: 'Alpha' },
        })._unsafeUnwrap()
      ),
      'mutateBtoA'
    );

    const staleRecordDeleteRes = await pushService.execute(ctx, {
      baseId,
      baseRevision: cloneBefore.snapshot.revision,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch(tableId),
            recordsDeleted: [
              {
                recordId,
                before: {
                  ...clonedRec,
                  version: clonedRec.version ?? 1,
                },
              },
            ],
          },
        ],
      },
    });
    expect(staleRecordDeleteRes.isErr()).toBe(true);
    const recErr = staleRecordDeleteRes._unsafeUnwrapErr();
    expect(recErr.code).toBe('vcs.cas_conflict');
    expect(recErr.tags).toContain('conflict');
    expect(recErr.details).toMatchObject({
      conflicts: [
        {
          entityType: 'record',
          entityId: recordId,
          before: { version: 1 },
          current: { version: 3 },
        },
      ],
    });

    const liveRow = await sql<{ __version: number }>`
      SELECT __version FROM ${sql.table(dbTableName)} WHERE __id = ${recordId}
    `.execute(dataDb);
    expect(liveRow.rows[0]?.__version).toBe(3);

    const staleFieldDeleteRes = await pushService.execute(ctx, {
      baseId,
      baseRevision: cloneBefore.snapshot.revision,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch(tableId),
            fieldsDeleted: [
              {
                fieldId: notesFieldId,
                before: { ...clonedNotesField, name: 'Outdated Notes Name' },
              },
            ],
          },
        ],
      },
    });
    expect(staleFieldDeleteRes.isErr()).toBe(true);
    expect(staleFieldDeleteRes._unsafeUnwrapErr().code).toBe('vcs.cas_conflict');

    const staleViewDeleteRes = await pushService.execute(ctx, {
      baseId,
      baseRevision: cloneBefore.snapshot.revision,
      patch: {
        tablesAdded: [],
        tablesDeleted: [],
        tablesUpdated: [
          {
            ...createEmptyTablePatch(tableId),
            viewsDeleted: [
              {
                viewId: clonedView.id,
                before: { ...clonedView, name: 'Outdated Grid Name' },
              },
            ],
          },
        ],
      },
    });
    expect(staleViewDeleteRes.isErr()).toBe(true);
    expect(staleViewDeleteRes._unsafeUnwrapErr().code).toBe('vcs.cas_conflict');
  });

  it('rejects a reviewed field edit after a live field edit at the same VCS revision', async () => {
    const ctx = createContext();
    const base = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'Promotion field CAS' })._unsafeUnwrap()
      )
    ).base;
    const baseId = base.id().toString();
    const { table } = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'Orders',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        })._unsafeUnwrap()
      )
    );
    const tableId = table.id().toString();
    const fieldId = table.primaryFieldId().toString();
    unwrap(await enableService.execute(ctx, { baseId }));
    const { snapshot: baseline } = unwrap(await cloneService.execute(ctx, { baseId }));
    const working = {
      ...baseline,
      tables: baseline.tables.map((item) => ({
        ...item,
        fields: item.fields.map((field) =>
          field.id === fieldId ? { ...field, name: 'Reviewed title' } : field
        ),
      })),
    };
    const patch = selectPromotionPatch(diffSnapshots(baseline, working), [], baseline);

    unwrap(
      await commandBus.execute(
        ctx,
        UpdateFieldCommand.create({
          tableId,
          fieldId,
          field: { name: 'Live title' },
        })._unsafeUnwrap()
      )
    );
    const { headRevision } = unwrap(await getHeadService.execute(ctx, { baseId }));
    expect(headRevision).toBe(baseline.revision);

    const result = await pushService.execute(ctx, {
      baseId,
      baseRevision: baseline.revision,
      patch,
    });
    const key = `${tableId}:field:${fieldId}`;
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'vcs.cas_conflict',
      details: {
        baseRevision: baseline.revision,
        headRevision,
        overlappingKeys: [key],
        conflicts: [
          {
            key,
            tableId,
            entityType: 'field',
            entityId: fieldId,
            before: { name: 'Title' },
            current: { name: 'Live title' },
          },
        ],
      },
    });
    const { snapshot: live } = unwrap(await cloneService.execute(ctx, { baseId }));
    expect(live.tables.find((item) => item.id === tableId)?.fields).toContainEqual(
      expect.objectContaining({ id: fieldId, name: 'Live title' })
    );
    expect(live.revision).toBe(baseline.revision);
  });

  it('(c) rolls back ALL data, change logs, and commit rows when a mid-push operation fails', async () => {
    const ctx = createContext();
    const baseId = testContainer.baseId.toString();
    unwrap(await enableService.execute(ctx, { baseId }), 'enable(c)');

    const safeTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'AtomicSafeTable',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createSafeTable'
    ).table;
    const failTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'AtomicFailTable',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createFailTable'
    ).table;

    const safeTableId = safeTable.id().toString();
    const safePrimaryFieldId = safeTable.primaryFieldId().toString();
    const safeDbTableName = safeTable.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const failTableId = failTable.id().toString();
    const failPrimaryFieldId = failTable.primaryFieldId().toString();
    const failDbTableName = failTable.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const failPgIdent = failDbTableName
      .split('.')
      .map((part) => `"${part.replaceAll('"', '""')}"`)
      .join('.');

    const headBefore = unwrap(await getHeadService.execute(ctx, { baseId }), 'getHeadBeforeFail');
    const cursorBefore = unwrap(
      await logRepository.capturePullCursor(ctx, testContainer.baseId),
      'captureCursorBeforeFail'
    );

    const fnName = `vcs_mid_push_abort_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
    const trigName = `trg_${fnName}`;
    await sql
      .raw(`
      CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'simulated mid-push physical failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${trigName}
      BEFORE INSERT ON ${failPgIdent}
      FOR EACH ROW EXECUTE FUNCTION ${fnName}();
    `)
      .execute(dataDb);

    const safeNewRecId = `rec${randomUUID().replaceAll('-', '').slice(0, 17)}`;
    const failNewRecId = `rec${randomUUID().replaceAll('-', '').slice(0, 17)}`;

    try {
      const pushRes = await pushService.execute(ctx, {
        baseId,
        baseRevision: headBefore.headRevision,
        originPushId: 'vcsp_mid_failure_should_rollback',
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              ...createEmptyTablePatch(safeTableId),
              recordsAdded: [
                {
                  id: safeNewRecId,
                  fields: { [safePrimaryFieldId]: 'MustRollbackSafe' },
                },
              ],
            },
            {
              ...createEmptyTablePatch(failTableId),
              recordsAdded: [
                {
                  id: failNewRecId,
                  fields: { [failPrimaryFieldId]: 'WillTriggerAbort' },
                },
              ],
            },
          ],
        },
      });
      expect(pushRes.isErr()).toBe(true);

      const safeRowCount = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text AS cnt FROM ${sql.table(safeDbTableName)}
        WHERE __id = ${safeNewRecId}
      `.execute(dataDb);
      expect(Number(safeRowCount.rows[0]?.cnt ?? 0)).toBe(0);

      const headAfter = unwrap(await getHeadService.execute(ctx, { baseId }), 'getHeadAfterFail');
      expect(headAfter.headRevision).toBe(headBefore.headRevision);
      const replayCheck = unwrap(
        await logRepository.findCommitByOriginPushId(
          ctx,
          testContainer.baseId,
          'vcsp_mid_failure_should_rollback'
        ),
        'findCommitAfterFail'
      );
      expect(replayCheck).toBeNull();

      const changesAfter = unwrap(
        await logRepository.listChangesSince(ctx, testContainer.baseId, cursorBefore, 100),
        'listChangesAfterFail'
      );
      expect(changesAfter.changes.filter((c) => c.entityId === safeNewRecId)).toEqual([]);
    } finally {
      await sql.raw(`DROP TRIGGER IF EXISTS ${trigName} ON ${failPgIdent};`).execute(dataDb);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fnName}();`).execute(dataDb);
    }
  });

  it('(d) runs end-to-end client/server sync with originPushId idempotency and two-way symmetric links', async () => {
    const ctx = createContext();
    const baseId = testContainer.baseId.toString();

    const companiesTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'SyncCompanies',
          fields: [{ type: 'singleLineText', name: 'CompanyName', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createSyncCompanies'
    ).table;
    const companiesTableId = companiesTable.id().toString();
    const companyNameFieldId = companiesTable.primaryFieldId().toString();

    const contactsTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'SyncContacts',
          fields: [
            { type: 'singleLineText', name: 'ContactName', isPrimary: true },
            {
              type: 'link',
              name: 'Company',
              options: {
                relationship: 'manyOne',
                foreignTableId: companiesTableId,
                lookupFieldId: companyNameFieldId,
                isOneWay: false,
              },
            },
          ],
        })._unsafeUnwrap()
      ),
      'createSyncContacts'
    ).table;
    const contactsTableId = contactsTable.id().toString();
    const contactNameFieldId = contactsTable.primaryFieldId().toString();
    const linkField = contactsTable.getFields().find((f) => f.type().toString() === 'link')!;
    const linkFieldId = linkField.id().toString();

    const comp1 = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: companiesTableId,
          fields: { [companyNameFieldId]: 'Acme' },
        })._unsafeUnwrap()
      ),
      'createComp1'
    ).record;
    const comp2 = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: companiesTableId,
          fields: { [companyNameFieldId]: 'Globex' },
        })._unsafeUnwrap()
      ),
      'createComp2'
    ).record;
    const contact1 = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: contactsTableId,
          fields: {
            [contactNameFieldId]: 'Alice',
            [linkFieldId]: { id: comp1.id().toString() },
          },
        })._unsafeUnwrap()
      ),
      'createAlice'
    ).record;

    await testContainer.processOutbox();

    const gateway = new DirectServerVcsRemoteGateway({
      ctx,
      enableService,
      getHeadService,
      cloneService,
      listChangesService,
      pushService,
    });

    const selectedTables = [companiesTableId, contactsTableId];
    const clientADir = mkdtempSync(joinPath(tmpdir(), 'vcs-pglite-a-'));
    const clientBDir = mkdtempSync(joinPath(tmpdir(), 'vcs-pglite-b-'));
    const clientA = await createIsolatedClientEngine(ctx, clientADir);
    const clientB = await createIsolatedClientEngine(ctx, clientBDir);

    try {
      const stateA = new InMemoryVcsStateRepository();
      const containerA = createV2VcsClientContainer({
        remoteGateway: gateway,
        localEngine: clientA.adapter,
        stateRepository: stateA,
      });
      const clonedA = unwrap(
        await containerA.resolve(CloneBaseVcsService).execute({ baseId, tableIds: selectedTables }),
        'clientAClone'
      );
      const initialRevision = clonedA.snapshot.revision;

      const stateB = new InMemoryVcsStateRepository();
      const containerB = createV2VcsClientContainer({
        remoteGateway: gateway,
        localEngine: clientB.adapter,
        stateRepository: stateB,
      });
      unwrap(
        await containerB.resolve(CloneBaseVcsService).execute({ baseId, tableIds: selectedTables }),
        'clientBClone'
      );

      unwrap(
        await clientA.adapter.applyPatch(baseId, {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              ...createEmptyTablePatch(contactsTableId),
              recordsUpdated: [
                {
                  recordId: contact1.id().toString(),
                  cellChanges: [
                    {
                      fieldId: linkFieldId,
                      before: { id: comp1.id().toString(), title: 'Acme' },
                      after: { id: comp2.id().toString(), title: 'Globex' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'applyLocalLinkEditA'
      );

      const pushOriginId = `vcsp_e2e_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const pushResult = unwrap(
        await containerA.resolve(PushBaseVcsService).execute({
          message: 'Relink Alice to Globex',
          originPushId: pushOriginId,
        }),
        'clientAPush'
      );
      expect(pushResult.ok).toBe(true);
      expect(pushResult.newRevision).toBe(initialRevision + 1);
      expect(pushResult.originPushId).toBe(pushOriginId);

      const idempotentRetry = unwrap(
        await pushService.execute(ctx, {
          baseId,
          baseRevision: initialRevision,
          originPushId: pushOriginId,
          patch: { tablesAdded: [], tablesDeleted: [], tablesUpdated: [] },
        }),
        'idempotentRetry'
      );
      expect(idempotentRetry.ok).toBe(true);
      expect(idempotentRetry.newRevision).toBe(initialRevision + 1);
      expect(idempotentRetry.commitId).toBe(pushResult.commitId);

      const pullResultA = unwrap(
        await containerA.resolve(PullBaseVcsService).execute(),
        'clientAPullOwnPush'
      );
      expect(pullResultA.conflicts).toEqual([]);
      expect(pullResultA.toRevision).toBe(initialRevision + 1);

      const cursorBeforeB = unwrap(await stateB.readConfig(), 'readConfigB')?.pullCursor;
      expect(cursorBeforeB).toBeDefined();

      const incrementalForB = unwrap(
        await listChangesService.execute(ctx, {
          baseId,
          cursor: cursorBeforeB!,
          sinceRevision: initialRevision,
          tableIds: selectedTables,
        }),
        'listChangesForB'
      );
      expect(incrementalForB.requiresFullSync).toBe(false);
      expect(incrementalForB.originPushIds).toEqual([pushOriginId]);
      const contactsDelta = incrementalForB.recordDeltas.find((d) => d.tableId === contactsTableId);
      const companiesDelta = incrementalForB.recordDeltas.find(
        (d) => d.tableId === companiesTableId
      );
      expect(contactsDelta?.upserts.map((r) => r.id)).toContain(contact1.id().toString());
      expect(companiesDelta?.upserts.map((r) => r.id)).toEqual(
        expect.arrayContaining([comp1.id().toString(), comp2.id().toString()])
      );

      const pullResultB = unwrap(
        await containerB.resolve(PullBaseVcsService).execute(),
        'clientBPull'
      );
      expect(pullResultB.conflicts).toEqual([]);
      expect(pullResultB.toRevision).toBe(initialRevision + 1);

      const bCompanies = pullResultB.workingSnapshot.tables.find((t) => t.id === companiesTableId)!;
      const bContacts = pullResultB.workingSnapshot.tables.find((t) => t.id === contactsTableId)!;
      const bAlice = bContacts.records.find((r) => r.id === contact1.id().toString())!;
      expect(bAlice.fields[linkFieldId]).toMatchObject({ id: comp2.id().toString() });

      const bSymmetricField = bCompanies.fields.find((f) => f.type === 'link')!;
      const bComp1 = bCompanies.records.find((r) => r.id === comp1.id().toString())!;
      const bComp2 = bCompanies.records.find((r) => r.id === comp2.id().toString())!;
      expect(bComp1.fields[bSymmetricField.id]).toBeUndefined();
      expect(bComp2.fields[bSymmetricField.id]).toEqual([
        expect.objectContaining({ id: contact1.id().toString() }),
      ]);

      // Reverse relink on Client B (Globex -> Acme) deterministically exercises both ID orderings.
      unwrap(
        await clientB.adapter.applyPatch(baseId, {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              ...createEmptyTablePatch(contactsTableId),
              recordsUpdated: [
                {
                  recordId: contact1.id().toString(),
                  cellChanges: [
                    {
                      fieldId: linkFieldId,
                      before: { id: comp2.id().toString(), title: 'Globex' },
                      after: { id: comp1.id().toString(), title: 'Acme' },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        'applyLocalReverseLinkEditB'
      );
      const reversePushRes = unwrap(
        await containerB.resolve(PushBaseVcsService).execute({
          message: 'Relink Alice back to Acme',
          originPushId: `vcsp_rev_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        }),
        'clientBReversePush'
      );
      expect(reversePushRes.ok).toBe(true);
      expect(reversePushRes.newRevision).toBe(initialRevision + 2);

      const pullBackA = unwrap(
        await containerA.resolve(PullBaseVcsService).execute(),
        'clientAPullReverse'
      );
      expect(pullBackA.conflicts).toEqual([]);
      expect(pullBackA.toRevision).toBe(initialRevision + 2);
      const aCompanies = pullBackA.workingSnapshot.tables.find((t) => t.id === companiesTableId)!;
      expect(
        aCompanies.records.find((r) => r.id === comp1.id().toString())?.fields[bSymmetricField.id]
      ).toEqual([expect.objectContaining({ id: contact1.id().toString() })]);
      expect(
        aCompanies.records.find((r) => r.id === comp2.id().toString())?.fields[bSymmetricField.id]
      ).toBeUndefined();
    } finally {
      await clientA.container.dispose().catch(() => undefined);
      await clientB.container.dispose().catch(() => undefined);
      rmSync(clientADir, { recursive: true, force: true });
      rmSync(clientBDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('(e) fails closed on split-DB and unenabled pushes without auto-enabling VCS', async () => {
    const ctx = createContext();

    // 1. Single-DB disabled push rejects with vcs.not_enabled and never enables VCS.
    const singleBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'DisabledSingleDb' })._unsafeUnwrap()
      ),
      'createSingleDisabledBase'
    ).base.id();

    const singlePushRes = await pushService.execute(ctx, {
      baseId: singleBase.toString(),
      baseRevision: 0,
      patch: { tablesAdded: [], tablesDeleted: [], tablesUpdated: [] },
    });
    expect(singlePushRes.isErr()).toBe(true);
    expect(singlePushRes._unsafeUnwrapErr().code).toBe('vcs.not_enabled');
    expect((await logRepository.isEnabled(ctx, singleBase))._unsafeUnwrap()).toBe(false);

    const newTblId = `tbl${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const newFldId = `fld${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const nonEmptySinglePushRes = await pushService.execute(ctx, {
      baseId: singleBase.toString(),
      baseRevision: 0,
      patch: {
        tablesAdded: [
          {
            id: newTblId,
            name: 'ShouldNotAutoEnable',
            primaryFieldId: newFldId,
            fields: [
              {
                id: newFldId,
                name: 'Title',
                type: 'singleLineText',
                isPrimary: true,
                isComputed: false,
              },
            ],
            views: [],
            records: [],
          },
        ],
        tablesDeleted: [],
        tablesUpdated: [],
      },
    });
    expect(nonEmptySinglePushRes.isErr()).toBe(true);
    expect(nonEmptySinglePushRes._unsafeUnwrapErr().code).toBe('vcs.not_enabled');
    expect((await logRepository.isEnabled(ctx, singleBase))._unsafeUnwrap()).toBe(false);

    // 2. Split Meta/Data DB push fails with batch.cross_database_not_atomic and never enables VCS.
    const { splitContainer, cleanup } = await setupSplitSchemaContainer(
      dataDb,
      testContainer.connectionString
    );
    try {
      const splitBaseId = splitContainer.baseId.toString();
      const splitPushSvc = splitContainer.container.resolve(PushVcsPatchService);
      const splitLogRepo = splitContainer.container.resolve<IBaseVcsLogRepository>(
        v2VcsServerTokens.logRepository
      );
      const splitCommandBus = splitContainer.container.resolve<ICommandBus>(
        v2CoreTokens.commandBus
      );

      const splitPushRes = await splitPushSvc.execute(ctx, {
        baseId: splitBaseId,
        baseRevision: 0,
        patch: { tablesAdded: [], tablesDeleted: [], tablesUpdated: [] },
      });
      expect(splitPushRes.isErr()).toBe(true);
      expect(splitPushRes._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');
      expect((await splitLogRepo.isEnabled(ctx, splitContainer.baseId))._unsafeUnwrap()).toBe(
        false
      );

      const splitTblId = `tbl${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const splitFldId = `fld${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const splitNonEmptyRes = await splitPushSvc.execute(ctx, {
        baseId: splitBaseId,
        baseRevision: 0,
        patch: {
          tablesAdded: [
            {
              id: splitTblId,
              name: 'SplitShouldReject',
              primaryFieldId: splitFldId,
              fields: [
                {
                  id: splitFldId,
                  name: 'Title',
                  type: 'singleLineText',
                  isPrimary: true,
                  isComputed: false,
                },
              ],
              views: [],
              records: [],
            },
          ],
          tablesDeleted: [],
          tablesUpdated: [],
        },
      });
      expect(splitNonEmptyRes.isErr()).toBe(true);
      expect(splitNonEmptyRes._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');
      expect((await splitLogRepo.isEnabled(ctx, splitContainer.baseId))._unsafeUnwrap()).toBe(
        false
      );

      // Normal schema mutations on the split DB still succeed after the rejected push.
      const normalTableRes = await splitCommandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: splitBaseId,
          name: 'SplitStillWorks',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      );
      expect(normalTableRes.isOk()).toBe(true);
    } finally {
      await cleanup();
    }
  }, 60_000);

  it('(f) keeps GET /clone read-only and blocks enable() behind MVCC pre-enable quiesce barrier', async () => {
    const ctx = createContext();
    const barrierBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'BarrierBase' })._unsafeUnwrap()
      ),
      'createBarrierBase'
    ).base.id();
    const barrierBaseId = barrierBase.toString();

    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: barrierBaseId,
          name: 'BarrierTable',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createBarrierTable'
    ).table;
    const tableId = table.id().toString();
    const primaryFieldId = table.primaryFieldId().toString();

    const record = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: { [primaryFieldId]: 'BeforeBarrier' },
        })._unsafeUnwrap()
      ),
      'createBarrierRec'
    ).record;
    const recordId = record.id().toString();

    // GET /clone while disabled is strictly read-only.
    const readonlyClone = unwrap(
      await cloneService.execute(ctx, { baseId: barrierBaseId }),
      'readonlyClone'
    );
    expect(readonlyClone.remoteMode).toBe('openapi-readonly');
    expect(readonlyClone.snapshot.cursor).toBeUndefined();
    expect((await logRepository.isEnabled(ctx, barrierBase))._unsafeUnwrap()).toBe(false);

    // Hold an active pre-enable write tx after it checks isEnabled (assigning an xid8) and mutates the row.
    let releasePreEnable!: () => void;
    const preEnableGate = new Promise<void>((resolveGate) => {
      releasePreEnable = resolveGate;
    });
    let markPreEnableUpdated!: () => void;
    const preEnableUpdated = new Promise<void>((resolveUpdated) => {
      markPreEnableUpdated = resolveUpdated;
    });

    const preEnableTxPromise = domainWriteTransaction.withBatchTransaction(
      ctx,
      async (batchCtx) => {
        const res = await commandBus.execute(
          batchCtx,
          UpdateRecordCommand.create({
            tableId,
            recordId,
            fields: { [primaryFieldId]: 'InFlightPreEnableWrite' },
          })._unsafeUnwrap()
        );
        if (res.isErr()) return err(res.error);
        markPreEnableUpdated();
        await preEnableGate;
        return ok(undefined);
      },
      { scope: 'data' }
    );

    try {
      await Promise.race([
        preEnableUpdated,
        preEnableTxPromise.then((res) => {
          throw new Error(`preEnableTx exited unexpectedly: ${JSON.stringify(res)}`);
        }),
      ]);

      let enableSettled = false;
      const enablePromise = enableService.execute(ctx, { baseId: barrierBaseId }).then((res) => {
        enableSettled = true;
        return res;
      });

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      expect(enableSettled).toBe(false);
      expect(unwrap(await logRepository.isEnabled(ctx, barrierBase))).toBe(false);

      releasePreEnable();
      const [txRes, enableRes] = await Promise.all([preEnableTxPromise, enablePromise]);
      expect(txRes.isOk()).toBe(true);
      expect(enableRes.isOk()).toBe(true);
      const checkpoint = unwrap(await logRepository.readHistoricalSnapshot(ctx, barrierBase, 0));
      expect(
        checkpoint.tables[0]?.records.find((r) => r.id === recordId)?.fields[primaryFieldId]
      ).toBe('InFlightPreEnableWrite');

      const postEnableClone = unwrap(
        await cloneService.execute(ctx, { baseId: barrierBaseId }),
        'postEnableClone'
      );
      expect(postEnableClone.remoteMode).toBe('v2-vcs');
      expect(postEnableClone.snapshot.cursor).toMatch(/^v2\|/);
      expect(
        postEnableClone.snapshot.tables[0]?.records.find((r) => r.id === recordId)?.fields[
          primaryFieldId
        ]
      ).toBe('InFlightPreEnableWrite');
    } finally {
      releasePreEnable();
      await preEnableTxPromise.catch(() => undefined);
    }
  }, 60_000);

  it('rejects a confirmed table rollback if a business insert commits after its snapshot', async () => {
    const ctx = createContext();
    const id = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'Concurrent rollback' })._unsafeUnwrap()
      )
    ).base.id();
    const baseId = id.toString();
    unwrap(await enableService.execute(ctx, { baseId }));
    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'New table',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        })._unsafeUnwrap()
      )
    ).table;
    const history = testContainer.container.resolve(BaseVcsHistoryService);
    const policy = testContainer.container.resolve<AllowAllVcsAccessPolicy>(
      v2VcsServerTokens.accessPolicy
    );
    const grant = vi
      .spyOn(policy, 'resolveHistoryAccess')
      .mockResolvedValue(ok({ kind: 'full' as const }));
    try {
      const preview = unwrap(await history.rollback(ctx, { baseId, revision: 0 }));
      if (!preview.dryRun) throw new Error('Expected rollback preview');
      expect(preview.patch.tablesDeleted.map((t) => t.tableId)).toContain(table.id().toString());
      const acquire = logRepository.lockPushPhysicalTargets.bind(logRepository);
      const lock = vi.spyOn(logRepository, 'lockPushPhysicalTargets');
      // Confirmation has taken its SERIALIZABLE snapshot, but has no write locks yet.
      lock.mockImplementationOnce(async (...args) => {
        unwrap(
          await commandBus.execute(
            withoutTransaction(args[0]),
            CreateRecordCommand.create({
              tableId: table.id().toString(),
              fields: { [table.primaryFieldId().toString()]: 'Keep me' },
            })._unsafeUnwrap()
          )
        );
        return acquire(...args);
      });
      const confirmed = await history
        .rollback(ctx, {
          baseId,
          revision: 0,
          confirmation: preview.confirmation,
        })
        .finally(() => lock.mockRestore());
      expect(confirmed._unsafeUnwrapErr()).toMatchObject({
        code: 'vcs.stale_rollback_preview',
        tags: ['conflict'],
      });
      const live = unwrap(await cloneService.execute(ctx, { baseId })).snapshot;
      expect(live.revision).toBe(0);
      expect(
        live.tables[0].records.map((r) => r.fields[table.primaryFieldId().toString()])
      ).toContain('Keep me');
      expect(unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 0)).tables).toEqual([]);
    } finally {
      grant.mockRestore();
    }
  }, 30_000);

  it('reads transaction-local record order columns across pages on a one-connection pool', async () => {
    const ctx = createContext();
    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: testContainer.baseId.toString(),
          name: 'Single connection orders',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        })._unsafeUnwrap()
      )
    ).table;
    const titles = ['First', 'Second'];
    unwrap(
      await commandBus.execute(
        ctx,
        CreateRecordsCommand.create({
          tableId: table.id().toString(),
          records: titles.map((title) => ({
            fields: { [table.primaryFieldId().toString()]: title },
          })),
        })._unsafeUnwrap()
      )
    );
    const single = await createV2NodeTestContainer({
      connectionString: testContainer.connectionString,
      ensureSchema: false,
      seedBase: false,
      schemaCoordination: false,
      registerDb: (container, config) =>
        registerV2PostgresDb(container, {
          pg: { ...config.pg, pool: { max: 1, connectionTimeoutMillis: 2000 } },
        }),
    });
    try {
      const transaction = single.container.resolve<IDomainWriteTransaction>(
        v2CoreTokens.domainWriteTransaction
      );
      const reader = single.container.resolve<ITableRecordQueryRepository>(
        v2CoreTokens.tableRecordQueryRepository
      );
      const read = await transaction.withBatchTransaction(
        ctx,
        async (tx) => {
          const trx = getPostgresTransaction(tx, 'data')!;
          const name = table
            .dbTableName()
            .andThen((n) => n.value())
            ._unsafeUnwrap();
          await sql`ALTER TABLE ${sql.table(name)} ADD COLUMN __row_local double precision DEFAULT 17`.execute(
            trx
          );
          const values = [];
          for await (const result of reader.findStream(tx, table, undefined, {
            mode: 'stored',
            includeOrders: true,
            batchSize: 1,
          })) {
            if (result.isErr()) return err(result.error);
            values.push({
              title: result.value.fields[table.primaryFieldId().toString()],
              order: result.value.orders?.local,
            });
          }
          return ok(values);
        },
        { scope: 'data', isolationLevel: 'repeatable read' }
      );
      expect(unwrap(read)).toEqual(titles.map((title) => ({ title, order: 17 })));
    } finally {
      await single.dispose();
    }
  });

  it('captures an ordinary dirty edit and a pushed edit without streaming the unchanged table', async () => {
    const ctx = createContext();
    const id = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'Incremental checkpoint' })._unsafeUnwrap()
      )
    ).base.id();
    const baseId = id.toString();
    async function createItems(name: string, count: number, withFormula = false) {
      const table = unwrap(
        await commandBus.execute<CreateTableCommand, CreateTableResult>(
          ctx,
          CreateTableCommand.create({
            baseId,
            name,
            fields: [
              { type: 'singleLineText', name: 'Title', isPrimary: true },
              ...(withFormula
                ? [{ type: 'formula' as const, name: 'Total', options: { expression: '1 + 1' } }]
                : []),
            ],
          })._unsafeUnwrap()
        )
      ).table;
      const fieldId = table.primaryFieldId().toString();
      const tableId = table.id().toString();
      const { records } = unwrap(
        await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
          ctx,
          CreateRecordsCommand.create({
            tableId,
            records: Array.from({ length: count }, (_, i) => ({
              fields: { [fieldId]: String(i) },
            })),
          })._unsafeUnwrap()
        )
      );
      return { fieldId, tableId, records };
    }
    const { fieldId, tableId, records } = await createItems('Changed', 300);
    const stable = await createItems('Stable formula', 1, true);
    unwrap(await enableService.execute(ctx, { baseId }));
    const dirtyId = records[0].id().toString();
    const pushedId = records[1].id().toString();
    unwrap(
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId,
          recordId: dirtyId,
          fields: { [fieldId]: 'Business edit' },
        })._unsafeUnwrap()
      )
    );
    const reader = testContainer.container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );
    const reads = vi.spyOn(reader, 'findStream');
    try {
      unwrap(
        await pushService.execute(ctx, {
          baseId,
          baseRevision: 0,
          patch: {
            tablesAdded: [],
            tablesDeleted: [],
            tablesUpdated: [
              {
                ...createEmptyTablePatch(tableId),
                recordsUpdated: [
                  {
                    recordId: pushedId,
                    cellChanges: [{ fieldId, before: '1', after: 'Pushed edit' }],
                  },
                ],
              },
            ],
          },
        })
      );
      const captures = reads.mock.calls.filter(
        ([, , , opts]) => opts?.mode === 'stored' && opts.includeOrders
      );
      expect(captures.map(([, table]) => table.id().toString())).toEqual([tableId]);
      const selected = captures[0][2];
      expect(
        selected instanceof RecordByIdsSpec && selected.recordIds().map(String).sort()
      ).toEqual([dirtyId, pushedId].sort());
      const before = unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 0));
      const after = unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 1));
      expect(after.tables.find((t) => t.id === stable.tableId)).toEqual(
        before.tables.find((t) => t.id === stable.tableId)
      );
      const original = before.tables.find((t) => t.id === tableId)!.records;
      expect(after.tables.find((t) => t.id === tableId)!.records).toEqual(
        original.map((row) => {
          if (row.id !== dirtyId && row.id !== pushedId) return row;
          return {
            ...row,
            version: row.version! + 1,
            fields: { [fieldId]: row.id === dirtyId ? 'Business edit' : 'Pushed edit' },
          };
        })
      );
    } finally {
      reads.mockRestore();
    }
  });

  it('commits a rollback receipt and checkpoint inside a serializable outer batch', async () => {
    const ctx = createContext();
    const id = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'Rollback receipt' })._unsafeUnwrap()
      )
    ).base.id();
    const baseId = id.toString();
    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'Items',
          fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        })._unsafeUnwrap()
      )
    ).table;
    unwrap(await enableService.execute(ctx, { baseId }));
    const initial = unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 0));
    const patch = {
      tablesAdded: [],
      tablesDeleted: [],
      tablesUpdated: [
        {
          ...createEmptyTablePatch(table.id().toString()),
          recordsAdded: [
            {
              id: `rec${randomUUID().replaceAll('-', '').slice(0, 17)}`,
              fields: { [table.primaryFieldId().toString()]: 'Added' },
            },
          ],
        },
      ],
    };
    expect(
      unwrap(await pushService.execute(ctx, { baseId, baseRevision: 0, patch })).newRevision
    ).toBe(1);
    const inverse = unwrap(await logRepository.compareHistoricalRevisions(ctx, id, 1, 0)).patch;
    const receipt = `vcsr_${randomUUID()}`;
    const options = { requireExactHead: true, rollbackCommitId: receipt };
    const stale = await pushService.execute(
      ctx,
      { baseId, baseRevision: 0, patch: inverse },
      options
    );
    expect(stale._unsafeUnwrapErr().code).toBe('vcs.non_fast_forward');
    const rollback = await domainWriteTransaction.withBatchTransaction(
      ctx,
      (tx) => pushService.execute(tx, { baseId, baseRevision: 1, patch: inverse }, options),
      { scope: 'data', isolationLevel: 'serializable' }
    );
    expect(unwrap(rollback)).toMatchObject({ commitId: receipt, newRevision: 2, rebased: false });
    expect(unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 2)).tables).toEqual(
      initial.tables
    );
    expect(
      unwrap(await logRepository.readHistoricalSnapshot(ctx, id, 1)).tables[0].records[0].fields
    ).toEqual({ [table.primaryFieldId().toString()]: 'Added' });
  });

  it('(g) locks records before metadata and revalidates a stale field after serialization retry', async () => {
    const ctx = createContext();
    const raceBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'MetaRaceBase' })._unsafeUnwrap()
      ),
      'createMetaRaceBase'
    ).base.id();
    const raceBaseId = raceBase.toString();
    unwrap(await enableService.execute(ctx, { baseId: raceBaseId }), 'enableMetaRace');

    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: raceBaseId,
          name: 'RaceTable',
          fields: [
            { type: 'singleLineText', name: 'Title', isPrimary: true },
            { type: 'singleLineText', name: 'Status' },
          ],
        })._unsafeUnwrap()
      ),
      'createRaceTable'
    ).table;
    const tableId = table.id().toString();
    const statusField = table.getFields().find((f) => f.name().toString() === 'Status')!;
    const statusFieldId = statusField.id().toString();
    const fieldId = table.primaryFieldId().toString();
    const record = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({ tableId, fields: { [fieldId]: 'Original' } })._unsafeUnwrap()
      )
    ).record;
    const recordId = record.id().toString();
    const physicalTable = table
      .dbTableName()
      .andThen((name) => name.value())
      ._unsafeUnwrap();

    const snap0 = unwrap(
      await cloneService.execute(ctx, { baseId: raceBaseId, tableIds: [tableId] }),
      'cloneMetaRace'
    ).snapshot;
    const beforeField = snap0.tables[0]!.fields.find((f) => f.id === statusFieldId)!;

    const acquire = logRepository.lockPushPhysicalTargets.bind(logRepository);
    const lock = vi.spyOn(logRepository, 'lockPushPhysicalTargets');
    lock.mockImplementationOnce(async (...args) => {
      const locked = await acquire(...args);
      if (locked.isErr()) return locked;
      await expect(
        sql`SELECT 1 FROM ${sql.table(physicalTable)} WHERE __id = ${recordId} FOR UPDATE NOWAIT`.execute(
          dataDb
        )
      ).rejects.toMatchObject({ code: '55P03' });

      // The push holds its data lock, but has not taken table_meta or head locks.
      await dataDb.transaction().execute(async (trx) => {
        await sql`SELECT 1 FROM table_meta WHERE id = ${tableId} FOR UPDATE NOWAIT`.execute(trx);
        await sql`SELECT 1 FROM base_vcs_head WHERE base_id = ${raceBaseId} FOR UPDATE NOWAIT`.execute(
          trx
        );
        await sql`SELECT 1 FROM field WHERE id = ${statusFieldId} FOR UPDATE NOWAIT`.execute(trx);
        await sql`
          UPDATE field SET name = 'ConcurrentServerRename', version = version + 1
          WHERE id = ${statusFieldId}
        `.execute(trx);
      });
      return locked;
    });

    try {
      const pushRes = await pushService.execute(ctx, {
        baseId: raceBaseId,
        baseRevision: snap0.revision,
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              ...createEmptyTablePatch(tableId),
              fieldsUpdated: [
                {
                  fieldId: statusFieldId,
                  before: beforeField,
                  after: { ...beforeField, name: 'ClientStaleRename' },
                },
              ],
              recordsUpdated: [
                { recordId, cellChanges: [{ fieldId, before: 'Original', after: 'Pushed' }] },
              ],
            },
          ],
        },
      });
      expect(pushRes._unsafeUnwrapErr().code).toBe('vcs.cas_conflict');
      expect(lock).toHaveBeenCalledTimes(2);

      const liveField = await sql<{ name: string }>`
        SELECT name FROM field WHERE id = ${statusFieldId}
      `.execute(testContainer.metaDb);
      expect(liveField.rows[0]?.name).toBe('ConcurrentServerRename');
    } finally {
      lock.mockRestore();
    }
  }, 60_000);

  it('(h) runs full live CAS on tablesDeleted[].before and leaves modified live tables intact', async () => {
    const ctx = createContext();
    const delBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'TableDeleteCasBase' })._unsafeUnwrap()
      ),
      'createDelBase'
    ).base.id();
    const delBaseId = delBase.toString();
    unwrap(await enableService.execute(ctx, { baseId: delBaseId }), 'enableDelBase');

    const table = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: delBaseId,
          name: 'ToDeleteTable',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createToDelete'
    ).table;
    const tableId = table.id().toString();
    const primaryFieldId = table.primaryFieldId().toString();

    unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: { [primaryFieldId]: 'InitialRow' },
        })._unsafeUnwrap()
      ),
      'createInitialDelRow'
    );

    const staleSnap = unwrap(
      await cloneService.execute(ctx, { baseId: delBaseId, tableIds: [tableId] }),
      'cloneBeforeModify'
    ).snapshot;
    const staleTableBefore = staleSnap.tables[0]!;

    // Concurrent server addition happens on the live table.
    const addedOnServer = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: { [primaryFieldId]: 'AddedOnServer' },
        })._unsafeUnwrap()
      ),
      'createServerRowBeforeDelete'
    ).record;

    const staleDeleteRes = await pushService.execute(ctx, {
      baseId: delBaseId,
      baseRevision: staleSnap.revision,
      patch: {
        tablesAdded: [],
        tablesDeleted: [
          {
            tableId,
            tableName: staleTableBefore.name,
            before: staleTableBefore,
          },
        ],
        tablesUpdated: [],
      },
    });
    expect(staleDeleteRes.isErr()).toBe(true);
    expect(staleDeleteRes._unsafeUnwrapErr().code).toBe('vcs.cas_conflict');

    // Table and server record must remain intact after CAS rejection.
    const afterRejectSnap = unwrap(
      await cloneService.execute(ctx, { baseId: delBaseId, tableIds: [tableId] }),
      'cloneAfterRejectDelete'
    ).snapshot;
    expect(afterRejectSnap.tables).toHaveLength(1);
    expect(afterRejectSnap.tables[0]!.records.map((r) => r.id)).toContain(
      addedOnServer.id().toString()
    );

    // Pushing delete with the fresh live `before` snapshot succeeds cleanly.
    const freshDeleteRes = unwrap(
      await pushService.execute(ctx, {
        baseId: delBaseId,
        baseRevision: afterRejectSnap.revision,
        patch: {
          tablesAdded: [],
          tablesDeleted: [
            {
              tableId,
              tableName: afterRejectSnap.tables[0]!.name,
              before: afterRejectSnap.tables[0]!,
            },
          ],
          tablesUpdated: [],
        },
      }),
      'cleanDeleteTablePush'
    );
    expect(freshDeleteRes.ok).toBe(true);
    const finalSnap = unwrap(
      await cloneService.execute(ctx, { baseId: delBaseId }),
      'cloneAfterCleanDelete'
    ).snapshot;
    expect(finalSnap.tables.find((t) => t.id === tableId)).toBeUndefined();
  }, 60_000);

  it('(i) dispatches computed rollup cascades via ISameTxProjectionDispatcher so incremental pulls see updated values', async () => {
    const ctx = createContext();
    const compBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'ComputedCascadeBase' })._unsafeUnwrap()
      ),
      'createCompBase'
    ).base.id();
    const compBaseId = compBase.toString();

    const ordersTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: compBaseId,
          name: 'Orders',
          fields: [
            { type: 'singleLineText', name: 'OrderName', isPrimary: true },
            { type: 'number', name: 'Amount' },
          ],
        })._unsafeUnwrap()
      ),
      'createOrdersTable'
    ).table;
    const ordersTableId = ordersTable.id().toString();
    const orderNameId = ordersTable.primaryFieldId().toString();
    const orderAmountId = ordersTable
      .getFields()
      .find((f) => f.name().toString() === 'Amount')!
      .id()
      .toString();

    const linkFieldId = `fld${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const customersTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: compBaseId,
          name: 'Customers',
          fields: [
            { type: 'singleLineText', name: 'CustomerName', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'OrderLink',
              options: {
                relationship: 'manyOne',
                foreignTableId: ordersTableId,
                lookupFieldId: orderNameId,
                isOneWay: true,
              },
            },
            {
              type: 'rollup',
              name: 'TotalAmount',
              options: { expression: 'sum({values})' },
              config: {
                linkFieldId,
                foreignTableId: ordersTableId,
                lookupFieldId: orderAmountId,
              },
            },
          ],
        })._unsafeUnwrap()
      ),
      'createCustomersTable'
    ).table;
    const customersTableId = customersTable.id().toString();
    const customerNameId = customersTable.primaryFieldId().toString();
    const totalAmountFieldId = customersTable
      .getFields()
      .find((f) => f.name().toString() === 'TotalAmount')!
      .id()
      .toString();

    const ord1 = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: ordersTableId,
          fields: { [orderNameId]: 'Ord-1', [orderAmountId]: 10 },
        })._unsafeUnwrap()
      ),
      'createOrd1'
    ).record;

    const cust1 = unwrap(
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: customersTableId,
          fields: {
            [customerNameId]: 'Cust-1',
            [linkFieldId]: { id: ord1.id().toString() },
          },
        })._unsafeUnwrap()
      ),
      'createCust1'
    ).record;
    await testContainer.processOutbox();

    unwrap(await enableService.execute(ctx, { baseId: compBaseId }), 'enableComputed');
    const clonedBefore = unwrap(
      await cloneService.execute(ctx, { baseId: compBaseId }),
      'cloneComputedBefore'
    );
    const cursorBefore = clonedBefore.snapshot.cursor!;
    expect(cursorBefore).toBeTruthy();

    unwrap(
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId: ordersTableId,
          recordId: ord1.id().toString(),
          fields: { [orderAmountId]: 42 },
        })._unsafeUnwrap()
      ),
      'updateOrd1Amount'
    );
    await testContainer.processOutbox();

    const delta = unwrap(
      await listChangesService.execute(ctx, {
        baseId: compBaseId,
        cursor: cursorBefore,
        sinceRevision: clonedBefore.snapshot.revision,
      }),
      'listComputedChanges'
    );
    expect(delta.requiresFullSync).toBe(false);
    const custDelta = delta.recordDeltas.find((d) => d.tableId === customersTableId);
    const updatedCust = custDelta?.upserts.find((r) => r.id === cust1.id().toString());
    expect(updatedCust?.fields[totalAmountFieldId]).toBe(42);
  }, 60_000);

  it('(j) supports streaming keyset clone, schema-only clone, O(delta) status/diff/pull, multi-tx chunked push, and mid-batch conflict resume', async () => {
    const ctx = createContext();
    const scaleBase = unwrap(
      await commandBus.execute<CreateBaseCommand, CreateBaseResult>(
        ctx,
        CreateBaseCommand.create({ name: 'VcsScaleBase' })._unsafeUnwrap()
      ),
      'createScaleBase'
    ).base.id();
    const baseId = scaleBase.toString();

    const groupsTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'ScaleGroups',
          fields: [{ type: 'singleLineText', name: 'GroupName', isPrimary: true }],
        })._unsafeUnwrap()
      ),
      'createScaleGroups'
    ).table;
    const groupsTableId = groupsTable.id().toString();
    const groupNameFieldId = groupsTable.primaryFieldId().toString();

    const linkFieldId = `fld${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const itemsTable = unwrap(
      await commandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId,
          name: 'ScaleItems',
          fields: [
            { type: 'singleLineText', name: 'ItemName', isPrimary: true },
            { type: 'number', name: 'Qty' },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Group',
              options: {
                relationship: 'manyOne',
                foreignTableId: groupsTableId,
                lookupFieldId: groupNameFieldId,
                isOneWay: false,
              },
            },
          ],
        })._unsafeUnwrap()
      ),
      'createScaleItems'
    ).table;
    const itemsTableId = itemsTable.id().toString();
    const itemNameFieldId = itemsTable.primaryFieldId().toString();
    const itemQtyFieldId = itemsTable
      .getFields()
      .find((f) => f.name().toString() === 'Qty')!
      .id()
      .toString();

    // Seed 20 groups and 200 linked items (220 total records across 2 tables)
    const createdGroups = unwrap(
      await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        ctx,
        CreateRecordsCommand.create({
          tableId: groupsTableId,
          records: Array.from({ length: 20 }, (_, i) => ({
            fields: { [groupNameFieldId]: `Group ${i}` },
          })),
        })._unsafeUnwrap()
      ),
      'seedScaleGroups'
    ).records;
    const createdItems = unwrap(
      await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        ctx,
        CreateRecordsCommand.create({
          tableId: itemsTableId,
          records: Array.from({ length: 200 }, (_, i) => ({
            fields: {
              [itemNameFieldId]: `Item ${i}`,
              [itemQtyFieldId]: i,
              [linkFieldId]: { id: createdGroups[i % createdGroups.length]!.id().toString() },
            },
          })),
        })._unsafeUnwrap()
      ),
      'seedScaleItems'
    ).records;
    await testContainer.processOutbox();

    const gateway = new DirectServerVcsRemoteGateway({
      ctx,
      enableService,
      getHeadService,
      cloneService,
      listChunkService,
      listChangesService,
      pushService,
    });
    const cloneSpy = vi.spyOn(gateway, 'cloneSnapshot');
    const chunkSpy = vi.spyOn(gateway, 'cloneTableRecordsChunk');

    // Enforce single-transaction ceiling on PushVcsPatchService directly
    const prevEnvLimit = process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS;
    process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS = '10';
    try {
      const oversizeRes = await pushService.execute(ctx, {
        baseId,
        baseRevision: 0,
        patch: {
          tablesAdded: [],
          tablesDeleted: [],
          tablesUpdated: [
            {
              ...createEmptyTablePatch(groupsTableId),
              recordsAdded: Array.from({ length: 12 }, (_, i) => ({
                id: `recTooBig${String(i).padStart(10, '0')}`,
                fields: { [groupNameFieldId]: `TooBig ${i}` },
              })),
            },
          ],
        },
      });
      expect(oversizeRes.isErr()).toBe(true);
      expect(oversizeRes._unsafeUnwrapErr().code).toBe('vcs.patch_too_large_for_single_tx');
    } finally {
      if (prevEnvLimit === undefined) {
        delete process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS;
      } else {
        process.env.TEABLE_VCS_MAX_SINGLE_TX_PUSH_OPS = prevEnvLimit;
      }
    }

    const workDir = mkdtempSync(joinPath(tmpdir(), 'vcs-scale-work-'));
    const schemaOnlyDir = mkdtempSync(joinPath(tmpdir(), 'vcs-scale-schemaonly-'));
    const client = await createIsolatedClientEngine(ctx, workDir);
    const schemaClient = await createIsolatedClientEngine(ctx, schemaOnlyDir);

    try {
      const stateRepo = new FileVcsStateRepository(workDir);
      const container = createV2VcsClientContainer({
        remoteGateway: gateway,
        localEngine: client.adapter,
        stateRepository: stateRepo,
      });
      const cloneSvc = container.resolve(CloneBaseVcsService);
      const statusSvc = container.resolve(GetBaseVcsStatusService);
      const diffSvc = container.resolve(DiffBaseVcsService);
      const pullSvc = container.resolve(PullBaseVcsService);
      const resolveSvc = container.resolve(ResolveBaseVcsConflictsService);
      const pushSvc = container.resolve(PushBaseVcsService);

      // 1. Streaming clone with chunkSize=50 over 220 records
      const cloned = unwrap(
        await cloneSvc.execute({ baseId, tableIds: [groupsTableId, itemsTableId], chunkSize: 50 }),
        'streamCloneScale'
      );
      expect(cloned.summary.recordsAdded).toBe(220);
      expect(cloneSpy).toHaveBeenCalledWith(baseId, {
        tableIds: [groupsTableId, itemsTableId],
        includeRecords: false,
      });
      // At least 5 chunk calls: 1 for 20 groups + 4 for 200 items
      expect(chunkSpy.mock.calls.length).toBeGreaterThanOrEqual(5);

      const readFullSpy = vi.spyOn(stateRepo, 'readBaseSnapshot');
      const readByIdsSpy = vi.spyOn(stateRepo, 'readBaseRecordsByIds');

      // 2. O(delta) status, diff, pull after local & server disjoint edits
      const localItemIds = [createdItems[5]!.id().toString(), createdItems[15]!.id().toString()];
      const serverItemIds = [
        createdItems[150]!.id().toString(),
        createdItems[160]!.id().toString(),
      ];

      const localCmdBus = client.container.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      unwrap(
        await localCmdBus.execute(
          ctx,
          UpdateRecordsCommand.create({
            tableId: itemsTableId,
            fieldKeyType: FieldKeyType.Id,
            records: localItemIds.map((id, idx) => ({
              id,
              fields: { [itemQtyFieldId]: 900 + idx },
            })),
          })._unsafeUnwrap()
        ),
        'localEditTwoRows'
      );
      await client.container.processOutbox();

      unwrap(
        await commandBus.execute(
          ctx,
          UpdateRecordsCommand.create({
            tableId: itemsTableId,
            fieldKeyType: FieldKeyType.Id,
            records: serverItemIds.map((id, idx) => ({
              id,
              fields: { [itemQtyFieldId]: 800 + idx },
            })),
          })._unsafeUnwrap()
        ),
        'serverEditTwoRows'
      );
      await testContainer.processOutbox();

      readFullSpy.mockClear();
      readByIdsSpy.mockClear();

      const statusRes = unwrap(await statusSvc.execute(), 'scaleStatus');
      expect(statusRes.hasChanges).toBe(true);
      expect(statusRes.summary.recordsUpdated).toBe(2);
      expect(readFullSpy).not.toHaveBeenCalled();

      const diffRes = unwrap(await diffSvc.execute(), 'scaleDiff');
      expect(diffRes.hasLocalChanges).toBe(true);
      expect(diffRes.hasRemoteChanges).toBe(true);
      expect(diffRes.conflicts).toHaveLength(0);
      expect(readFullSpy).not.toHaveBeenCalled();

      const pulledRes = unwrap(await pullSvc.execute(), 'scalePull');
      expect(pulledRes.conflicts).toHaveLength(0);
      expect(readFullSpy).not.toHaveBeenCalled();
      for (const call of readByIdsSpy.mock.calls) {
        expect(call[1].length).toBeLessThanOrEqual(10);
      }

      // Push the 2 local changes, verify clean status
      const pushSmallRes = unwrap(await pushSvc.execute(), 'pushSmallScale');
      expect(pushSmallRes.ok).toBe(true);
      const statusAfterSmall = unwrap(await statusSvc.execute(), 'statusAfterSmall');
      expect(statusAfterSmall.hasChanges).toBe(false);

      // 3. Multi-tx push (maxBatchSize=50) over 130 updates -> creates 3 commits & fast-forwards via lastOriginPushIds
      unwrap(
        await localCmdBus.execute(
          ctx,
          UpdateRecordsCommand.create({
            tableId: itemsTableId,
            fieldKeyType: FieldKeyType.Id,
            records: createdItems.slice(0, 130).map((rec, idx) => ({
              id: rec.id().toString(),
              fields: { [itemQtyFieldId]: 1000 + idx },
            })),
          })._unsafeUnwrap()
        ),
        'localBulkEdit130'
      );
      await client.container.processOutbox();

      readFullSpy.mockClear();
      const multiPush = unwrap(
        await pushSvc.execute({ message: 'Bulk scale push', maxBatchSize: 50 }),
        'multiBatchPush130'
      );
      expect(multiPush.ok).toBe(true);
      expect(multiPush.completedBatches).toBe(3);
      expect(multiPush.totalBatches).toBe(3);
      expect(multiPush.newRevision).toBe(multiPush.baseRevision + 3);
      expect(readFullSpy).not.toHaveBeenCalled();

      // Pull right after multi-batch push fast-forwards via lastOriginPushIds
      const pullOwnMulti = unwrap(await pullSvc.execute(), 'pullOwnMultiPush');
      expect(pullOwnMulti.conflicts).toEqual([]);
      expect((await statusSvc.execute())._unsafeUnwrap().hasChanges).toBe(false);

      // VCS batches scalar edits in canonical record-ID order, independent of creation order.
      const conflictRows = createdItems.slice(0, 120).map((record) => record.id().toString());
      conflictRows.sort((a, b) => a.localeCompare(b));
      const firstBatchSampleId = conflictRows[5]!;
      const conflictId = conflictRows[95]!;
      unwrap(
        await localCmdBus.execute(
          ctx,
          UpdateRecordsCommand.create({
            tableId: itemsTableId,
            fieldKeyType: FieldKeyType.Id,
            records: conflictRows.map((id, idx) => ({
              id,
              fields: { [itemQtyFieldId]: 2000 + idx },
            })),
          })._unsafeUnwrap()
        ),
        'localBulkEdit120ForConflict'
      );
      await client.container.processOutbox();

      // Server modifies row #95 (which falls into Batch 2 [80..119])
      unwrap(
        await commandBus.execute(
          ctx,
          UpdateRecordCommand.create({
            tableId: itemsTableId,
            recordId: conflictId,
            fields: { [itemQtyFieldId]: 9999 },
          })._unsafeUnwrap()
        ),
        'serverEditRow95'
      );
      await testContainer.processOutbox();

      const partialPush = unwrap(
        await pushSvc.execute({ message: 'Partial conflict push', maxBatchSize: 40 }),
        'partialConflictPush'
      );
      expect(partialPush.ok).toBe(false);
      expect(partialPush.completedBatches).toBe(2);
      expect(partialPush.totalBatches).toBe(3);
      expect(partialPush.conflictError?.code).toBe('vcs.cas_conflict');

      // Pull only has 1 real conflict (row #95); Batches 0 & 1 fast-forward from lastOriginPushIds!
      const pullAfterPartial = unwrap(await pullSvc.execute(), 'pullAfterPartial');
      expect(pullAfterPartial.conflicts).toHaveLength(1);
      expect(pullAfterPartial.conflicts[0]?.entityId).toBe(conflictId);

      // Resolve with ours (qty 2095), then push commits ONLY Batch 2 remaining edits
      const resolvedPartial = unwrap(
        await resolveSvc.execute({
          resolutions: {
            [pullAfterPartial.conflicts[0]!.id]: { strategy: 'ours' },
          },
        }),
        'resolvePartialOurs'
      );
      expect(resolvedPartial.remainingConflicts).toHaveLength(0);

      const resumePush = unwrap(
        await pushSvc.execute({ message: 'Resume Batch 2', maxBatchSize: 40 }),
        'resumePush'
      );
      expect(resumePush.ok).toBe(true);
      expect((await statusSvc.execute())._unsafeUnwrap().hasChanges).toBe(false);

      // Verify server reflects both Batch 0 (2005) and resumed Batch 2 resolved row (2095)
      const serverSnap = unwrap(
        await cloneService.execute(ctx, { baseId, tableIds: [itemsTableId] }),
        'verifyServerConverged'
      ).snapshot;
      const serverItems = serverSnap.tables[0]!.records;
      expect(serverItems.find((r) => r.id === firstBatchSampleId)?.fields[itemQtyFieldId]).toBe(
        2005
      );
      expect(serverItems.find((r) => r.id === conflictId)?.fields[itemQtyFieldId]).toBe(2095);

      // 5. Schema-only clone skips all 220 records while keeping schemas & dirty tracker ready
      const schemaRepo = new FileVcsStateRepository(schemaOnlyDir);
      const schemaContainer = createV2VcsClientContainer({
        remoteGateway: gateway,
        localEngine: schemaClient.adapter,
        stateRepository: schemaRepo,
      });
      const schemaCloneRes = unwrap(
        await schemaContainer
          .resolve(CloneBaseVcsService)
          .execute({ baseId, tableIds: [groupsTableId, itemsTableId], schemaOnly: true }),
        'schemaOnlyClone'
      );
      expect(schemaCloneRes.config.schemaOnly).toBe(true);
      expect(schemaCloneRes.summary.tablesAdded).toBe(2);
      expect(schemaCloneRes.summary.recordsAdded).toBe(0);
      expect(
        (await schemaContainer.resolve(GetBaseVcsStatusService).execute())._unsafeUnwrap()
          .hasChanges
      ).toBe(false);
    } finally {
      await client.container.dispose().catch(() => undefined);
      await schemaClient.container.dispose().catch(() => undefined);
      rmSync(workDir, { recursive: true, force: true });
      rmSync(schemaOnlyDir, { recursive: true, force: true });
    }
  }, 120_000);
});
