/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { Prisma, PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { createTable as apiCreateTable } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import {
  ActorId,
  v2CoreTokens,
  type IExecutionContext,
  type SchemaOperationRunnerService,
} from '@teable/v2-core';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import { getError } from './utils/get-error';
import {
  convertField,
  createField,
  createRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
  updateViewFilter,
} from './utils/init-app';

process.env.V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS = '50';
process.env.V2_SCHEMA_OPERATION_RUNNER_MAX_BATCH = '5';

interface IRawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const describeV2 = isForceV2 ? describe : describe.skip;

const parseDbTableName = (dbTableName: string) => {
  const [schemaName, tableName] = dbTableName.split('.');

  if (!schemaName || !tableName) {
    throw new Error(`Invalid dbTableName: ${dbTableName}`);
  }

  return { schemaName, tableName };
};

const quoteIdent = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

const tableExists = async (client: IRawQueryClient, dbTableName: string) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists
    `,
    schemaName,
    tableName
  );

  return Boolean(rows[0]?.exists);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeV2('V2 schema operation runner recovery (e2e)', () => {
  let app: INestApplication;
  let metaPrisma: PrismaService;
  let dataPrisma: DataPrismaService;
  let dbProvider: IDbProvider;
  let schemaOperationRunner: SchemaOperationRunnerService;

  const baseId = globalThis.testConfig.baseId;
  const createdTables: ITableFullVo[] = [];
  const runnerContext: IExecutionContext = {
    actorId: ActorId.create('system')._unsafeUnwrap(),
    requestId: 'e2e-schema-operation-runner',
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    metaPrisma = app.get(PrismaService);
    dataPrisma = app.get(DataPrismaService);
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
    const container = await app.get(V2ContainerService).getContainer();
    schemaOperationRunner = container.resolve<SchemaOperationRunnerService>(
      v2CoreTokens.schemaOperationRunnerService
    );
  });

  afterEach(async () => {
    for (const table of createdTables.splice(0).reverse()) {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const getPhysicalColumns = async (dbTableName: string) => {
    const rows = await dataPrisma.$queryRawUnsafe<{ name: string }[]>(
      dbProvider.columnInfo(dbTableName)
    );
    return rows.map((row) => row.name);
  };

  const createFailingUpdateTrigger = async (dbTableName: string, suffix: string) => {
    const { schemaName, tableName } = parseDbTableName(dbTableName);
    const functionName = `fail_record_update_${suffix}`;
    const triggerName = `fail_record_update_${suffix}`;
    const qualifiedFunction = `${quoteIdent(schemaName)}.${quoteIdent(functionName)}`;
    const qualifiedTable = `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`;

    await dataPrisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${qualifiedFunction}()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'e2e simulated data write failure after metadata update';
      END;
      $$;
    `);
    await dataPrisma.$executeRawUnsafe(`
      CREATE TRIGGER ${quoteIdent(triggerName)}
      BEFORE UPDATE ON ${qualifiedTable}
      FOR EACH ROW
      EXECUTE FUNCTION ${qualifiedFunction}();
    `);

    return async () => {
      await dataPrisma.$executeRawUnsafe(`
        DROP TRIGGER IF EXISTS ${quoteIdent(triggerName)} ON ${qualifiedTable};
      `);
      await dataPrisma.$executeRawUnsafe(`
        DROP FUNCTION IF EXISTS ${qualifiedFunction}();
      `);
    };
  };

  const waitForRecoveredTable = async (table: ITableFullVo, timeoutMs = 8_000) => {
    const startedAt = Date.now();
    let lastStatus: unknown;
    let lastProvisionState: unknown;
    let lastTableExists = false;

    do {
      const [operation, tableMeta, exists] = await Promise.all([
        metaPrisma.schemaOperation.findFirst({
          where: { tableId: table.id, type: 'table.create' },
          orderBy: { createdTime: 'desc' },
        }),
        metaPrisma.tableMeta.findUnique({
          where: { id: table.id },
          select: { provisionState: true },
        }),
        tableExists(dataPrisma, table.dbTableName),
      ]);

      lastStatus = operation?.status;
      lastProvisionState = tableMeta?.provisionState;
      lastTableExists = exists;

      if (operation?.status === 'ready' && tableMeta?.provisionState === 'ready' && exists) {
        return operation;
      }

      await sleep(100);
    } while (Date.now() - startedAt < timeoutMs);

    throw new Error(
      `Timed out waiting for schema operation recovery: status=${String(
        lastStatus
      )}, provisionState=${String(lastProvisionState)}, tableExists=${String(lastTableExists)}`
    );
  };

  // Drives the schema operation runner directly until the operation reaches a
  // terminal state ('error' is transient: the runner either repairs or kills
  // the operation on a later pass). Work-driven, no sleeps: every iteration
  // either observes a settled operation or performs one real runner pass.
  const runSchemaOperationUntilSettled = async (
    operationId: string,
    options?: { claimNow?: Date; maxRuns?: number }
  ) => {
    const maxRuns = options?.maxRuns ?? 20;
    let lastRunStatus: string | undefined;
    for (let run = 0; run < maxRuns; run += 1) {
      const operation = await metaPrisma.schemaOperation.findUnique({
        where: { id: operationId },
      });
      if (operation && (operation.status === 'ready' || operation.status === 'dead')) {
        return operation;
      }
      const result = await schemaOperationRunner.runNext(runnerContext, {
        workerId: 'e2e-schema-operation-runner',
        ...(options?.claimNow ? { now: options.claimNow } : {}),
        staleRunningBefore: new Date(Date.now() - 60_000),
      });
      if (result.isErr()) {
        throw new Error(
          `Schema operation runner failed for ${operationId}: ${result.error.message}`
        );
      }
      lastRunStatus = result.value.status;
    }
    const lastOperation = await metaPrisma.schemaOperation.findUnique({
      where: { id: operationId },
    });
    throw new Error(
      `Schema operation runner did not settle operation ${operationId}: ${JSON.stringify({
        lastRunStatus,
        status: lastOperation?.status,
        phase: lastOperation?.phase,
        attempts: lastOperation?.attempts,
        nextRunAt: lastOperation?.nextRunAt,
        lastError: lastOperation?.lastError,
      })}`
    );
  };

  const waitForTerminalTableUpdate = async (tableId: string, timeoutMs = 8_000) => {
    const startedAt = Date.now();
    let lastPhase: unknown;
    let lastStatus: unknown;

    do {
      const operation = await metaPrisma.schemaOperation.findFirst({
        where: { tableId, type: 'table.update' },
        orderBy: { createdTime: 'desc' },
      });

      lastPhase = operation?.phase;
      lastStatus = operation?.status;

      if (operation && operation.phase !== 'running' && operation.status !== 'running') {
        return operation;
      }

      await sleep(100);
    } while (Date.now() - startedAt < timeoutMs);

    throw new Error(
      `Timed out waiting for table.update to leave running: phase=${String(
        lastPhase
      )}, status=${String(lastStatus)}`
    );
  };

  it('repairs a failed schema-only table create operation from the Nest background runner', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Schema operation recovery',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);

    const operation = await metaPrisma.schemaOperation.findFirstOrThrow({
      where: { tableId: table.id, type: 'table.create' },
      orderBy: { createdTime: 'desc' },
    });
    expect(operation.status).toBe('ready');
    expect(operation.payload).toMatchObject({ recordCount: 0 });
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);

    await dataPrisma.$executeRawUnsafe(dbProvider.dropTable(table.dbTableName));
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(false);

    await metaPrisma.tableMeta.update({
      where: { id: table.id },
      data: { provisionState: ProvisionState.error },
    });
    await metaPrisma.schemaOperation.update({
      where: { idempotencyKey: operation.idempotencyKey },
      data: {
        status: 'error',
        phase: 'error',
        payload: { tableId: table.id, recordCount: 0 },
        attempts: 1,
        maxAttempts: 8,
        nextRunAt: new Date(Date.now() - 1_000),
        lockedAt: null,
        lockedBy: null,
        lastError: 'e2e simulated data schema loss',
      },
    });

    const repairedOperation = await waitForRecoveredTable(table);
    expect(repairedOperation.result).toMatchObject({
      repaired: 'table_schema',
      tableIds: [table.id],
    });

    const primaryField = table.fields.find((field) => field.name === 'Name');
    expect(primaryField?.dbFieldName).toBeTruthy();
    await expect(getPhysicalColumns(table.dbTableName)).resolves.toContain(
      primaryField!.dbFieldName
    );
  });

  it('rejects table.create records that miss a required field before the schema operation goes dead', async () => {
    const error = await getError(() =>
      apiCreateTable(baseId, {
        name: 'Required field create records',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
          { name: 'Required Code', type: FieldType.SingleLineText, notNull: true },
        ],
        records: [{ fields: { Name: 'Row 1' } }],
      })
    );
    expect(error?.status).toBe(400);
    expect(String(error?.message ?? '')).toContain('violates not-null constraint');

    const leftoverTables = await metaPrisma.tableMeta.findMany({
      where: {
        baseId,
        name: 'Required field create records',
        deletedTime: null,
      },
      select: { id: true },
    });
    expect(leftoverTables).toHaveLength(0);

    const leftoverOperations = leftoverTables.length
      ? await metaPrisma.schemaOperation.findMany({
          where: {
            tableId: { in: leftoverTables.map((table) => table.id) },
            type: 'table.create',
          },
        })
      : await metaPrisma.schemaOperation.findMany({
          where: {
            baseId,
            type: 'table.create',
            lastError: { contains: 'durable record replay payload' },
          },
        });
    expect(leftoverOperations).toHaveLength(0);
  });

  it('keeps a table ready when a typecast record update metadata change succeeds but data write fails', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Record update data failure availability',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [{ name: 'Open', color: 'blue' }],
          },
        },
      ],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);
    const statusField = table.fields.find((field) => field.name === 'Status');
    expect(statusField?.id).toBeTruthy();
    const { records } = await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Name,
      records: [{ fields: { Name: 'Task 1', Status: 'Open' } }],
    });
    const recordId = records[0]?.id;
    expect(recordId).toBeTruthy();

    const cleanupTrigger = await createFailingUpdateTrigger(table.dbTableName, table.id);
    try {
      await updateRecord(
        table.id,
        recordId!,
        {
          record: {
            fields: {
              [statusField!.id]: 'Blocked',
            },
          },
          fieldKeyType: FieldKeyType.Id,
          typecast: true,
        },
        500
      );
    } finally {
      await cleanupTrigger();
    }

    const [tableMeta, operation] = await Promise.all([
      metaPrisma.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { provisionState: true },
      }),
      metaPrisma.schemaOperation.findFirst({
        where: { tableId: table.id, type: 'table.update' },
        orderBy: { createdTime: 'desc' },
      }),
    ]);

    expect(tableMeta.provisionState).toBe(ProvisionState.ready);
    // A typecast select-option add is not a physical schema repair, so the
    // schema operation runs inside the record-write transaction. When the data
    // write fails and that outer transaction rolls back, TableUpdateFlow's
    // afterRollback hook closes the operation as ready and records the failure
    // on the result instead of marking it 'error' (nothing left to repair: the
    // metadata change rolled back with the transaction, and the table stays
    // available).
    expect(operation?.phase).toBe('ready');
    expect(operation?.status).toBe('ready');
    expect(operation?.result).toMatchObject({ nonRepairableFailure: expect.any(String) });
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);
  });

  it('keeps a table ready when computed field backfill fails during a schema update', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Computed backfill data failure availability',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);
    const amountField = table.fields.find((field) => field.name === 'Amount');
    expect(amountField?.id).toBeTruthy();

    await createRecords(table.id, {
      fieldKeyType: FieldKeyType.Name,
      records: [{ fields: { Name: 'Task 1', Amount: 2 } }],
    });

    const cleanupTrigger = await createFailingUpdateTrigger(table.dbTableName, table.id);
    try {
      await createField(
        table.id,
        {
          name: 'Computed Amount',
          type: FieldType.Formula,
          options: { expression: `{${amountField!.id}} * 2` },
        },
        500
      );
    } finally {
      await cleanupTrigger();
    }

    const [tableMeta, operation] = await Promise.all([
      metaPrisma.tableMeta.findUniqueOrThrow({
        where: { id: table.id },
        select: { provisionState: true },
      }),
      waitForTerminalTableUpdate(table.id),
    ]);

    expect(tableMeta.provisionState).toBe(ProvisionState.ready);
    expect(operation?.phase).toBe('error');
    expect(['error', 'dead']).toContain(operation?.status);
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);
  });

  it('repairs an interrupted table.update operation that never recorded an error', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Interrupted table update recovery',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);
    const amountField = table.fields.find((field) => field.name === 'Amount');
    expect(amountField?.id).toBeTruthy();

    // A real view update goes through TableUpdateFlow and produces a genuine
    // table.update schema operation row for this table. Its completion is
    // written before the response returns, so a single read is enough.
    await updateViewFilter(table.id, table.defaultViewId, {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: amountField!.id,
            operator: 'isGreater',
            value: 1,
          },
        ],
      },
    });

    const completed = await metaPrisma.schemaOperation.findFirstOrThrow({
      where: { tableId: table.id, type: 'table.update' },
      orderBy: { createdTime: 'desc' },
    });
    expect(completed.status).toBe('ready');

    // Simulate the lost finalization write observed in production: the request
    // committed its metadata change but the operation stayed pending with no
    // recorded error (process restart, dropped after-commit hook). Keep the
    // background 50ms poller from racing the direct runner below: future-date
    // the operation for the real clock, then claim it with that future instant.
    const claimNow = new Date(Date.now() + 3_600_000);
    const interrupted = await metaPrisma.schemaOperation.update({
      where: { id: completed.id },
      data: {
        status: 'pending',
        phase: 'metadata_pending',
        attempts: 0,
        result: Prisma.DbNull,
        lastError: null,
        nextRunAt: claimNow,
        lastModifiedTime: new Date(Date.now() - 10 * 60_000),
        lockedAt: null,
        lockedBy: null,
      },
    });

    const recovered = await runSchemaOperationUntilSettled(interrupted.id, { claimNow });
    expect(recovered.status).toBe('ready');
    expect(recovered.phase).toBe('ready');
    expect(recovered.lastError).toBeNull();
    expect(recovered.result).toMatchObject({
      repaired: 'table_schema',
      tableIds: [table.id],
    });

    const tableMeta = await metaPrisma.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { provisionState: true },
    });
    expect(tableMeta.provisionState).toBe(ProvisionState.ready);
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);
  });

  it('settles a payload-less table.update connection timeout as a rolled-back no-op', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Connection timeout table update settlement',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);
    const amountField = table.fields.find((field) => field.name === 'Amount');
    expect(amountField?.id).toBeTruthy();

    await updateViewFilter(table.id, table.defaultViewId, {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: amountField!.id,
            operator: 'isGreater',
            value: 1,
          },
        ],
      },
    });

    const completed = await metaPrisma.schemaOperation.findFirstOrThrow({
      where: { tableId: table.id, type: 'table.update' },
      orderBy: { createdTime: 'desc' },
    });
    expect(completed.status).toBe('ready');

    // Production shape for BACKEND-AI-1JX / T7104: the table.update unit of work
    // hit a connection timeout, the begin write rolled back with the parent
    // transaction (payload null), and the settlement row was left in error.
    const claimNow = new Date(Date.now() + 3_600_000);
    const timedOut = await metaPrisma.schemaOperation.update({
      where: { id: completed.id },
      data: {
        status: 'error',
        phase: 'error',
        payload: Prisma.DbNull,
        result: {
          tableUpdateFailure: { code: 'unexpected' },
        },
        attempts: 1,
        lastError:
          'Unexpected unit of work error: Error: Connection terminated due to connection timeout',
        nextRunAt: claimNow,
        lockedAt: null,
        lockedBy: null,
      },
    });

    const recovered = await runSchemaOperationUntilSettled(timedOut.id, { claimNow });
    expect(recovered.status).toBe('ready');
    expect(recovered.phase).toBe('ready');
    expect(recovered.lastError).toBeNull();
    expect(recovered.result).toMatchObject({
      repaired: 'transaction_rollback',
      tableIds: [table.id],
    });

    const tableMeta = await metaPrisma.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { provisionState: true },
    });
    expect(tableMeta.provisionState).toBe(ProvisionState.ready);
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);
  });

  it('repairs a table.update whose data phase failed on a missing physical column', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Missing column update recovery',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText, isPrimary: true },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;
    createdTables.push(table);
    const amountField = table.fields.find((field) => field.name === 'Amount');
    expect(amountField?.id).toBeTruthy();

    // Simulate split meta/data DDL loss: the physical column is gone while the
    // field metadata still references it.
    const { schemaName, tableName } = parseDbTableName(table.dbTableName);
    await dataPrisma.$executeRawUnsafe(
      `ALTER TABLE ${quoteIdent(schemaName)}.${quoteIdent(tableName)} DROP COLUMN ${quoteIdent(amountField!.dbFieldName)}`
    );

    // A type conversion touches the missing column, so the data phase fails
    // with SQLSTATE 42703 and the update request itself fails.
    await convertField(table.id, amountField!.id, { type: FieldType.SingleLineText }, 500);

    // Pin the operation beyond the background runner's horizon and read it back
    // in one statement, so the structured failure classification is asserted
    // before any runner pass repairs and rewrites it.
    const pinned = await metaPrisma.$queryRawUnsafe<
      { id: string; status: string; result: unknown; lastError: string | null; claimNow: Date }[]
    >(
      `UPDATE "schema_operation"
       SET "next_run_at" = now() + interval '1 hour'
       WHERE "id" = (
         SELECT "id" FROM "schema_operation"
         WHERE "table_id" = $1 AND "type" = 'table.update'
         ORDER BY "created_time" DESC
         LIMIT 1
       )
       RETURNING "id", "status", "result", "last_error" AS "lastError",
         ("next_run_at" + interval '1 millisecond') AS "claimNow"`,
      table.id
    );
    expect(pinned).toHaveLength(1);
    expect(pinned[0]!.status).toBe('error');
    expect(pinned[0]!.lastError).toContain('does not exist');
    expect(pinned[0]!.result).toMatchObject({
      tableUpdateFailure: { code: 'db.undefined_column' },
    });

    const recovered = await runSchemaOperationUntilSettled(pinned[0]!.id, {
      // Use the database deadline, not another machine's clock. PostgreSQL stores
      // microseconds; the 1ms SQL offset stays past that deadline after Date truncation.
      claimNow: pinned[0]!.claimNow,
    });
    expect(recovered.status).toBe('ready');
    expect(recovered.phase).toBe('ready');
    expect(recovered.lastError).toBeNull();
    expect(recovered.result).toMatchObject({
      repaired: 'table_schema',
      tableIds: [table.id],
    });

    const tableMeta = await metaPrisma.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { provisionState: true },
    });
    expect(tableMeta.provisionState).toBe(ProvisionState.ready);
    await expect(getPhysicalColumns(table.dbTableName)).resolves.toContain(
      amountField!.dbFieldName
    );
  });
});
