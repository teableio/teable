/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ITableFullVo } from '@teable/core';
import { FieldKeyType } from '@teable/core';
import { createRecords, createTable, deleteTable, initApp } from './utils/init-app';

describe('Credit limit (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    process.env.MAX_FREE_ROW_LIMIT = '10';
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    process.env.MAX_FREE_ROW_LIMIT = undefined;
    await app.close();
  });

  describe('max row limit', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await deleteTable(baseId, table.id);
    });

    it('should create a record', async () => {
      // create 6 record succeed, 3(default) + 7 = 10
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: Array.from({ length: 7 }).map(() => ({ fields: {} })),
      });

      // limit exceed
      await createRecords(
        table.id,
        {
          fieldKeyType: FieldKeyType.Name,
          records: [{ fields: {} }],
        },
        400
      );
    });
  });
});
