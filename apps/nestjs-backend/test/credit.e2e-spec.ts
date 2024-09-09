/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { createBase, createSpace, deleteBase, deleteSpace } from '@teable/openapi';
import { createRecords, createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('Credit limit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  beforeAll(async () => {
    process.env.MAX_FREE_ROW_LIMIT = '10';
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    process.env.MAX_FREE_ROW_LIMIT = undefined;
    await app.close();
  });

  describe('max row limit', () => {
    let table: ITableFullVo;
    let spaceId: string;
    let baseId: string;
    beforeEach(async () => {
      const space = await createSpace({
        name: 'space1',
      });
      spaceId = space.data.id;
      const base = await createBase({
        spaceId,
      });
      baseId = base.data.id;
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
      await deleteBase(baseId);
      await deleteSpace(spaceId);
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

    it('should create a record with credit', async () => {
      prisma.space.update({
        where: {
          id: spaceId,
        },
        data: {
          credit: 11,
        },
      });

      // create 6 record succeed, 3(default) + 8 = 11
      await createRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: Array.from({ length: 8 }).map(() => ({ fields: {} })),
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
