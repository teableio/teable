/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { createTable as apiCreateTable } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { initApp, permanentDeleteTable } from './utils/init-app';

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

  const baseId = globalThis.testConfig.baseId;
  const createdTables: ITableFullVo[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    metaPrisma = app.get(PrismaService);
    dataPrisma = app.get(DataPrismaService);
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
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
});
