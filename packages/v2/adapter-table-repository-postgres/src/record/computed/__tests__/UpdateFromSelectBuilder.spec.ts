import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import type { DynamicDB } from '../../query-builder';
import {
  ComputedTableRecordQueryBuilder,
  COMPUTED_TABLE_ALIAS,
} from '../../query-builder/computed';
import { UpdateFromSelectBuilder } from '../UpdateFromSelectBuilder';

const typeValidationStrategy = new Pg16TypeValidationStrategy();

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const CREATED_TIME_FIELD_ID = `fld${'c'.repeat(16)}`;
const LAST_MODIFIED_TIME_FIELD_ID = `fld${'d'.repeat(16)}`;

const createFormulaTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('FormulaTable')._unsafeUnwrap());

  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder
    .field()
    .formula()
    .withName(FieldName.create('Score')._unsafeUnwrap())
    .withExpression(FormulaExpression.create('1')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('col_score')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, formulaFieldId: table.getFields()[1].id() };
};

const createCreatedTimeTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const createdTimeFieldId = FieldId.create(CREATED_TIME_FIELD_ID)._unsafeUnwrap();
  const lastModifiedTimeFieldId = FieldId.create(LAST_MODIFIED_TIME_FIELD_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('SystemTimeTable')._unsafeUnwrap());

  builder
    .field()
    .createdTime()
    .withId(createdTimeFieldId)
    .withName(FieldName.create('Created Time')._unsafeUnwrap())
    .done();
  builder
    .field()
    .lastModifiedTime()
    .withId(lastModifiedTimeFieldId)
    .withName(FieldName.create('Last Modified Time')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(createdTimeFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_created_time')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getField((field) => field.id().equals(lastModifiedTimeFieldId))
    ._unsafeUnwrap()
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_time')._unsafeUnwrap())
    ._unsafeUnwrap();

  return { table, createdTimeFieldId, lastModifiedTimeFieldId };
};

describe('UpdateFromSelectBuilder', () => {
  it('builds UPDATE FROM SELECT for computed formula field', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const dirtySubquery = db
      .selectFrom('tmp_computed_dirty as d')
      .select('d.record_id')
      .where('d.table_id', '=', table.id().toString());

    const filteredSelect = selectResult.value.where(
      `${COMPUTED_TABLE_ALIAS}.__id`,
      'in',
      dirtySubquery
    );

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: filteredSelect,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    expect(updateResult.value.sql).toMatchInlineSnapshot(
      `
      "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."__set_col_score" from (select "c_src"."__id" as "__id", CASE
          WHEN ("c_src"."col_score") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_score")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_score")::text)::double precision
          ELSE NULL
        END as "__set_col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", NULLIF(BTRIM((1)::text), '')::double precision as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" where "t"."__id" in (select "d"."record_id" from "tmp_computed_dirty" as "d" where "d"."table_id" = $1)) as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."col_score" IS DISTINCT FROM "c"."__set_col_score")"
    `
    );
  });

  it('increments __version in computed update SET clause', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: selectResult.value,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    // Verify __version is incremented in the SET clause
    expect(updateResult.value.sql).toContain('"__version" = "u"."__version" + 1');
  });

  it('can omit __version increment for externally versioned field chunks', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.buildWithReturning({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: selectResult.value,
      incrementVersion: false,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    expect(updateResult.value.compiled.sql).not.toContain('"__version" =');
    expect(updateResult.value.compiled.sql).toContain('"u"."__version" as "__old_version"');
  });

  it('builds UPDATE FROM SELECT with dirtyFilter using INNER JOIN for better query planning', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();

    // Apply dirty filter on the ComputedTableRecordQueryBuilder BEFORE building
    // This ensures the dirty JOIN is placed BEFORE lateral joins for optimal query planning
    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId])
      .withDirtyFilter({ tableId: table.id().toString() });
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: selectResult.value,
      // Note: dirtyFilter is NOT passed here - it's already applied in the select query
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    // Verify the SQL uses INNER JOIN with dirty table BEFORE the select columns
    // This allows PostgreSQL to use the small dirty table to drive indexed lookups
    expect(updateResult.value.sql).toContain('inner join "tmp_computed_dirty"');
    expect(updateResult.value.sql).not.toContain(' in (select');

    // The dirty join should appear BEFORE any lateral joins in the SQL
    // This is critical for query planning - dirty filter must come first
    const sqlText = updateResult.value.sql;
    const dirtyJoinPos = sqlText.indexOf('inner join "tmp_computed_dirty"');
    const lateralJoinPos = sqlText.indexOf('inner join lateral');

    // If there are no lateral joins (simple formula case), that's fine
    // But if there are lateral joins, dirty filter must come first
    if (lateralJoinPos !== -1) {
      expect(dirtyJoinPos).toBeLessThan(lateralJoinPos);
    }

    expect(updateResult.value.sql).toMatchInlineSnapshot(
      `
      "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."__set_col_score" from (select "c_src"."__id" as "__id", CASE
          WHEN ("c_src"."col_score") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_score")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_score")::text)::double precision
          ELSE NULL
        END as "__set_col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", NULLIF(BTRIM((1)::text), '')::double precision as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1) as "c_src") as "c" where "u"."__id" = "c"."__id" and ("u"."col_score" IS DISTINCT FROM "c"."__set_col_score")"
    `
    );
  });

  it('omits IS DISTINCT FROM filter when skipDistinctFilter is true', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);

    // Without skipDistinctFilter (default) - should include IS DISTINCT FROM
    const withDistinct = builder.build({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: selectResult.value,
    });
    expect(withDistinct.isOk()).toBe(true);
    if (withDistinct.isErr()) return;
    expect(withDistinct.value.sql).toContain('IS DISTINCT FROM');

    // With skipDistinctFilter=true - should NOT include IS DISTINCT FROM
    const withoutDistinct = builder.build({
      table,
      fieldIds: [formulaFieldId],
      selectQuery: selectResult.value,
      skipDistinctFilter: true,
    });
    expect(withoutDistinct.isOk()).toBe(true);
    if (withoutDistinct.isErr()) return;
    expect(withoutDistinct.value.sql).not.toContain('IS DISTINCT FROM');
    // Should still have the basic WHERE clause joining on __id
    expect(withoutDistinct.value.sql).toContain('"u"."__id" = "c"."__id"');
  });

  it('keeps system time projections timestamp-typed and compares as text for legacy columns', () => {
    const db = createTestDb();
    const { table, createdTimeFieldId, lastModifiedTimeFieldId } = createCreatedTimeTable();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([createdTimeFieldId, lastModifiedTimeFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [createdTimeFieldId, lastModifiedTimeFieldId],
      selectQuery: selectResult.value,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    expect(updateResult.value.sql).toContain(
      '"c_src"."col_created_time"::timestamptz as "__set_col_created_time"'
    );
    expect(updateResult.value.sql).toContain(
      '"c_src"."col_last_modified_time"::timestamptz as "__set_col_last_modified_time"'
    );
    expect(updateResult.value.sql).toContain(
      '("u"."col_created_time")::text IS DISTINCT FROM ("c"."__set_col_created_time")::text'
    );
    expect(updateResult.value.sql).toContain(
      '("u"."col_last_modified_time")::text IS DISTINCT FROM ("c"."__set_col_last_modified_time")::text'
    );
    expect(updateResult.value.sql).not.toContain(
      '"c_src"."col_created_time"::text as "__set_col_created_time"'
    );
    expect(updateResult.value.sql).not.toContain(
      '"c_src"."col_last_modified_time"::text as "__set_col_last_modified_time"'
    );
  });

  describe('buildWithReturning', () => {
    it('returns __old_version as version before computed update', () => {
      const db = createTestDb();
      const { table, formulaFieldId } = createFormulaTable();

      const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
        .from(table)
        .select([formulaFieldId]);
      const selectResult = selectBuilder.build();
      expect(selectResult.isOk()).toBe(true);
      if (selectResult.isErr()) return;

      const builder = new UpdateFromSelectBuilder(db);
      const updateResult = builder.buildWithReturning({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: selectResult.value,
      });

      expect(updateResult.isOk()).toBe(true);
      if (updateResult.isErr()) return;

      // Verify RETURNING clause includes __old_version as version - 1
      // Since __version is incremented in SET, RETURNING returns the NEW value
      // So we need __version - 1 to get the OLD value for ShareDB sync
      expect(updateResult.value.compiled.sql).toContain(
        'RETURNING "u"."__id", "u"."__version" - 1 as "__old_version"'
      );

      // Verify __version is incremented in the SET clause
      expect(updateResult.value.compiled.sql).toContain('"__version" = "u"."__version" + 1');

      // Verify column mapping is correct
      expect(updateResult.value.columnToFieldId.has('col_score')).toBe(true);
    });

    it('includes all updated field columns in RETURNING clause', () => {
      const db = createTestDb();
      const { table, formulaFieldId } = createFormulaTable();

      const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
        .from(table)
        .select([formulaFieldId]);
      const selectResult = selectBuilder.build();
      expect(selectResult.isOk()).toBe(true);
      if (selectResult.isErr()) return;

      const builder = new UpdateFromSelectBuilder(db);
      const updateResult = builder.buildWithReturning({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: selectResult.value,
      });

      expect(updateResult.isOk()).toBe(true);
      if (updateResult.isErr()) return;

      // Verify RETURNING includes the formula column
      expect(updateResult.value.compiled.sql).toContain('"u"."col_score"');
      expect(updateResult.value.compiled.sql).toContain(
        ', "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "__old" where "__old"."__id" = "c"."__id"'
      );
      expect(updateResult.value.compiled.sql).toContain('"__old"."col_score" as "__old_col_score"');
      expect(updateResult.value.oldColumnAliases.get('col_score')).toBe('__old_col_score');

      // Verify columnToFieldId mapping
      const fieldIdForColumn = updateResult.value.columnToFieldId.get('col_score');
      expect(fieldIdForColumn).toBe(formulaFieldId.toString());
    });

    it('injects old table into the outer UPDATE FROM scope when source select has nested where clauses', () => {
      const db = createTestDb();
      const { table, formulaFieldId } = createFormulaTable();

      const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
        .from(table)
        .select([formulaFieldId]);
      const selectResult = selectBuilder.build();
      expect(selectResult.isOk()).toBe(true);
      if (selectResult.isErr()) return;

      const dirtySubquery = db
        .selectFrom('tmp_computed_dirty as d')
        .select('d.record_id')
        .where('d.table_id', '=', table.id().toString());

      const filteredSelect = selectResult.value.where(
        `${COMPUTED_TABLE_ALIAS}.__id`,
        'in',
        dirtySubquery
      );

      const builder = new UpdateFromSelectBuilder(db);
      const updateResult = builder.buildWithReturning({
        table,
        fieldIds: [formulaFieldId],
        selectQuery: filteredSelect,
      });

      expect(updateResult.isOk()).toBe(true);
      if (updateResult.isErr()) return;

      const sql = updateResult.value.compiled.sql;
      const sourceAliasIndex = sql.lastIndexOf(') as "c"');
      const oldTableIndex = sql.indexOf(
        ', "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "__old" where "__old"."__id" = "c"."__id"'
      );

      expect(sourceAliasIndex).toBeGreaterThan(-1);
      expect(oldTableIndex).toBeGreaterThan(sourceAliasIndex);
      expect(sql).toContain('where "t"."__id" in (select "d"."record_id"');
      expect(sql).not.toContain(
        'from "tmp_computed_dirty" as "d", "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "__old"'
      );
    });
  });
});
