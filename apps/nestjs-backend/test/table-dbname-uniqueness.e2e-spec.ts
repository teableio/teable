import type { INestApplication } from '@nestjs/common';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Table dbTableName uniqueness (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let createdTableIds: string[] = [];

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (!createdTableIds.length) return;
    await Promise.all(
      createdTableIds.map((id) => permanentDeleteTable(baseId, id).catch(() => undefined))
    );
    createdTableIds = [];
  });

  it('creates concurrent tables with the same name without dbTableName collisions', async () => {
    const tableName = 'Parallel Related Table';

    const tables = await Promise.all(
      Array.from({ length: 3 }, () => createTable(baseId, { name: tableName }))
    );

    createdTableIds = tables.map((t) => t.id);

    const dbTableNames = tables.map((t) => t.dbTableName);
    expect(new Set(dbTableNames).size).toBe(tables.length);
  });
});
