import { randomUUID } from 'node:crypto';
import {
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
  CreateFieldCommand,
  CreateRecordCommand,
  CreateTableCommand,
  UpdateRecordCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateTableResult,
  type ICommandBus,
  type IDomainWriteTransaction,
  type IExecutionContext,
} from '@teable/v2-core';
import { container as rootContainer } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { vcsDomainError } from '@teable/v2-vcs';
import {
  EnableBaseVcsService,
  v2VcsServerTokens,
  type IBaseVcsLogRepository,
} from '@teable/v2-vcs/server';
import { sql, type Kysely } from 'kysely';
import { err, type Result } from 'neverthrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IBaseVcsDatabase } from './PostgresBaseVcsLogRepository';

const unwrap = <T, E>(res: Result<T, E>, label = 'result'): T => {
  if (res.isErr()) {
    throw new Error(`${label} failed: ${JSON.stringify(res.error)}`);
  }
  return res.value;
};

const createContext = (actor = 'system'): IExecutionContext => ({
  actorId: ActorId.create(actor)._unsafeUnwrap(),
});

describe('BaseVcsChangeLogProjection same-tx integration (real PostgreSQL)', () => {
  let testContainer: IV2NodeTestContainer;
  let dataDb: Kysely<IBaseVcsDatabase & Record<string, unknown>>;
  let metaDb: Kysely<Record<string, unknown>>;
  let commandBus: ICommandBus;
  let logRepository: IBaseVcsLogRepository;
  let enableService: EnableBaseVcsService;
  let domainWriteTransaction: IDomainWriteTransaction;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer({ ensureSchema: true });
    dataDb = testContainer.dataDb as unknown as Kysely<IBaseVcsDatabase & Record<string, unknown>>;
    metaDb = testContainer.metaDb as unknown as Kysely<Record<string, unknown>>;
    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    logRepository = testContainer.container.resolve<IBaseVcsLogRepository>(
      v2VcsServerTokens.logRepository
    );
    enableService = testContainer.container.resolve(EnableBaseVcsService);
    domainWriteTransaction = testContainer.container.resolve<IDomainWriteTransaction>(
      v2CoreTokens.domainWriteTransaction
    );
  }, 120_000);

  afterAll(async () => {
    await testContainer?.dispose();
  }, 30_000);

  it('(a) rolls back base_vcs_change rows completely when a business write transaction aborts', async () => {
    const ctx = createContext();
    (await enableService.execute(ctx, { baseId: testContainer.baseId.toString() }))._unsafeUnwrap();

    const tableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'RollbackTestTable',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      })._unsafeUnwrap()
    );
    const { table } = unwrap(tableRes, 'createTable(a)');
    const primaryFieldId = table.primaryFieldId().toString();
    const cursorBefore = (
      await logRepository.capturePullCursor(ctx, testContainer.baseId)
    )._unsafeUnwrap();

    let createdRecId: string | undefined;
    const batchRes = await domainWriteTransaction.withBatchTransaction(
      ctx,
      async (batchCtx) => {
        const recRes = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
          batchCtx,
          CreateRecordCommand.create({
            tableId: table.id().toString(),
            fields: { [primaryFieldId]: 'ShouldRollback' },
          })._unsafeUnwrap()
        );
        createdRecId = recRes._unsafeUnwrap().record.id().toString();
        return err(
          vcsDomainError.invariant({
            code: 'vcs.force_rollback',
            message: 'Simulated failure after CreateRecordCommand',
          })
        );
      },
      { scope: 'data' }
    );

    expect(batchRes.isErr()).toBe(true);
    expect(createdRecId).toBeDefined();

    // Neither physical record nor change-log row must exist after rollback.
    const page = (
      await logRepository.listChangesSince(ctx, testContainer.baseId, cursorBefore, 100)
    )._unsafeUnwrap();
    expect(page.changes.filter((c) => c.entityId === createdRecId)).toEqual([]);

    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const physicalCount = await sql<{ cnt: string }>`
      SELECT COUNT(*)::text AS cnt FROM ${sql.table(dbTableName)}
    `.execute(dataDb);
    expect(Number(physicalCount.rows[0]?.cnt ?? 0)).toBe(0);
  });

  it('(b) rolls back business record AND schema writes atomically when change-log write fails', async () => {
    const ctx = createContext();
    (await enableService.execute(ctx, { baseId: testContainer.baseId.toString() }))._unsafeUnwrap();

    const tableRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'TriggerAbortTable',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      })._unsafeUnwrap()
    );
    const { table } = unwrap(tableRes, 'createTable(b)');
    const tableId = table.id().toString();
    const primaryFieldId = table.primaryFieldId().toString();
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const fnName = `vcs_abort_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const trigName = `trg_${fnName}`;

    await sql
      .raw(`
      CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger AS $$
      BEGIN
        IF NEW.table_id = '${tableId}' THEN
          RAISE EXCEPTION 'simulated base_vcs_change write failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER ${trigName}
      BEFORE INSERT ON base_vcs_change
      FOR EACH ROW EXECUTE FUNCTION ${fnName}();
    `)
      .execute(dataDb);

    try {
      const recRes = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId,
          fields: { [primaryFieldId]: 'ShouldFailAndRollback' },
        })._unsafeUnwrap()
      );
      expect(recRes.isErr()).toBe(true);

      const recCount = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text AS cnt FROM ${sql.table(dbTableName)}
      `.execute(dataDb);
      expect(Number(recCount.rows[0]?.cnt ?? 0)).toBe(0);

      const fieldRes = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
        ctx,
        CreateFieldCommand.create({
          baseId: testContainer.baseId.toString(),
          tableId,
          field: { type: 'singleLineText', name: 'BrokenField' },
        })._unsafeUnwrap()
      );
      expect(fieldRes.isErr()).toBe(true);

      const fieldRows = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text AS cnt FROM field WHERE table_id = ${tableId} AND name = 'BrokenField'
      `.execute(metaDb);
      expect(Number(fieldRows.rows[0]?.cnt ?? 0)).toBe(0);
    } finally {
      await sql.raw(`DROP TRIGGER IF EXISTS ${trigName} ON base_vcs_change;`).execute(dataDb);
      await sql.raw(`DROP FUNCTION IF EXISTS ${fnName}();`).execute(dataDb);
    }
  });

  it('(c) rejects enable and pre-enabled schema mutations cleanly across split Meta/Data PG schemas without partial meta commit', async () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const metaSchema = `vcs_meta_${suffix}`;
    const dataSchema = `vcs_data_${suffix}`;

    await sql`CREATE SCHEMA ${sql.id(metaSchema)}`.execute(dataDb);
    await sql`CREATE SCHEMA ${sql.id(dataSchema)}`.execute(dataDb);

    const metaUrl = new URL(testContainer.connectionString);
    metaUrl.searchParams.set('options', `-c search_path=${metaSchema},public`);
    const dataUrl = new URL(testContainer.connectionString);
    dataUrl.searchParams.set('options', `-c search_path=${dataSchema},public`);

    let splitContainer: IV2NodeTestContainer | undefined;
    try {
      splitContainer = await createV2NodeTestContainer({
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

      const splitLogRepo = splitContainer.container.resolve<IBaseVcsLogRepository>(
        v2VcsServerTokens.logRepository
      );
      const splitCommandBus = splitContainer.container.resolve<ICommandBus>(
        v2CoreTokens.commandBus
      );
      const splitBaseId = splitContainer.baseId;
      const ctx = createContext();

      // 1. enable() refuses split Meta/Data configuration.
      const enableRes = await splitContainer.container
        .resolve(EnableBaseVcsService)
        .execute(ctx, { baseId: splitBaseId.toString() });
      expect(enableRes.isErr()).toBe(true);
      expect(enableRes._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');

      // Create table while VCS disabled so schema + physical table exist across split schemas.
      const tableRes = await splitCommandBus.execute<CreateTableCommand, CreateTableResult>(
        ctx,
        CreateTableCommand.create({
          baseId: splitBaseId.toString(),
          name: 'SplitTable',
          fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
        })._unsafeUnwrap()
      );
      const splitTableId = tableRes._unsafeUnwrap().table.id().toString();

      // 2. Even if base_vcs_head.enabled is pre-seeded in dataDb, schema mutation fails closed and rolls back metaDb.
      await sql`
        INSERT INTO ${sql.table(`${dataSchema}.base_vcs_head`)} (base_id, enabled, head_revision)
        VALUES (${splitBaseId.toString()}, true, 0)
        ON CONFLICT (base_id) DO UPDATE SET enabled = true
      `.execute(splitContainer.dataDb);
      if (
        'invalidateEnabledCache' in splitLogRepo &&
        typeof splitLogRepo.invalidateEnabledCache === 'function'
      ) {
        splitLogRepo.invalidateEnabledCache(splitBaseId.toString());
      }

      const fieldRes = await splitCommandBus.execute<CreateFieldCommand, CreateFieldResult>(
        ctx,
        CreateFieldCommand.create({
          baseId: splitBaseId.toString(),
          tableId: splitTableId,
          field: { type: 'singleLineText', name: 'SplitCrossDbFail' },
        })._unsafeUnwrap()
      );
      expect(fieldRes.isErr()).toBe(true);
      expect(fieldRes._unsafeUnwrapErr().code).toBe('batch.cross_database_not_atomic');

      // Meta DB must not retain the new field row.
      const metaFieldCount = await sql<{ cnt: string }>`
        SELECT COUNT(*)::text AS cnt
        FROM ${sql.table(`${metaSchema}.field`)}
        WHERE table_id = ${splitTableId} AND name = 'SplitCrossDbFail'
      `.execute(splitContainer.metaDb);
      expect(Number(metaFieldCount.rows[0]?.cnt ?? 0)).toBe(0);
    } finally {
      await splitContainer?.dispose().catch(() => undefined);
      await sql`DROP SCHEMA IF EXISTS ${sql.id(metaSchema)} CASCADE`.execute(dataDb);
      await sql`DROP SCHEMA IF EXISTS ${sql.id(dataSchema)} CASCADE`.execute(dataDb);
    }
  }, 60_000);

  it('(d) logs two-way symmetric link updates into base_vcs_change on both source and foreign records', async () => {
    const ctx = createContext();

    // Create Companies table
    const companiesRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'Companies',
        fields: [{ type: 'singleLineText', name: 'CompanyName', isPrimary: true }],
      })._unsafeUnwrap()
    );
    const companiesTable = unwrap(companiesRes, 'createCompanies').table;
    const companiesTableId = companiesTable.id().toString();
    const companyNameFieldId = companiesTable.primaryFieldId().toString();

    // Create Contacts table with two-way link to Companies
    const contactsRes = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      ctx,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'Contacts',
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
    );
    const contactsTable = contactsRes._unsafeUnwrap().table;
    const contactsTableId = contactsTable.id().toString();
    const contactNameFieldId = contactsTable.primaryFieldId().toString();
    const linkField = contactsTable.getFields().find((f) => f.type().toString() === 'link')!;
    const linkFieldId = linkField.id().toString();

    // Create two companies and one contact linked to comp1
    const comp1 = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: companiesTableId,
          fields: { [companyNameFieldId]: 'Acme' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;

    const comp2 = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: companiesTableId,
          fields: { [companyNameFieldId]: 'Globex' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;

    const contact1 = (
      await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
        ctx,
        CreateRecordCommand.create({
          tableId: contactsTableId,
          fields: {
            [contactNameFieldId]: 'Alice',
            [linkFieldId]: { id: comp1.id().toString() },
          },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap().record;

    // Enable VCS and update Alice's Company link from Acme -> Globex
    (await enableService.execute(ctx, { baseId: testContainer.baseId.toString() }))._unsafeUnwrap();
    const cursorBefore = (
      await logRepository.capturePullCursor(ctx, testContainer.baseId)
    )._unsafeUnwrap();

    (
      await commandBus.execute(
        ctx,
        UpdateRecordCommand.create({
          tableId: contactsTableId,
          recordId: contact1.id().toString(),
          fields: {
            [linkFieldId]: { id: comp2.id().toString() },
          },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();

    await testContainer.processOutbox();

    const page = (
      await logRepository.listChangesSince(ctx, testContainer.baseId, cursorBefore, 100)
    )._unsafeUnwrap();

    const updatedRecordIds = new Set(page.changes.map((c) => `${c.tableId}:${c.entityId}`));
    expect(updatedRecordIds.has(`${contactsTableId}:${contact1.id().toString()}`)).toBe(true);
    expect(updatedRecordIds.has(`${companiesTableId}:${comp1.id().toString()}`)).toBe(true);
    expect(updatedRecordIds.has(`${companiesTableId}:${comp2.id().toString()}`)).toBe(true);
  });
});
