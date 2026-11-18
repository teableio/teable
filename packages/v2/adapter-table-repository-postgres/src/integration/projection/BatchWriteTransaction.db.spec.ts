/* eslint-disable @typescript-eslint/naming-convention */
import {
  getPostgresTransaction,
  registerV2PostgresDataDb,
  registerV2PostgresMetaDb,
  v2DataDbTokens,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pg';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  EventHandler,
  FieldCreated,
  FieldId,
  RecordId,
  TableCreated,
  TableId,
  UpsertRecordsCommand,
  domainError,
  registerSameTxProjection,
  unregisterEventHandler,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateRecordsResult,
  type CreateTableResult,
  type DomainError,
  type ICommandBus,
  type IDomainEvent,
  type IDomainWriteTransaction,
  type IEventHandler,
  type IExecutionContext,
  type ITableRecordRepository,
  type IUnitOfWork,
  type UpsertRecordsResult,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { sql, type Kysely } from 'kysely';
import { err, ok, type Result } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensureV1MetaSchema } from '../../../../adapter-repository-postgres/src/db/schema';
import { setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

const createContext = (actor = 'system'): IExecutionContext => ({
  actorId: ActorId.create(actor)._unsafeUnwrap(),
});

const relationExists = async (
  db: Kysely<V1TeableDatabase>,
  schema: string,
  tableName: string
): Promise<boolean> => {
  const result = await sql<{ exists: boolean }>`
    SELECT to_regclass(${`"${schema}"."${tableName}"`}) IS NOT NULL AS exists
  `.execute(db);
  return result.rows[0]?.exists ?? false;
};

describe('BatchWriteTransaction & SameTx Schema Projections (db)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  const resolvedDatabaseUrl =
    process.env.TEABLE_V2_TEST_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL ??
    '';
  const isExplicitPglite =
    resolvedDatabaseUrl === 'memory://' || resolvedDatabaseUrl.startsWith('pglite://');
  const hasRealPostgres = !isExplicitPglite;

  const registerContainerCleanup = (
    tc: Awaited<ReturnType<typeof createV2NodeTestContainer>>
  ): void => {
    cleanups.push(async () => {
      await tc.db
        .deleteFrom('domain_event_outbox')
        .where('base_id', '=', tc.baseId.toString())
        .execute()
        .catch(() => undefined);
      await tc.dispose().catch(() => undefined);
    });
  };

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      await cleanup?.();
    }
  });

  it('Item 1 & 9: retries on 40P01 deadlock SQLSTATE without emitting ghost events or duplicate rows', async () => {
    const tc = await createV2NodeTestContainer();
    setV2NodeTestContainer(tc);
    registerContainerCleanup(tc);
    const { container, db, baseId, eventBus } = tc;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const domainWriteTx = container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );

    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const recordId = RecordId.generate()._unsafeUnwrap().toString();
    const fieldId = FieldId.generate()._unsafeUnwrap().toString();

    let attempts = 0;
    const res = await domainWriteTx.withBatchTransaction(createContext(), async (batchCtx) => {
      attempts += 1;
      const attemptNo = attempts;

      const createTableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        batchCtx,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: `Retry Table Attempt ${attemptNo}`,
          fields: [{ type: 'singleLineText', id: fieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      if (createTableRes.isErr()) return err(createTableRes.error);

      const createRecRes = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        batchCtx,
        CreateRecordsCommand.create({
          tableId,
          records: [{ id: recordId, fields: { [fieldId]: `attempt-${attemptNo}` } }],
        })._unsafeUnwrap()
      );
      if (createRecRes.isErr()) return err(createRecRes.error);

      if (attemptNo === 1) {
        const pgTrx = getPostgresTransaction<V1TeableDatabase>(batchCtx, 'data')!;
        // Trigger a genuine PostgreSQL SQLSTATE 40P01 (deadlock_detected) after writes + event queuing
        await sql
          .raw(`DO $$ BEGIN RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01'; END $$;`)
          .execute(pgTrx);
      }

      return ok({ attemptNo, tableId });
    });

    expect(res.isOk()).toBe(true);
    expect(attempts).toBe(2);

    // Real PG table_meta has strictly 1 row (for attempt 2)
    const metaRows = await db
      .selectFrom('table_meta')
      .select(['id', 'name'])
      .where('id', '=', tableId)
      .execute();
    expect(metaRows).toEqual([{ id: tableId, name: 'Retry Table Attempt 2' }]);

    // Physical table has strictly attempt-2 value
    const fieldRow = await db
      .selectFrom('field')
      .select(['db_field_name'])
      .where('id', '=', fieldId)
      .executeTakeFirstOrThrow();
    const recRows = await sql<{ val: string }>`
      SELECT ${sql.ref(fieldRow.db_field_name)} AS val
      FROM ${sql.table(`${baseId.toString()}.${tableId}`)}
    `.execute(db);
    expect(recRows.rows).toEqual([{ val: 'attempt-2' }]);

    // Outbox & eventBus received ONLY attempt 2 events (1 TableCreated + 1 RecordCreated, no ghost events from attempt 1)
    const outboxRows = await db
      .selectFrom('domain_event_outbox')
      .selectAll()
      .where('base_id', '=', baseId.toString())
      .execute();
    const recordOutboxRows = outboxRows.filter((r) =>
      r.message_name.toLowerCase().includes('record')
    );
    expect(recordOutboxRows).toHaveLength(1);
    const publishedNames = eventBus.events().map((e) => e.name.toString());
    expect(publishedNames.filter((n) => n === 'TableCreated')).toHaveLength(1);
    expect(publishedNames.filter((n) => n === 'RecordCreated')).toHaveLength(1);
  });

  it('Item 3 & 9: rolls back metadata, physical DDL/rows, outbox, and events when step k fails or is swallowed', async () => {
    const tc = await createV2NodeTestContainer();
    setV2NodeTestContainer(tc);
    registerContainerCleanup(tc);
    const { container, db, baseId, eventBus } = tc;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const domainWriteTx = container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );

    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const fieldId = FieldId.generate()._unsafeUnwrap().toString();

    const result = await domainWriteTx.withBatchTransaction(createContext(), async (batchCtx) => {
      const created = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        batchCtx,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: 'Swallowed Rollback Table',
          fields: [{ type: 'singleLineText', id: fieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(created.isOk()).toBe(true);

      const recOk = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        batchCtx,
        CreateRecordsCommand.create({
          tableId,
          records: [{ fields: { [fieldId]: 'will rollback' } }],
        })._unsafeUnwrap()
      );
      expect(recOk.isOk()).toBe(true);

      // Step k fails with nonexistent table/constraint inside batch, and caller SWALLOWS the err!
      const badStep = await domainWriteTx.execute(batchCtx, async () =>
        err(domainError.conflict({ code: 'cas.mismatch', message: 'live CAS mismatch at step 3' }))
      );
      expect(badStep.isErr()).toBe(true);

      // Even a subsequent write after rollback-only must fail fast and never commit
      return ok('caller-ignored-step-3-failure');
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('cas.mismatch');

    const metaRows = await db
      .selectFrom('table_meta')
      .select(['id'])
      .where('id', '=', tableId)
      .execute();
    expect(metaRows).toHaveLength(0);
    expect(await relationExists(db, baseId.toString(), tableId)).toBe(false);
    expect(
      await db
        .selectFrom('domain_event_outbox')
        .selectAll()
        .where('base_id', '=', baseId.toString())
        .execute()
    ).toHaveLength(0);
    expect(eventBus.events()).toHaveLength(0);
  });

  it('Item 2 & 9: throwing afterCommit task does not abort caller ok result or drop remaining tasks', async () => {
    const tc = await createV2NodeTestContainer();
    setV2NodeTestContainer(tc);
    registerContainerCleanup(tc);
    const { container, db, baseId, eventBus, spyLogger } = tc;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const domainWriteTx = container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );

    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const fieldId = FieldId.generate()._unsafeUnwrap().toString();
    const ran: string[] = [];

    const res = await domainWriteTx.withBatchTransaction(createContext(), async (batchCtx) => {
      const created = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        batchCtx,
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: 'AfterCommit Isolated Table',
          fields: [{ type: 'singleLineText', id: fieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      if (created.isErr()) return err(created.error);

      batchCtx.batchTransaction!.enqueueAfterCommit(async () => {
        ran.push('task-throws');
        throw new Error('injected post-commit boom');
      });
      batchCtx.batchTransaction!.enqueueAfterCommit(async () => {
        ran.push('task-survives');
      });

      const rec = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        batchCtx,
        CreateRecordsCommand.create({
          tableId,
          records: [{ fields: { [fieldId]: 'persisted-ok' } }],
        })._unsafeUnwrap()
      );
      if (rec.isErr()) return err(rec.error);

      return ok('batch-committed');
    });

    expect(res.isOk()).toBe(true);
    expect(res._unsafeUnwrap()).toBe('batch-committed');
    expect(ran).toEqual(['task-throws', 'task-survives']);
    expect(eventBus.events().map((e) => e.name.toString())).toEqual([
      'TableCreated',
      'RecordCreated',
    ]);
    const metaRows = await db
      .selectFrom('table_meta')
      .select(['id'])
      .where('id', '=', tableId)
      .execute();
    expect(metaRows).toHaveLength(1);
    const errEntries = spyLogger
      .getEntriesByMessage('batch_after_commit_task_failed')
      .filter((entry) => entry.level === 'error');
    expect(errEntries.length).toBeGreaterThan(0);
  });

  it.runIf(hasRealPostgres)(
    'Item 4 & 9 (real PG): split Meta/Data physical databases reject cross-db schema batch with batch.cross_database_not_atomic while allowing data-only batch',
    async () => {
      const baseTc = await createV2NodeTestContainer();
      const baseConnection = baseTc.connectionString;
      const isPglite =
        !baseConnection || baseConnection === 'memory://' || baseConnection.startsWith('pglite://');
      const splitDbName = `teable_v2_split_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      let createdSplitDb = false;

      // Push baseTc cleanup BEFORE creating splitTc so cleanups.pop() (LIFO) disposes splitTc
      // first, drops the split DB second, and stops baseTc's Testcontainer last.
      cleanups.push(async () => {
        if (createdSplitDb && !isPglite) {
          await sql
            .raw(`DROP DATABASE IF EXISTS "${splitDbName}" WITH (FORCE)`)
            .execute(baseTc.db)
            .catch(() => undefined);
        }
        await baseTc.dispose().catch(() => undefined);
      });

      if (isPglite) {
        return;
      }

      const parsedUrl = new URL(baseConnection);
      parsedUrl.pathname = `/${splitDbName}`;
      const splitDataUrl = parsedUrl.toString();
      await sql.raw(`CREATE DATABASE "${splitDbName}"`).execute(baseTc.db);
      createdSplitDb = true;

      const splitTc = await createV2NodeTestContainer({
        connectionString: baseConnection,
        registerDb: async (c, metaConfig) => {
          await registerV2PostgresMetaDb(c, metaConfig);
          const dataConfig = { pg: { connectionString: splitDataUrl } };
          await registerV2PostgresDataDb(c, dataConfig);
          const dataDb = c.resolve<Kysely<V1TeableDatabase>>(v2DataDbTokens.db);
          await ensureV1MetaSchema(dataDb);
          c.registerInstance(v2PostgresDbTokens.db, dataDb);
          c.registerInstance(v2PostgresDbTokens.config, dataConfig);
        },
      });
      cleanups.push(async () => {
        const splitBaseId = splitTc.baseId.toString();
        await splitTc.dataDb
          .deleteFrom('domain_event_outbox')
          .where('base_id', '=', splitBaseId)
          .execute()
          .catch(() => undefined);
        await splitTc.metaDb
          .deleteFrom('domain_event_outbox')
          .where('base_id', '=', splitBaseId)
          .execute()
          .catch(() => undefined);
        await splitTc.dispose().catch(() => undefined);
      });

      const { container, metaDb, dataDb, baseId } = splitTc;
      expect(metaDb).not.toBe(dataDb);
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const domainWriteTx = container.resolve<IDomainWriteTransaction>(
        v2CoreTokens.domainWriteTransaction
      );

      const rejectedTableId = TableId.generate()._unsafeUnwrap().toString();
      const schemaBatchRes = await domainWriteTx.withBatchTransaction(
        createContext(),
        async (batchCtx) =>
          commandBus.execute<CreateTableCommand, CreateTableResult>(
            batchCtx,
            CreateTableCommand.create({
              baseId: baseId.toString(),
              tableId: rejectedTableId,
              name: 'Split Cross-DB Should Reject',
              fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
              views: [{ type: 'grid' }],
            })._unsafeUnwrap()
          ),
        { scope: 'data' }
      );

      expect(schemaBatchRes.isErr()).toBe(true);
      expect(schemaBatchRes._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');
      expect(
        await metaDb
          .selectFrom('table_meta')
          .select(['id'])
          .where('id', '=', rejectedTableId)
          .execute()
      ).toHaveLength(0);
      expect(await relationExists(dataDb, baseId.toString(), rejectedTableId)).toBe(false);

      // Pre-create table outside batch, then verify data-only batch works atomically on split Data DB
      const recordTableId = TableId.generate()._unsafeUnwrap().toString();
      const recordFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const preCreated = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        createContext(),
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId: recordTableId,
          name: 'Split Record-Only Table',
          fields: [{ type: 'singleLineText', id: recordFieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(preCreated.isOk()).toBe(true);

      const dataOnlyRes = await domainWriteTx.withBatchTransaction(
        createContext(),
        async (batchCtx) => {
          const r1 = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
            batchCtx,
            CreateRecordsCommand.create({
              tableId: recordTableId,
              records: [{ fields: { [recordFieldId]: 'row-1' } }],
            })._unsafeUnwrap()
          );
          if (r1.isErr()) return err(r1.error);
          return commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
            batchCtx,
            CreateRecordsCommand.create({
              tableId: recordTableId,
              records: [{ fields: { [recordFieldId]: 'row-2' } }],
            })._unsafeUnwrap()
          );
        },
        { scope: 'data' }
      );
      expect(dataOnlyRes.isOk()).toBe(true);
    }
  );

  it('Item 7 & 12: non-batch TableCreated & FieldCreated run @SameTxProjectionHandler once in tx and abort DDL on err', async () => {
    const tc = await createV2NodeTestContainer();
    setV2NodeTestContainer(tc);
    registerContainerCleanup(tc);
    const { container, db, baseId, eventBus } = tc;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

    const calls: Array<{ eventName: string; inTx: boolean; hasPrev: boolean }> = [];
    let shouldAbortFieldCreated = false;

    class PgSchemaSameTxHandler implements IEventHandler<IDomainEvent> {
      async handle(
        ctx: IExecutionContext,
        event: IDomainEvent
      ): Promise<Result<void, DomainError>> {
        const inTx = Boolean(getPostgresTransaction(ctx, 'data'));
        calls.push({
          eventName: event.name.toString(),
          inTx,
          hasPrev: Boolean(ctx.sameTxProjection?.previousTables?.size),
        });
        if (shouldAbortFieldCreated && event.name.toString() === 'FieldCreated') {
          return err(domainError.unexpected({ code: 'test.same_tx_abort', message: 'abort ddl' }));
        }
        return ok(undefined);
      }
    }

    // Even if also decorated for bus dispatch, MemoryEventBus must NEVER run it a second time
    EventHandler(TableCreated as never, { role: 'projection' })(PgSchemaSameTxHandler as never);
    EventHandler(FieldCreated as never, { role: 'projection' })(PgSchemaSameTxHandler as never);
    container.registerInstance(PgSchemaSameTxHandler, new PgSchemaSameTxHandler());
    // Note: Noop registration inside container isn't needed for direct SameTxProjectionDispatcher
    const unregTable = registerSameTxProjection(
      TableCreated as never,
      PgSchemaSameTxHandler as never,
      { id: 'pg-test-same-tx-table' }
    );
    const unregField = registerSameTxProjection(
      FieldCreated as never,
      PgSchemaSameTxHandler as never,
      { id: 'pg-test-same-tx-field' }
    );
    cleanups.push(unregTable, unregField, () => {
      shouldAbortFieldCreated = false;
      unregisterEventHandler(TableCreated as never, PgSchemaSameTxHandler as never);
      unregisterEventHandler(FieldCreated as never, PgSchemaSameTxHandler as never);
    });

    // Ensure MemoryEventBus resolver sees PgSchemaSameTxHandler
    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const createTableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      CreateTableCommand.create({
        baseId: baseId.toString(),
        tableId,
        name: 'NonBatch Schema SameTx',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    expect(createTableRes.isOk()).toBe(true);
    expect(calls).toEqual([{ eventName: 'TableCreated', inTx: true, hasPrev: false }]);

    // Now test CreateFieldCommand -> TableUpdateFlow non-batch with previousTables + single invocation
    const fieldOkRes = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      createContext(),
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field: { type: 'number', name: 'AddedOk' },
      })._unsafeUnwrap()
    );
    expect(fieldOkRes.isOk()).toBe(true);
    expect(calls).toEqual([
      { eventName: 'TableCreated', inTx: true, hasPrev: false },
      { eventName: 'FieldCreated', inTx: true, hasPrev: true },
    ]);

    // Now abort in @SameTxProjectionHandler during non-batch CreateFieldCommand -> DDL & field metadata roll back!
    const abortedFieldId = FieldId.generate()._unsafeUnwrap().toString();
    shouldAbortFieldCreated = true;
    const fieldFailRes = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      createContext(),
      CreateFieldCommand.create({
        baseId: baseId.toString(),
        tableId,
        field: { id: abortedFieldId, type: 'singleLineText', name: 'AbortedCol' },
      })._unsafeUnwrap()
    );
    expect(fieldFailRes.isErr()).toBe(true);
    expect(fieldFailRes._unsafeUnwrapErr().code).toBe('test.same_tx_abort');

    const persistedFields = await db
      .selectFrom('field')
      .select(['id'])
      .where('id', '=', abortedFieldId)
      .execute();
    expect(persistedFields).toHaveLength(0);
    // Ensure eventBus never published failed FieldCreated
    const publishedFieldCreated = eventBus
      .events()
      .filter((e) => e.name.toString() === 'FieldCreated');
    expect(publishedFieldCreated).toHaveLength(1);
  });

  it('isolates savepoint rollback-only state and SQL writes so a recovered batch commits cleanly', async () => {
    const tc = await createV2NodeTestContainer();
    setV2NodeTestContainer(tc);
    registerContainerCleanup(tc);
    const { container, db, baseId, eventBus } = tc;
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const domainWriteTx = container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );

    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const keyFieldId = FieldId.generate()._unsafeUnwrap().toString();
    const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      createContext(),
      CreateTableCommand.create({
        baseId: baseId.toString(),
        tableId,
        name: 'Savepoint Batch Table',
        fields: [{ type: 'singleLineText', id: keyFieldId, name: 'Key', isPrimary: true }],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    expect(createdTable.isOk()).toBe(true);
    const eventsBeforeBatch = eventBus.events().length;
    const txCallbackLog: string[] = [];

    const batchRes = await domainWriteTx.withBatchTransaction(createContext(), async (batchCtx) => {
      batchCtx.transaction?.afterCommit?.(() => {
        txCallbackLog.push('outer-tx-after-commit');
      });

      const sibling = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        batchCtx,
        CreateRecordsCommand.create({
          tableId,
          records: [{ fields: { [keyFieldId]: 'sibling-1' } }],
        })._unsafeUnwrap()
      );
      if (sibling.isErr()) return err(sibling.error);

      const spErr = await domainWriteTx.savepoint(batchCtx, async () => {
        batchCtx.transaction?.afterCommit?.(() => {
          txCallbackLog.push('failed-sp-tx-after-commit');
        });
        batchCtx.transaction?.afterRollback?.(() => {
          txCallbackLog.push('failed-sp-tx-after-rollback');
        });

        const rolledBackCreate = await commandBus.execute<
          CreateRecordsCommand,
          CreateRecordsResult
        >(
          batchCtx,
          CreateRecordsCommand.create({
            tableId,
            records: [{ fields: { [keyFieldId]: 'sp-rolled-back' } }],
          })._unsafeUnwrap()
        );
        expect(rolledBackCreate.isOk()).toBe(true);

        return domainWriteTx.execute(batchCtx, async () =>
          err(domainError.validation({ code: 'validation.field.unique', message: 'dup key' }))
        );
      });
      expect(spErr.isErr()).toBe(true);
      expect(spErr._unsafeUnwrapErr().code).toBe('validation.field.unique');

      const recovered = await domainWriteTx.savepoint(batchCtx, async () => {
        batchCtx.transaction?.afterCommit?.(() => {
          txCallbackLog.push('recovered-sp-tx-after-commit');
        });
        return commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
          batchCtx,
          CreateRecordsCommand.create({
            tableId,
            records: [{ fields: { [keyFieldId]: 'recovered-2' } }],
          })._unsafeUnwrap()
        );
      });
      if (recovered.isErr()) return err(recovered.error);

      return ok('batch-ok');
    });

    expect(batchRes.isOk()).toBe(true);
    expect(txCallbackLog).toEqual([
      'failed-sp-tx-after-rollback',
      'outer-tx-after-commit',
      'recovered-sp-tx-after-commit',
    ]);
    const keyDbName = (
      await db
        .selectFrom('field')
        .select(['db_field_name'])
        .where('id', '=', keyFieldId)
        .executeTakeFirstOrThrow()
    ).db_field_name;
    const rows = await sql<{ val: string }>`
      SELECT ${sql.ref(keyDbName)} AS val
      FROM ${sql.table(`${baseId.toString()}.${tableId}`)}
      ORDER BY __auto_number ASC
    `.execute(db);
    expect(rows.rows.map((r) => r.val)).toEqual(['sibling-1', 'recovered-2']);

    const batchPublished = eventBus.events().slice(eventsBeforeBatch);
    expect(batchPublished.map((e) => e.name.toString())).toEqual([
      'RecordCreated',
      'RecordCreated',
    ]);
  });

  it.runIf(hasRealPostgres)(
    'real PG: UpsertRecordsCommand in withBatchTransaction recovers from genuine 23505 savepoint conflict and commits outer batch',
    async () => {
      const tc = await createV2NodeTestContainer();
      setV2NodeTestContainer(tc);
      registerContainerCleanup(tc);
      const { container, db, baseId, eventBus } = tc;
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const domainWriteTx = container.resolve<IDomainWriteTransaction>(
        v2CoreTokens.domainWriteTransaction
      );
      const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
      const recordRepo = container.resolve<ITableRecordRepository>(
        v2CoreTokens.tableRecordRepository
      );

      const tableId = TableId.generate()._unsafeUnwrap().toString();
      const keyFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const titleFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const statusFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        createContext(),
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: 'Batch Upsert Race Table',
          fields: [
            {
              type: 'singleLineText',
              id: keyFieldId,
              name: 'Key',
              unique: true,
              isPrimary: true,
            },
            { type: 'singleLineText', id: titleFieldId, name: 'Title' },
            {
              type: 'singleSelect',
              id: statusFieldId,
              name: 'Status',
              options: { choices: [{ name: 'Open', color: 'blueBright' }] },
            },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(createdTable.isOk()).toBe(true);

      // Keep the sibling write on a separate table so siblingCreate's table_meta row lock does not
      // block the concurrent second-connection winner insert on tableId inside this single-fiber test.
      const siblingTableId = TableId.generate()._unsafeUnwrap().toString();
      const siblingKeyFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const siblingTitleFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const createdSiblingTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        createContext(),
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId: siblingTableId,
          name: 'Batch Upsert Sibling Table',
          fields: [
            {
              type: 'singleLineText',
              id: siblingKeyFieldId,
              name: 'Key',
              isPrimary: true,
            },
            { type: 'singleLineText', id: siblingTitleFieldId, name: 'Title' },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(createdSiblingTable.isOk()).toBe(true);

      // Seed one committed row first so neither concurrent writer hits empty-table ANALYZE ShareUpdateExclusiveLock.
      const seedRes = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        createContext(),
        CreateRecordsCommand.create({
          tableId,
          records: [
            {
              fields: { [keyFieldId]: 'seed-row', [titleFieldId]: 'Seed', [statusFieldId]: 'Open' },
            },
          ],
        })._unsafeUnwrap()
      );
      expect(seedRes.isOk()).toBe(true);
      const eventsBefore = eventBus.events().length;

      // Inject a genuine second-connection commit right before batch upsert's insertMany executes SQL,
      // forcing PostgreSQL SQLSTATE 23505 inside UpsertRecordsService's savepoint retry loop.
      const realInsertMany = recordRepo.insertMany.bind(recordRepo);
      let injectedRace = false;
      const spyInsert = vi
        .spyOn(recordRepo, 'insertMany')
        .mockImplementation(async (txCtx, targetTable, records, options) => {
          const isUpsertTarget =
            targetTable.id().toString() === tableId &&
            records.some(
              (r) =>
                r.fields().get(FieldId.create(keyFieldId)._unsafeUnwrap())?.toValue() === 'race-key'
            );
          if (isUpsertTarget && !injectedRace) {
            injectedRace = true;
            const winnerRes = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
              createContext(),
              CreateRecordsCommand.create({
                tableId,
                records: [
                  {
                    fields: {
                      [keyFieldId]: 'race-key',
                      [titleFieldId]: 'Concurrent Winner',
                      [statusFieldId]: 'Open',
                    },
                  },
                ],
              })._unsafeUnwrap()
            );
            expect(winnerRes.isOk()).toBe(true);
            // Execute the doomed insert through unitOfWork.withTransaction inside savepoint so
            // both PostgreSQL SQLSTATE 23505 rollback AND trackBatchTransactionOutcome isolation are exercised.
            return unitOfWork.withTransaction(txCtx, async () =>
              realInsertMany(txCtx, targetTable, records, options)
            );
          }
          return realInsertMany(txCtx, targetTable, records, options);
        });

      let batchRes;
      try {
        batchRes = await domainWriteTx.withBatchTransaction(createContext(), async (batchCtx) => {
          const siblingCreate = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
            batchCtx,
            CreateRecordsCommand.create({
              tableId: siblingTableId,
              records: [
                {
                  fields: {
                    [siblingKeyFieldId]: 'sibling-row',
                    [siblingTitleFieldId]: 'Sibling',
                  },
                },
              ],
            })._unsafeUnwrap()
          );
          if (siblingCreate.isErr()) return err(siblingCreate.error);

          const upsertRes = await commandBus.execute<UpsertRecordsCommand, UpsertRecordsResult>(
            batchCtx,
            UpsertRecordsCommand.create({
              tableId,
              matchField: keyFieldId,
              onConflict: 'update',
              typecast: false,
              records: [
                {
                  fields: {
                    [keyFieldId]: 'race-key',
                    [titleFieldId]: 'Updated By Batch',
                    [statusFieldId]: 'Open',
                  },
                },
              ],
            })._unsafeUnwrap()
          );
          if (upsertRes.isErr()) return err(upsertRes.error);

          const postUpsertCreate = await commandBus.execute<
            CreateRecordsCommand,
            CreateRecordsResult
          >(
            batchCtx,
            CreateRecordsCommand.create({
              tableId,
              records: [
                {
                  fields: {
                    [keyFieldId]: 'post-upsert-row',
                    [titleFieldId]: 'After Savepoint Recovery',
                    [statusFieldId]: 'Open',
                  },
                },
              ],
            })._unsafeUnwrap()
          );
          if (postUpsertCreate.isErr()) return err(postUpsertCreate.error);

          // Upsert and record-create events must stay deferred until the outer batch commits
          expect(
            eventBus.events().filter((e) => e.name.toString() === 'RecordsBatchUpdated')
          ).toHaveLength(0);
          return upsertRes;
        });
      } finally {
        spyInsert.mockRestore();
      }

      expect(injectedRace).toBe(true);
      expect(batchRes.isOk()).toBe(true);
      expect(batchRes._unsafeUnwrap().results).toMatchObject([{ index: 0, status: 'updated' }]);

      const fieldRows = await db
        .selectFrom('field')
        .select(['id', 'db_field_name'])
        .where('table_id', 'in', [tableId, siblingTableId])
        .execute();
      const dbNameByFieldId = new Map(fieldRows.map((r) => [r.id, r.db_field_name]));
      const keyCol = dbNameByFieldId.get(keyFieldId)!;
      const titleCol = dbNameByFieldId.get(titleFieldId)!;
      const siblingKeyCol = dbNameByFieldId.get(siblingKeyFieldId)!;
      const siblingTitleCol = dbNameByFieldId.get(siblingTitleFieldId)!;

      const persistedRows = await sql<{ k: string; t: string; v: number }>`
        SELECT ${sql.ref(keyCol)} AS k, ${sql.ref(titleCol)} AS t, __version AS v
        FROM ${sql.table(`${baseId.toString()}.${tableId}`)}
        ORDER BY ${sql.ref(keyCol)} ASC
      `.execute(db);
      expect(persistedRows.rows).toEqual([
        { k: 'post-upsert-row', t: 'After Savepoint Recovery', v: 1 },
        { k: 'race-key', t: 'Updated By Batch', v: 2 },
        { k: 'seed-row', t: 'Seed', v: 1 },
      ]);

      const persistedSiblingRows = await sql<{ k: string; t: string; v: number }>`
        SELECT ${sql.ref(siblingKeyCol)} AS k, ${sql.ref(siblingTitleCol)} AS t, __version AS v
        FROM ${sql.table(`${baseId.toString()}.${siblingTableId}`)}
        ORDER BY ${sql.ref(siblingKeyCol)} ASC
      `.execute(db);
      expect(persistedSiblingRows.rows).toEqual([{ k: 'sibling-row', t: 'Sibling', v: 1 }]);

      const publishedNames = eventBus
        .events()
        .slice(eventsBefore)
        .map((e) => e.name.toString());
      expect(publishedNames).toContain('RecordsBatchUpdated');
      expect(publishedNames).toContain('RecordCreated');
    }
  );

  it.skipIf(!hasRealPostgres)(
    're-emits domain events and outbox rows on CreateRecordsCommand / CreateRecordCommand after COMMIT-time 40001 & 40P01 retries',
    async () => {
      const tc = await createV2NodeTestContainer();
      setV2NodeTestContainer(tc);
      registerContainerCleanup(tc);
      const { container, db, baseId, eventBus } = tc;
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

      const tableId = TableId.generate()._unsafeUnwrap().toString();
      const titleFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const selectFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        createContext(),
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: 'Commit Retry Record Events',
          fields: [
            { type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true },
            {
              type: 'singleSelect',
              id: selectFieldId,
              name: 'Priority',
              options: {
                choices: [{ id: 'cho_low', name: 'Low', color: 'green' }],
              },
            },
          ],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(createdTable.isOk()).toBe(true);

      const suffix = tableId.slice(-8).toLowerCase();
      const seqName = `test_commit_rec_seq_${suffix}`;
      const fnName = `test_commit_rec_fn_${suffix}`;
      const trigName = `test_commit_rec_trg_${suffix}`;
      const physTableSql = `"${baseId.toString()}"."${tableId}"`;

      await sql.raw(`CREATE SEQUENCE public."${seqName}"`).execute(db);
      await sql
        .raw(
          `CREATE OR REPLACE FUNCTION public."${fnName}"() RETURNS trigger AS $$
          DECLARE n bigint;
          BEGIN
            n := nextval('public."${seqName}"');
            IF n = 1 THEN
              RAISE EXCEPTION 'could not serialize access due to concurrent update' USING ERRCODE = '40001';
            ELSIF n = 2 THEN
              RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
            END IF;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;`
        )
        .execute(db);
      await sql
        .raw(
          `CREATE CONSTRAINT TRIGGER "${trigName}"
           AFTER INSERT ON ${physTableSql}
           DEFERRABLE INITIALLY DEFERRED
           FOR EACH ROW
           EXECUTE FUNCTION public."${fnName}"();`
        )
        .execute(db);

      cleanups.push(async () => {
        await sql
          .raw(`DROP TRIGGER IF EXISTS "${trigName}" ON ${physTableSql}`)
          .execute(db)
          .catch(() => undefined);
        await sql
          .raw(`DROP FUNCTION IF EXISTS public."${fnName}"()`)
          .execute(db)
          .catch(() => undefined);
        await sql
          .raw(`DROP SEQUENCE IF EXISTS public."${seqName}"`)
          .execute(db)
          .catch(() => undefined);
      });

      const eventsBeforeBulk = eventBus.events().length;
      const outboxBeforeBulk = await db
        .selectFrom('domain_event_outbox')
        .select(['id'])
        .where('base_id', '=', baseId.toString())
        .execute();

      const bulkRes = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
        createContext(),
        CreateRecordsCommand.create({
          tableId,
          records: [
            { fields: { [titleFieldId]: 'committed-bulk-row-1' } },
            { fields: { [titleFieldId]: 'committed-bulk-row-2' } },
          ],
        })._unsafeUnwrap()
      );
      expect(bulkRes.isOk()).toBe(true);
      expect(bulkRes._unsafeUnwrap().events.length).toBeGreaterThan(0);

      const bulkPublished = eventBus
        .events()
        .slice(eventsBeforeBulk)
        .map((e) => e.name.toString());
      expect(bulkPublished).toContain('RecordsBatchCreated');

      const outboxAfterBulk = await db
        .selectFrom('domain_event_outbox')
        .select(['id'])
        .where('base_id', '=', baseId.toString())
        .execute();
      expect(outboxAfterBulk.length).toBeGreaterThan(outboxBeforeBulk.length);

      // Reset trigger firing counter so CreateRecordCommand (with typecast select option creation)
      // also hits both COMMIT-time 40001 and 40P01 before succeeding on attempt 3.
      await sql.raw(`ALTER SEQUENCE public."${seqName}" RESTART WITH 1`).execute(db);
      const eventsBeforeSingle = eventBus.events().length;

      const singleRes = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        createContext(),
        CreateRecordCommand.create({
          tableId,
          typecast: true,
          fields: {
            [titleFieldId]: 'committed-single-row',
            [selectFieldId]: 'Critical',
          },
        })._unsafeUnwrap()
      );
      expect(singleRes.isOk()).toBe(true);

      const singlePublished = eventBus
        .events()
        .slice(eventsBeforeSingle)
        .map((e) => e.name.toString());
      expect(singlePublished).toContain('RecordCreated');
      expect(singlePublished).toContain('FieldOptionsAdded');

      const outboxAfterSingle = await db
        .selectFrom('domain_event_outbox')
        .select(['id'])
        .where('base_id', '=', baseId.toString())
        .execute();
      expect(outboxAfterSingle.length).toBeGreaterThan(outboxAfterBulk.length);

      const persistedCountRes = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text AS cnt FROM ${sql.table(`${baseId.toString()}.${tableId}`)}
      `.execute(db);
      expect(Number(persistedCountRes.rows[0]?.cnt)).toBe(3);
    }
  );

  it.skipIf(!hasRealPostgres)(
    'does not fail CreateFieldCommand with view.version_conflict after COMMIT-time 40001 & 40P01 retries',
    async () => {
      const tc = await createV2NodeTestContainer();
      setV2NodeTestContainer(tc);
      registerContainerCleanup(tc);
      const { container, db, baseId, eventBus } = tc;
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);

      const tableId = TableId.generate()._unsafeUnwrap().toString();
      const titleFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const createdTable = await commandBus.execute<CreateTableCommand, CreateTableResult>(
        createContext(),
        CreateTableCommand.create({
          baseId: baseId.toString(),
          tableId,
          name: 'Commit Retry CreateField View Version',
          fields: [{ type: 'singleLineText', id: titleFieldId, name: 'Title', isPrimary: true }],
          views: [{ type: 'grid' }],
        })._unsafeUnwrap()
      );
      expect(createdTable.isOk()).toBe(true);

      const initialView = await db
        .selectFrom('view')
        .select(['id', 'version'])
        .where('table_id', '=', tableId)
        .executeTakeFirstOrThrow();

      const suffix = tableId.slice(-8).toLowerCase();
      const seqName = `test_commit_fld_seq_${suffix}`;
      const fnName = `test_commit_fld_fn_${suffix}`;
      const trigName = `test_commit_fld_trg_${suffix}`;

      await sql.raw(`CREATE SEQUENCE public."${seqName}"`).execute(db);
      await sql
        .raw(
          `CREATE OR REPLACE FUNCTION public."${fnName}"() RETURNS trigger AS $$
          DECLARE n bigint;
          BEGIN
            IF NEW.table_id <> '${tableId}' THEN
              RETURN NULL;
            END IF;
            n := nextval('public."${seqName}"');
            IF n = 1 THEN
              RAISE EXCEPTION 'could not serialize access due to concurrent update' USING ERRCODE = '40001';
            ELSIF n = 2 THEN
              RAISE EXCEPTION 'deadlock detected' USING ERRCODE = '40P01';
            END IF;
            RETURN NULL;
          END;
          $$ LANGUAGE plpgsql;`
        )
        .execute(db);
      await sql
        .raw(
          `CREATE CONSTRAINT TRIGGER "${trigName}"
           AFTER UPDATE ON public.view
           DEFERRABLE INITIALLY DEFERRED
           FOR EACH ROW
           EXECUTE FUNCTION public."${fnName}"();`
        )
        .execute(db);

      cleanups.push(async () => {
        await sql
          .raw(`DROP TRIGGER IF EXISTS "${trigName}" ON public.view`)
          .execute(db)
          .catch(() => undefined);
        await sql
          .raw(`DROP FUNCTION IF EXISTS public."${fnName}"()`)
          .execute(db)
          .catch(() => undefined);
        await sql
          .raw(`DROP SEQUENCE IF EXISTS public."${seqName}"`)
          .execute(db)
          .catch(() => undefined);
      });

      const eventsBefore = eventBus.events().length;
      const newFieldId = FieldId.generate()._unsafeUnwrap().toString();
      const createFieldRes = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        createContext(),
        CreateFieldCommand.create({
          baseId: baseId.toString(),
          tableId,
          field: {
            id: newFieldId,
            type: 'number',
            name: 'Retried Score',
          },
        })._unsafeUnwrap()
      );
      expect(
        createFieldRes.isOk(),
        createFieldRes.isErr() ? JSON.stringify(createFieldRes.error) : ''
      ).toBe(true);

      const persistedFields = await db
        .selectFrom('field')
        .select(['id'])
        .where('id', '=', newFieldId)
        .execute();
      expect(persistedFields).toHaveLength(1);

      const updatedView = await db
        .selectFrom('view')
        .select(['id', 'version'])
        .where('id', '=', initialView.id)
        .executeTakeFirstOrThrow();
      expect(updatedView.version).toBe(initialView.version + 1);

      const publishedFieldCreated = eventBus
        .events()
        .slice(eventsBefore)
        .filter((e) => e.name.toString() === 'FieldCreated');
      expect(publishedFieldCreated).toHaveLength(1);
    }
  );
});
