/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILinkFieldOptionsRo, ILookupOptionsRo } from '@teable/core';
import { FieldType as FT, Relationship, StatisticsFunc } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { format as formatSql } from 'sql-formatter';
import type { IRecordQueryBuilder } from '../src/features/record/query-builder';
import { RECORD_QUERY_BUILDER_SYMBOL } from '../src/features/record/query-builder';
import {
  createField,
  createTable,
  deleteField,
  permanentDeleteTable,
  initApp,
} from './utils/init-app';

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
        "TBL_ALIAS"."col_c3" AS "col_c3"
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
        "TBL_ALIAS"."col_c3" AS "col_c3"
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

  it('pushes record id restriction into the base CTE', async () => {
    const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
      tableIdOrDbTableName: table.id,
      projection: [f1.id],
      restrictRecordIds: ['rec_TEST_1'],
    });

    const formatted = pretty(normalizeSql(qb.limit(1).toQuery(), alias));

    expect(formatted).toMatch(/with\s+"BASE_TBL_ALIAS"\s+as/i);
    expect(formatted).toMatch(/where\s+"TBL_ALIAS"\."__id"\s+in\s+\('rec_TEST_1'\)/i);
    expect(formatted).toMatch(/from\s+"BASE_TBL_ALIAS"\s+as\s+"TBL_ALIAS"/i);
  });

  it('pushes record id restriction into the aggregate base CTE', async () => {
    const { qb, alias } = await rqb.createRecordAggregateBuilder(dbTableName, {
      tableIdOrDbTableName: table.id,
      aggregationFields: [
        {
          fieldId: '*',
          statisticFunc: StatisticsFunc.Count,
          alias: 'row_count',
        },
      ],
      restrictRecordIds: ['rec_TEST_2'],
    });

    const formatted = pretty(normalizeSql(qb.toQuery(), alias));
    expect(formatted).toMatch(/with\s+"BASE_TBL_ALIAS"\s+as/i);
    expect(formatted).toMatch(/where\s+"TBL_ALIAS"\."__id"\s+in\s+\('rec_TEST_2'\)/i);
    expect(formatted).toMatch(/from\s+"BASE_TBL_ALIAS"\s+as\s+"TBL_ALIAS"/i);
  });

  it('qualifies system columns inside lookup CTE formulas', async () => {
    const foreignTable = await createTable(baseId, { name: 'rqb_lookup_src' });
    const foreignFormulaRo: IFieldRo = {
      name: 'Created Text',
      type: FT.Formula,
      options: {
        expression: `DATETIME_FORMAT(CREATED_TIME(), 'YYYY-MM-DD')`,
      },
    };
    const foreignFormula = await createField(foreignTable.id, foreignFormulaRo);

    let linkField: IFieldVo | undefined;
    let lookupField: IFieldVo | undefined;

    try {
      const linkOptions: ILinkFieldOptionsRo = {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
      };
      const linkFieldRo: IFieldRo = {
        name: 'Link Lookup Src',
        type: FT.Link,
        options: linkOptions,
      };
      linkField = await createField(table.id, linkFieldRo);

      const lookupOptions: ILookupOptionsRo = {
        foreignTableId: foreignTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: foreignFormula.id,
      };
      const lookupFieldRo: IFieldRo = {
        name: 'Lookup Created Text',
        type: FT.Formula,
        isLookup: true,
        lookupOptions,
      };
      lookupField = await createField(table.id, lookupFieldRo);

      const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
        tableIdOrDbTableName: table.id,
        projection: [lookupField.id],
      });

      qb.from({ [alias]: 'db_table' });
      const sql = qb.limit(1).toQuery();

      expect(sql).not.toContain('TO_CHAR("__created_time"');
      expect(sql).toContain('"__created_time"');
    } finally {
      if (lookupField) {
        await deleteField(table.id, lookupField.id);
      }
      if (linkField) {
        await deleteField(table.id, linkField.id);
      }
      await permanentDeleteTable(baseId, foreignTable.id);
    }
  });

  it('left joins link CTEs even when dependencies pre-generate them', async () => {
    const selfLink = await createField(table.id, {
      name: 'Self Link',
      type: FT.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table.id,
      },
    } as IFieldRo);

    try {
      const { qb, alias } = await rqb.createRecordQueryBuilder(dbTableName, {
        tableIdOrDbTableName: table.id,
        projection: [selfLink.id],
      });

      qb.from({ [alias]: 'db_table' });
      const sql = qb.limit(1).toQuery();

      const linkCtePattern = new RegExp(
        `LEFT JOIN "CTE_[^"]*_${selfLink.id}" ON "${alias}"\\."__id" = "CTE_[^"]*_${selfLink.id}"\\."main_record_id"`,
        'i'
      );
      expect(sql).toMatch(linkCtePattern);
    } finally {
      await deleteField(table.id, selfLink.id);
    }
  });
});
