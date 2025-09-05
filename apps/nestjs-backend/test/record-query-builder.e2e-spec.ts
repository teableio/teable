/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo } from '@teable/core';
import { FieldType as FT } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { format as formatSql } from 'sql-formatter';
import type { IRecordQueryBuilder } from '../src/features/record/query-builder';
import { RECORD_QUERY_BUILDER_SYMBOL } from '../src/features/record/query-builder';
import { createField, createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('RecordQueryBuilder (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  let table: { id: string };
  let f1: IFieldVo;
  let f2: IFieldVo;
  let f3: IFieldVo;
  let dbTableName: string;
  let rqb: IRecordQueryBuilder;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

    // Create table and fields once
    table = await createTable(baseId, { name: 'rqb_simple' });
    f1 = (await createField(table.id, { type: FT.SingleLineText, name: 'c1' })) as IFieldVo;
    f2 = (await createField(table.id, { type: FT.Number, name: 'c2' })) as IFieldVo;
    f3 = (await createField(table.id, { type: FT.Date, name: 'c3' })) as IFieldVo;

    const prisma = app.get(PrismaService);
    const meta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: table.id },
      select: { dbTableName: true },
    });
    dbTableName = meta.dbTableName;

    rqb = app.get<IRecordQueryBuilder>(RECORD_QUERY_BUILDER_SYMBOL);
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
    await app.close();
  });

  const normalizeSql = (rawSql: string, alias: string) => {
    const stableTableId = 'tbl_TEST';
    const stableAlias = 'TBL_ALIAS';
    let sql = rawSql;
    // Normalize alias — keeps column qualifiers intact
    sql = sql.split(alias).join(stableAlias);
    // Normalize ids (defensive; may not appear anymore)
    sql = sql.split(table.id).join(stableTableId);
    // Normalize field names
    sql = sql
      .split(f1.dbFieldName)
      .join('col_c1')
      .split(f2.dbFieldName)
      .join('col_c2')
      .split(f3.dbFieldName)
      .join('col_c3');
    return sql;
  };

  const pretty = (s: string) => formatSql(s, { language: 'postgresql' });

  it('builds SELECT for a table with 3 simple fields', async () => {
    const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
      tableIdOrDbTableName: table.id,
      projection: [f1.id, f2.id, f3.id],
    });
    // Override FROM to stable name without touching alias
    qb.from({ [alias]: 'db_table' });

    const formatted = pretty(normalizeSql(qb.limit(1).toQuery(), alias));
    expect(formatted).toMatchInlineSnapshot(`
      "select
        "TBL_ALIAS"."__id",
        "TBL_ALIAS"."__version",
        "TBL_ALIAS"."__auto_number",
        "TBL_ALIAS"."__created_time",
        "TBL_ALIAS"."__last_modified_time",
        "TBL_ALIAS"."__created_by",
        "TBL_ALIAS"."__last_modified_by",
        "TBL_ALIAS"."col_c1" AS "col_c1",
        "TBL_ALIAS"."col_c2" AS "col_c2",
        to_char(
          "TBL_ALIAS"."col_c3" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) as "col_c3"
      from
        "db_table" as "TBL_ALIAS"
      limit
        1"
    `);
  });

  it('builds SELECT with partial projection (only two fields)', async () => {
    const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
      tableIdOrDbTableName: table.id,
      projection: [f1.id, f3.id],
    });
    // Override FROM to stable name without touching alias
    qb.from({ [alias]: 'db_table' });
    const formatted = pretty(normalizeSql(qb.limit(1).toQuery(), alias));
    expect(formatted).toMatchInlineSnapshot(`
      "select
        "TBL_ALIAS"."__id",
        "TBL_ALIAS"."__version",
        "TBL_ALIAS"."__auto_number",
        "TBL_ALIAS"."__created_time",
        "TBL_ALIAS"."__last_modified_time",
        "TBL_ALIAS"."__created_by",
        "TBL_ALIAS"."__last_modified_by",
        "TBL_ALIAS"."col_c1" AS "col_c1",
        to_char(
          "TBL_ALIAS"."col_c3" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) as "col_c3"
      from
        "db_table" as "TBL_ALIAS"
      limit
        1"
    `);
  });

  it('builds SELECT with partial projection (only two fields)', async () => {
    const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
      tableIdOrDbTableName: table.id,
      projection: [f1.id],
    });
    // Override FROM to stable name without touching alias
    qb.from({ [alias]: 'db_table' });
    const formatted = pretty(normalizeSql(qb.limit(1).toQuery(), alias));
    expect(formatted).toMatchInlineSnapshot(`
      "select
        "TBL_ALIAS"."__id",
        "TBL_ALIAS"."__version",
        "TBL_ALIAS"."__auto_number",
        "TBL_ALIAS"."__created_time",
        "TBL_ALIAS"."__last_modified_time",
        "TBL_ALIAS"."__created_by",
        "TBL_ALIAS"."__last_modified_by",
        "TBL_ALIAS"."col_c1" AS "col_c1"
      from
        "db_table" as "TBL_ALIAS"
      limit
        1"
    `);
  });
});
