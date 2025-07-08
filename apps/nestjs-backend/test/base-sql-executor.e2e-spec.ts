import type { INestApplication } from '@nestjs/common';
import { DriverClient } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { BaseSqlExecutorService } from '../src/features/base-sql-executor/base-sql-executor.service';
import {
  createBase,
  createSpace,
  createTable,
  initApp,
  permanentDeleteSpace,
} from './utils/init-app';

describe.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
  'BaseSqlExecutorService',
  () => {
    let app: INestApplication;
    let baseSqlExecutorService: BaseSqlExecutorService;
    let prismaService: PrismaService;
    let baseId: string;
    let spaceId: string;
    let tableDbName: string;

    beforeAll(async () => {
      const appCtx = await initApp();
      app = appCtx.app;
      baseSqlExecutorService = app.get(BaseSqlExecutorService);
      prismaService = app.get(PrismaService);
      spaceId = await createSpace({
        name: 'BaseSqlExecutorService test space',
      }).then((space) => space.id);

      baseId = await createBase({
        name: 'BaseSqlExecutorService test base',
        spaceId,
      }).then((base) => base.id);

      const table = await createTable(baseId, {
        name: 'BaseSqlExecutorService test table',
      });
      tableDbName = `"${table.dbTableName.split('.')[0]}"."${table.dbTableName.split('.')[1]}"`;
    });

    afterAll(async () => {
      await permanentDeleteSpace(spaceId);
      await app.close();
    });

    it('only read only role can execute sql', async () => {
      const result = await baseSqlExecutorService.executeQuerySql(
        baseId,
        `select * from ${tableDbName}`
      );
      expect(result).toBeDefined();
    });

    it('read only role can not execute sql to throw error', async () => {
      await expect(
        baseSqlExecutorService['db']?.$queryRawUnsafe(`create table ${tableDbName} (id int)`)
      ).rejects.toThrow('ERROR: permission denied for schema');
    });

    it('read only role can read base', async () => {
      await expect(
        baseSqlExecutorService.executeQuerySql(
          globalThis.testConfig.baseId,
          `select * from ${tableDbName}`,
          {
            projectionTableDbNames: [tableDbName.replaceAll('"', '')],
          }
        )
      ).rejects.toThrow('ERROR: permission denied for schema');
    });

    it('prisma service can execute sql', async () => {
      await prismaService.$queryRawUnsafe(`create table test (id int)`);
      await prismaService.$queryRawUnsafe(`drop table test`);
    });
  }
);
