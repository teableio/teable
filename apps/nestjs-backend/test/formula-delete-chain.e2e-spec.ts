/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ITableFullVo } from '@teable/openapi';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import {
  createField,
  createTable,
  deleteField,
  deleteTable,
  getField,
  initApp,
} from './utils/init-app';

describe('Formula delete dependency chain (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dbProvider: IDbProvider;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
    dbProvider = app.get<IDbProvider>(DB_PROVIDER_SYMBOL);
  });

  afterAll(async () => {
    await app.close();
  });

  it('marks downstream formulas hasError and drops generated columns after deleting base field', async () => {
    // 1) Create table with a non-primary text field and number field A (A is not primary)
    const table: ITableFullVo = await createTable(baseId, {
      name: 'Formula Chain Delete Test',
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'A', type: FieldType.Number },
      ],
      records: [{ fields: { Title: 'r1', A: 1 } }],
    });

    const fieldA = table.fields.find((f) => f.name === 'A')!;

    // 2) Create formula B = A * 2
    const fieldB: IFieldVo = await createField(table.id, {
      type: FieldType.Formula,
      name: 'B',
      options: { expression: `{${fieldA.id}} * 2` },
    });

    // 3) Create formula C = B * 2
    const fieldC: IFieldVo = await createField(table.id, {
      type: FieldType.Formula,
      name: 'C',
      options: { expression: `{${fieldB.id}} * 2` },
    });

    // Get dbTableName for the created table
    const tableMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { dbTableName: true },
    });

    const columnInfoSql = dbProvider.columnInfo(tableMeta.dbTableName);
    const listColumns = async (): Promise<string[]> => {
      const rows = await prisma.txClient().$queryRawUnsafe<{ name: string }[]>(columnInfoSql);
      return rows.map((r) => r.name);
    };

    // 4) Expect B and C have physical columns initially
    const initialCols = await listColumns();
    expect(initialCols).toContain(fieldB.dbFieldName);
    expect(initialCols).toContain(fieldC.dbFieldName);

    // 5) Delete A
    await deleteField(table.id, fieldA.id);

    // 6) Expect generated columns for B and C are dropped at DB level
    const afterDeleteCols = await listColumns();
    expect(afterDeleteCols).not.toContain(fieldB.dbFieldName);
    expect(afterDeleteCols).not.toContain(fieldC.dbFieldName);

    // 7) Expect both B and C have hasError = true
    const bVo = await getField(table.id, fieldB.id);
    const cVo = await getField(table.id, fieldC.id);
    expect(!!bVo.hasError).toBe(true);
    expect(!!cVo.hasError).toBe(true);

    // Cleanup
    await deleteTable(baseId, table.id);
  });
});
