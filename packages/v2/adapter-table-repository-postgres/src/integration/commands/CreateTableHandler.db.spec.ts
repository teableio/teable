/* eslint-disable @typescript-eslint/naming-convention */
import { v2PostgresDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import {
  createSchemaChecker,
  PostgresSchemaIntrospector,
} from '@teable/v2-adapter-table-repository-postgres';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  CreateViewCommand,
  TableId,
  TableSchemaOperationRepairHandler,
  type CreateTableResult,
  type CreateViewResult,
  type ICommandBus,
  type ISchemaOperationRepository,
  type ITableRecordRepository,
  type IUnitOfWork,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { createAllFieldTypesFields } from '@teable/v2-table-templates';
import { sql, type Kysely } from 'kysely';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it } from 'vitest';

import { getV2NodeTestContainer, setV2NodeTestContainer } from '../testkit/v2NodeTestContainer';

type InfoSchemaColumnRow = {
  column_name: string;
  table_schema: string;
  table_name: string;
};

type V1Db = V1TeableDatabase & { columns: InfoSchemaColumnRow };

// Fails the test instead of hanging for the full vitest timeout when a
// connection-level self-lock keeps the promise pending forever.
const withTimeout = <T>(promise: Promise<T>, message: string, ms = 20_000): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);

const collectFinalCheckResults = async (
  generator: ReturnType<ReturnType<typeof createSchemaChecker>['checkTable']>
) => {
  const results = [];
  for await (const result of generator) {
    if (result.status === 'pending' || result.status === 'running') {
      continue;
    }
    results.push(result);
  }
  return results;
};

describe('CreateTableHandler (db)', () => {
  beforeEach(async () => {
    setV2NodeTestContainer(await createV2NodeTestContainer());
  });

  it('persists table meta, fields, views, and record table columns', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'DB Table',
      fields: createAllFieldTypesFields(),
    });
    createTableResult._unsafeUnwrap();

    const execResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    execResult._unsafeUnwrap();

    const table = execResult._unsafeUnwrap().table;
    const tableId = table.id().toString();
    const fieldIds = table.getFields().map((field) => field.id().toString());

    const tableMetaRow = await db
      .selectFrom('table_meta')
      .select(['id', 'base_id', 'name', 'db_table_name'])
      .where('id', '=', tableId)
      .executeTakeFirst();
    expect(tableMetaRow).toBeTruthy();
    if (!tableMetaRow) return;
    expect(tableMetaRow.base_id).toBe(baseId.toString());
    expect(tableMetaRow.name).toBe('DB Table');
    expect(tableMetaRow.db_table_name).toBeTruthy();

    const fieldRows = await db
      .selectFrom('field')
      .select(['id', 'db_field_name', 'is_primary', 'table_id'])
      .where('table_id', '=', tableId)
      .execute();
    expect(fieldRows).toHaveLength(fieldIds.length);
    expect(new Set(fieldRows.map((row) => row.id))).toEqual(new Set(fieldIds));
    expect(fieldRows.every((row) => row.db_field_name)).toBe(true);
    const primaryFieldId = table.primaryFieldId().toString();
    const primaryRow = fieldRows.find((row) => row.id === primaryFieldId);
    expect(primaryRow?.is_primary).toBe(true);

    const viewRows = await db
      .selectFrom('view')
      .select(['id', 'type', 'column_meta'])
      .where('table_id', '=', tableId)
      .execute();
    expect(viewRows).toHaveLength(table.views().length);

    const viewById = new Map(viewRows.map((row) => [row.id, row] as const));
    for (const view of table.views()) {
      const row = viewById.get(view.id().toString());
      expect(row).toBeTruthy();
      if (!row) return;
      expect(row.type).toBe(view.type().toString());
      const metaResult = view.columnMeta();
      metaResult._unsafeUnwrap();

      const dbMeta = JSON.parse(row.column_meta ?? '{}') as Record<string, { order: number }>;
      expect(dbMeta).toEqual(metaResult._unsafeUnwrap().toDto());
    }

    const parts = String(tableMetaRow.db_table_name).split('.');
    const schemaName = parts.length > 1 ? parts[0] : 'public';
    const tableName = parts.length > 1 ? parts[1] : parts[0];
    const columnRows = await db
      .withSchema('information_schema')
      .selectFrom('columns')
      .select(['column_name'])
      .where('table_schema', '=', schemaName)
      .where('table_name', '=', tableName)
      .execute();
    const columnNames = new Set(columnRows.map((row) => row.column_name));

    const baseRecordColumns = [
      '__id',
      '__auto_number',
      '__created_time',
      '__last_modified_time',
      '__created_by',
      '__last_modified_by',
      '__version',
    ];
    for (const columnName of baseRecordColumns) {
      expect(columnNames.has(columnName)).toBe(true);
    }
    for (const row of fieldRows) {
      expect(columnNames.has(row.db_field_name)).toBe(true);
    }
  });

  it('creates a table whose schema checker has no warn or error results', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const actorIdResult = ActorId.create('system');
    actorIdResult._unsafeUnwrap();

    const context = { actorId: actorIdResult._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Schema Checker Clean',
      fields: createAllFieldTypesFields(),
    });
    createTableResult._unsafeUnwrap();

    const execResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    execResult._unsafeUnwrap();

    const table = execResult._unsafeUnwrap().table;
    const checker = createSchemaChecker({
      db: db as unknown as Kysely<V1TeableDatabase>,
      introspector: new PostgresSchemaIntrospector(db as unknown as Kysely<V1TeableDatabase>),
      schema: baseId.toString(),
    });

    const results = await collectFinalCheckResults(checker.checkTable(table));

    expect(
      results.filter((result) => result.status === 'error' || result.status === 'warn')
    ).toEqual([]);
  });

  // Regression guard for T6657: creating a table with a grid view and initial
  // records must complete promptly and persist the records. The insert path
  // used to probe view order metadata through a transaction-external
  // connection while the creating transaction still held the new table's DDL
  // locks, self-locking the request.
  it('creates a table with a grid view and initial records without self-locking', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);

    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Initial Records',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
      records: [{ fields: { Title: 'Row A' } }, { fields: { Title: 'Row B' } }],
    });
    createTableResult._unsafeUnwrap();

    const execResult = await withTimeout(
      commandBus.execute<CreateTableCommand, CreateTableResult>(
        context,
        createTableResult._unsafeUnwrap()
      ),
      'CreateTableCommand with initial records did not finish: possible connection-level self-lock'
    );
    execResult._unsafeUnwrap();

    const table = execResult._unsafeUnwrap().table;
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();
    expect(rows).toHaveLength(2);
  });

  // Regression for T6657: mirrors the production lock chain. The table has a
  // committed view order column (added by the second grid view). Inside one
  // transaction a restore-style batch adds another order column (ALTER TABLE,
  // ACCESS EXCLUSIVE held until commit), then the next batch's MAX(order)
  // probe must reuse the transaction connection; a pool connection would wait
  // on the transaction's own lock while the transaction waits for the probe —
  // a connection-level self-deadlock.
  it('reuses the transaction connection for view order probes while the transaction holds DDL locks', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);
    const unitOfWork = container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
    const recordRepository = container.resolve<ITableRecordRepository>(
      v2CoreTokens.tableRecordRepository
    );

    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const createTableResult = CreateTableCommand.create({
      baseId: baseId.toString(),
      name: 'Restore Batch Locking',
      fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    createTableResult._unsafeUnwrap();

    const execResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      createTableResult._unsafeUnwrap()
    );
    const tableId = execResult._unsafeUnwrap().table.id().toString();

    // A second grid view gives the physical table a committed order column for
    // the probe to find through information_schema.
    const createViewResult = CreateViewCommand.create({
      tableId,
      view: { type: 'grid', name: 'Second Grid' },
    });
    createViewResult._unsafeUnwrap();
    const viewExecResult = await commandBus.execute<CreateViewCommand, CreateViewResult>(
      context,
      createViewResult._unsafeUnwrap()
    );
    viewExecResult._unsafeUnwrap();
    const table = viewExecResult._unsafeUnwrap().table;
    const dbTableName = table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();

    const createRecordsResult = table.createRecords([
      { fieldValues: new Map([['Title', 'Restored Row']]) },
      { fieldValues: new Map([['Title', 'Appended Row']]) },
    ]);
    const [restoredRecord, appendedRecord] = createRecordsResult._unsafeUnwrap().records;
    expect(restoredRecord).toBeTruthy();
    expect(appendedRecord).toBeTruthy();

    // A view id whose order column does not exist yet: the restore batch adds
    // it with ALTER TABLE inside the transaction.
    const restoreOnlyViewId = 'viwRestoreOnlyOrder01';

    const work = unitOfWork.withTransaction(context, async (transactionContext) => {
      const restoreResult = await recordRepository.insertMany(
        transactionContext,
        table,
        [restoredRecord],
        {
          restoreRecordsById: new Map([
            [restoredRecord.id().toString(), { orders: { [restoreOnlyViewId]: 10 } }],
          ]),
        }
      );
      if (restoreResult.isErr()) {
        return err(restoreResult.error);
      }

      const appendResult = await recordRepository.insertMany(transactionContext, table, [
        appendedRecord,
      ]);
      if (appendResult.isErr()) {
        return err(appendResult.error);
      }

      return ok(undefined);
    });

    const result = await withTimeout(
      work,
      'insertMany did not finish: view order probe self-locked on the transaction connection'
    );
    expect(result.isOk()).toBe(true);

    const rows = await (db as unknown as Kysely<Record<string, Record<string, unknown>>>)
      .selectFrom(dbTableName)
      .selectAll()
      .execute();
    expect(rows).toHaveLength(2);
  });

  // T6853: sanitized structure-equivalent of production table.create.
  // Retains: parent table + child table.create with a two-way manyOne link,
  // and a missing parent physical relation before the child create.
  // Live create stays on the hot path and fails; repair recreates the parent.
  it('repairs a missing parent relation after a two-way create-table link fails', async () => {
    const { container, baseId } = getV2NodeTestContainer();
    const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const db = container.resolve<Kysely<V1Db>>(v2PostgresDbTokens.db);
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

    const parentResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        name: 'Needs',
        fields: [{ type: 'singleLineText', name: 'Item', isPrimary: true }],
      })._unsafeUnwrap()
    );
    const parentTable = parentResult._unsafeUnwrap().table;
    const parentQualified = parentTable.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
    const [parentSchema, parentName] = parentQualified.split('.');
    expect(parentSchema).toBeTruthy();
    expect(parentName).toBeTruthy();

    await sql.raw(`DROP TABLE IF EXISTS "${parentSchema}"."${parentName}" CASCADE`).execute(db);

    const childTableId = TableId.generate()._unsafeUnwrap();
    const childResult = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: baseId.toString(),
        tableId: childTableId.toString(),
        name: 'Evaluations',
        fields: [
          { type: 'singleLineText', name: 'Product', isPrimary: true },
          {
            type: 'link',
            name: 'Need',
            options: {
              relationship: 'manyOne',
              foreignTableId: parentTable.id().toString(),
              lookupFieldId: parentTable.primaryFieldId().toString(),
              isOneWay: false,
            },
          },
        ],
      })._unsafeUnwrap()
    );

    expect(childResult.isErr()).toBe(true);
    expect(childResult._unsafeUnwrapErr().message).toMatch(/does not exist/i);

    const schemaOperations = container.resolve<ISchemaOperationRepository>(
      v2CoreTokens.schemaOperationRepository
    );
    const listed = (
      await schemaOperations.list(context, {
        tableIds: [childTableId.toString()],
        types: ['table.create'],
      })
    )._unsafeUnwrap();
    expect(listed.items).toHaveLength(1);

    const repairHandler = container.resolve(TableSchemaOperationRepairHandler);
    const repaired = await repairHandler.run(context, listed.items[0]!);
    if (repaired.isErr()) {
      throw new Error(repaired.error.message);
    }
    expect(repaired.isOk()).toBe(true);

    const parentExists = await sql<{ exists: boolean }>`
      SELECT to_regclass(${`"${parentSchema}"."${parentName}"`}) IS NOT NULL AS exists
    `.execute(db);
    expect(parentExists.rows[0]?.exists).toBe(true);

    const reloadedParent = await db
      .selectFrom('field')
      .select(['id', 'type', 'table_id'])
      .where('table_id', '=', parentTable.id().toString())
      .where('type', '=', 'link')
      .where('deleted_time', 'is', null)
      .execute();
    expect(reloadedParent.length).toBeGreaterThan(0);
  });
});
