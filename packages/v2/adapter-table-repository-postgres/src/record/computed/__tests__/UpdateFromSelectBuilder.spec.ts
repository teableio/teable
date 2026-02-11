import {
  BaseId,
  DbFieldName,
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
      `"update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", 1 as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" where "t"."__id" in (select "d"."record_id" from "tmp_computed_dirty" as "d" where "d"."table_id" = $1)) as "c" where "u"."__id" = "c"."__id" and ("u"."col_score" IS DISTINCT FROM "c"."col_score"::double precision)"`
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
      `"update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", 1 as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1) as "c" where "u"."__id" = "c"."__id" and ("u"."col_score" IS DISTINCT FROM "c"."col_score"::double precision)"`
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

      // Verify columnToFieldId mapping
      const fieldIdForColumn = updateResult.value.columnToFieldId.get('col_score');
      expect(fieldIdForColumn).toBe(formulaFieldId.toString());
    });
  });
});
