import type { INestApplication } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('Table Creation Concurrency (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should avoid db name collisions when creating tables concurrently', async () => {
    if (globalThis.testConfig.driver !== DriverClient.Pg) {
      return;
    }

    const sharedName = `Concurrent Table ${Math.random().toString(36).slice(2, 8)}`;
    const createdTableIds: string[] = [];

    try {
      const createTasks = Array.from({ length: 3 }, () =>
        createTable(baseId, { name: sharedName }, 201)
      );
      const results = await Promise.allSettled(createTasks);

      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      expect(rejected.map((result) => result.reason)).toEqual([]);

      const tables = results
        .filter(
          (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createTable>>> =>
            result.status === 'fulfilled'
        )
        .map((result) => result.value);

      createdTableIds.push(...tables.map((table) => table.id));

      const dbTableNames = tables.map((table) => table.dbTableName);
      expect(new Set(dbTableNames).size).toBe(tables.length);

      const tableNames = tables.map((table) => table.name);
      expect(new Set(tableNames).size).toBe(tables.length);
    } finally {
      for (const tableId of createdTableIds) {
        await permanentDeleteTable(baseId, tableId);
      }
    }
  });
});
