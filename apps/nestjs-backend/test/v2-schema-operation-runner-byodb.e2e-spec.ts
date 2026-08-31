/* eslint-disable sonarjs/no-duplicate-string */
import { setTimeout as delay } from 'node:timers/promises';
import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import { PrismaService, ProvisionState } from '@teable/db-main-prisma';
import { createTable as apiCreateTable } from '@teable/openapi';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import {
  createBase,
  createSpace,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
} from './utils/init-app';

process.env.V2_SCHEMA_OPERATION_RUNNER_POLL_INTERVAL_MS = '50';
process.env.V2_SCHEMA_OPERATION_RUNNER_MAX_BATCH = '5';

const databaseIdentity = (url?: string) => {
  if (!url) {
    return undefined;
  }

  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
};

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const byodbDataDatabaseUrl = process.env.BYODB_E2E_DATA_DATABASE_URL;
const isIndependentByodbDataDb =
  databaseIdentity(metaDatabaseUrl) != null &&
  databaseIdentity(byodbDataDatabaseUrl) != null &&
  databaseIdentity(metaDatabaseUrl) !== databaseIdentity(byodbDataDatabaseUrl);
const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const describeByodbRunner = isForceV2 && isIndependentByodbDataDb ? describe : describe.skip;

const tableExists = async (client: KnexType, dbTableName: string) => {
  const [schemaName, tableName] = dbTableName.split('.');
  const rows = await client.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name = ?
      ) AS "exists"
    `,
    [schemaName, tableName]
  );

  return Boolean(rows.rows[0]?.exists);
};

const safeDropSchema = async (client: KnexType, schema?: string) => {
  if (!schema) {
    return;
  }

  await client
    .raw(`DROP SCHEMA IF EXISTS "${schema.replace(/"/g, '""')}" CASCADE`)
    .catch(() => undefined);
};

describeByodbRunner('V2 schema operation runner BYODB routing (e2e)', () => {
  let app: INestApplication;
  let metaPrisma: PrismaService;
  let dbProvider: IDbProvider;
  let metaDb: KnexType;
  let byodbDb: KnexType;
  let spaceId: string | undefined;
  let baseId: string | undefined;
  const internalSchema = `byodb_runner_e2e_${Date.now().toString(36)}`;

  beforeAll(async () => {
    metaDb = Knex({ client: 'pg', connection: metaDatabaseUrl });
    byodbDb = Knex({ client: 'pg', connection: byodbDataDatabaseUrl });

    const appCtx = await initApp();
    app = appCtx.app;
    metaPrisma = app.get(PrismaService);
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
  }, 60_000);

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    if (spaceId) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }

    // A misrouted repair lands on the meta DB; clean both sides either way.
    await safeDropSchema(byodbDb, baseId);
    await safeDropSchema(metaDb, baseId);
    await safeDropSchema(byodbDb, internalSchema);
    await safeDropSchema(metaDb, internalSchema);

    await byodbDb?.destroy().catch(() => undefined);
    await metaDb?.destroy().catch(() => undefined);
    await app?.close();
  }, 60_000);

  const waitForRecoveredTable = async (
    table: { id: string; dbTableName: string },
    timeoutMs = 8_000
  ) => {
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
        tableExists(byodbDb, table.dbTableName),
      ]);

      lastStatus = operation?.status;
      lastProvisionState = tableMeta?.provisionState;
      lastTableExists = exists;

      if (operation?.status === 'ready' && tableMeta?.provisionState === 'ready' && exists) {
        return operation;
      }

      await delay(100);
    } while (Date.now() - startedAt < timeoutMs);

    throw new Error(
      `Timed out waiting for BYODB schema operation recovery: status=${String(
        lastStatus
      )}, provisionState=${String(lastProvisionState)}, tableExistsOnByodb=${String(
        lastTableExists
      )}`
    );
  };

  it('repairs a failed table create on the bound BYODB data DB, not the meta DB', async () => {
    const space = await createSpace({
      name: 'BYODB runner e2e',
      dataDb: {
        mode: 'byodb',
        url: byodbDataDatabaseUrl!,
        targetMode: 'initialize-empty',
        internalSchema,
      },
    });
    spaceId = space.id;

    const base = await createBase({ spaceId: space.id, name: 'BYODB runner base' });
    baseId = base.id;

    const createRes = await apiCreateTable(base.id, {
      name: 'BYODB runner recovery',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');

    const table = createRes.data;

    // The synchronous create path already routes to the bound data DB.
    await expect(tableExists(byodbDb, table.dbTableName)).resolves.toBe(true);
    await expect(tableExists(metaDb, table.dbTableName)).resolves.toBe(false);

    const operation = await metaPrisma.schemaOperation.findFirstOrThrow({
      where: { tableId: table.id, type: 'table.create' },
      orderBy: { createdTime: 'desc' },
    });
    expect(operation.status).toBe('ready');

    // Simulate the production failure: metadata committed, then the data
    // transaction that creates the physical table on the bound BYODB database
    // failed, leaving the schema operation in error for the runner to repair.
    await byodbDb.raw(dbProvider.dropTable(table.dbTableName));
    await expect(tableExists(byodbDb, table.dbTableName)).resolves.toBe(false);

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
        lastError: 'e2e simulated BYODB data schema loss',
      },
    });

    const repairedOperation = await waitForRecoveredTable(table);
    expect(repairedOperation.result).toMatchObject({
      repaired: 'table_schema',
      tableIds: [table.id],
    });

    const primaryField = table.fields.find((field) => field.name === 'Name');
    expect(primaryField?.dbFieldName).toBeTruthy();
    const columns = await byodbDb
      .raw(dbProvider.columnInfo(table.dbTableName))
      .then((result) => result.rows.map((row: { name: string }) => row.name));
    expect(columns).toContain(primaryField!.dbFieldName);

    // The repair must not leak the physical table into the meta DB.
    await expect(tableExists(metaDb, table.dbTableName)).resolves.toBe(false);
  });
});
