import {
  BaseId,
  DbFieldName,
  FieldHasError,
  FieldId,
  FieldName,
  FieldNotNull,
  FormulaExpression,
  LinkFieldConfig,
  RollupExpression,
  RollupFieldConfig,
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
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

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

const createErroredFormulaTable = () => {
  const result = createFormulaTable();
  result.table
    .getField((field) => field.id().equals(result.formulaFieldId))
    ._unsafeUnwrap()
    .setHasError(FieldHasError.error());
  return result;
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

const createDuplicateManyManyRollupTable = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
  const linkFieldId = FieldId.create(`fld${'k'.repeat(16)}`)._unsafeUnwrap();
  const lookupFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();

  const foreignBuilder = Table.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('LineItems')._unsafeUnwrap());
  foreignBuilder
    .field()
    .number()
    .withId(lookupFieldId)
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  foreignBuilder.view().defaultGrid().done();
  const foreignTable = foreignBuilder.build()._unsafeUnwrap();
  foreignTable
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_amount')._unsafeUnwrap())
    ._unsafeUnwrap();

  const linkConfig = LinkFieldConfig.create({
    relationship: 'manyMany',
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
    symmetricFieldId: `fld${'s'.repeat(16)}`,
  })._unsafeUnwrap();
  const rollupConfig = RollupFieldConfig.create({
    linkFieldId: linkFieldId.toString(),
    foreignTableId: foreignTableId.toString(),
    lookupFieldId: lookupFieldId.toString(),
  })._unsafeUnwrap();
  const expression = RollupExpression.create('sum({values})')._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Invoices')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Items')._unsafeUnwrap())
    .withConfig(linkConfig)
    .done();
  builder
    .field()
    .rollup()
    .withName(FieldName.create('Total')._unsafeUnwrap())
    .withConfig(rollupConfig)
    .withExpression(expression)
    .done();
  builder
    .field()
    .rollup()
    .withName(FieldName.create('Total copy')._unsafeUnwrap())
    .withConfig(rollupConfig)
    .withExpression(expression)
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
  const fields = table.getFields();
  ['col_name', 'col_items', 'col_total', 'col_total_copy'].forEach((columnName, index) => {
    fields[index].setDbFieldName(DbFieldName.rehydrate(columnName)._unsafeUnwrap())._unsafeUnwrap();
  });

  return {
    table,
    foreignTable,
    foreignTableId,
    rollupFieldIds: [fields[2].id(), fields[3].id()],
  };
};

const createSharedDbFieldNameRollupTable = () => {
  const result = createDuplicateManyManyRollupTable();
  const fields = result.rollupFieldIds.map((fieldId) =>
    result.table.getField((field) => field.id().equals(fieldId))._unsafeUnwrap()
  );
  const sharedDbFieldName = DbFieldName.rehydrate('col_shared_total')._unsafeUnwrap();
  vi.spyOn(fields[0], 'dbFieldName').mockReturnValue(ok(sharedDbFieldName));
  vi.spyOn(fields[1], 'dbFieldName').mockReturnValue(ok(sharedDbFieldName));
  return result;
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
      "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."__set_col_score"::double precision from (select "c_src"."__id" as "__id", CASE
          WHEN ("c_src"."col_score") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_score")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_score")::text)::double precision
          ELSE NULL
        END as "__set_col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", NULLIF(BTRIM((1)::text), '')::double precision as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" where "t"."__id" in (select "d"."record_id" from "tmp_computed_dirty" as "d" where "d"."table_id" = $1)) as "c_src") as "c" where "u"."__id" = "c"."__id" and (("u"."col_score")::double precision IS DISTINCT FROM ("c"."__set_col_score")::double precision)"
    `
    );
  });

  it('aggregates duplicate manyMany rollups once in the generated UPDATE', () => {
    const db = createTestDb();
    const { table, foreignTable, foreignTableId, rollupFieldIds } =
      createDuplicateManyManyRollupTable();
    const foreignTables = new Map([[foreignTableId.toString(), foreignTable]]);
    const selectResult = new ComputedTableRecordQueryBuilder(db, {
      foreignTables,
      typeValidationStrategy,
    })
      .from(table)
      .select(rollupFieldIds)
      .withDirtyFilter({ tableId: table.id().toString() })
      .build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const updateResult = new UpdateFromSelectBuilder(db).build({
      table,
      fieldIds: rollupFieldIds,
      selectQuery: selectResult.value,
    });
    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    const sqlText = updateResult.value.sql;
    expect(sqlText).not.toContain('join lateral');
    expect(sqlText.match(/"junction_[^"]+"/g)).toHaveLength(1);
    expect(sqlText).toContain('left join "bseaaaaaaaaaaaaaaaa"."junction_');
    expect(sqlText).toContain('group by "h"."__id"');
    expect(sqlText.match(/SUM\("f"\."col_amount"\)/g)).toHaveLength(2);
    expect(sqlText).toContain('COALESCE(SUM("f"."col_amount"), 0)');
    expect(sqlText).toContain('inner join "tmp_computed_dirty"');
    expect(sqlText).toContain('"__version" = "u"."__version" + 1');
    expect(sqlText).toContain(
      '("u"."col_total")::double precision IS DISTINCT FROM ("c"."__set_col_total")::double precision'
    );
    expect(sqlText).toContain(
      '("u"."col_total_copy")::double precision IS DISTINCT FROM ("c"."__set_col_total_copy")::double precision'
    );
  });

  it('updates a shared physical column only once when duplicate fields reference it', () => {
    const db = createTestDb();
    const { table, foreignTable, foreignTableId, rollupFieldIds } =
      createSharedDbFieldNameRollupTable();
    const selectResult = new ComputedTableRecordQueryBuilder(db, {
      foreignTables: new Map([[foreignTableId.toString(), foreignTable]]),
      typeValidationStrategy,
    })
      .from(table)
      .select(rollupFieldIds)
      .withDirtyFilter({ tableId: table.id().toString() })
      .build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const updateResult = new UpdateFromSelectBuilder(db).build({
      table,
      fieldIds: rollupFieldIds,
      selectQuery: selectResult.value,
    });
    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    const sqlText = updateResult.value.sql;
    expect(sqlText.match(/as "col_shared_total"/g)).toHaveLength(2);
    expect(sqlText.match(/"col_shared_total" =/g)).toHaveLength(1);
    expect(sqlText).not.toContain('__set_col_shared_total_1');
  });

  it('uses the healthy field when a later errored field shares its physical column', () => {
    const db = createTestDb();
    const { table, foreignTable, foreignTableId, rollupFieldIds } =
      createSharedDbFieldNameRollupTable();
    table
      .getField((field) => field.id().equals(rollupFieldIds[1]))
      ._unsafeUnwrap()
      .setHasError(FieldHasError.error());
    const selectResult = new ComputedTableRecordQueryBuilder(db, {
      foreignTables: new Map([[foreignTableId.toString(), foreignTable]]),
      typeValidationStrategy,
    })
      .from(table)
      .select(rollupFieldIds)
      .withDirtyFilter({ tableId: table.id().toString() })
      .build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const updateResult = new UpdateFromSelectBuilder(db).build({
      table,
      fieldIds: rollupFieldIds,
      selectQuery: selectResult.value,
    });
    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    expect(updateResult.value.sql.match(/"col_shared_total" =/g)).toHaveLength(1);
    expect(updateResult.value.sql).not.toContain('__set_col_shared_total_1');
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

  it('builds a no-op query when all requested fields are skipped', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createErroredFormulaTable();

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
    expect(updateResult.value.sql).toBe('select 1 where false');
  });

  it('skips plan field ids that were deleted between planning and execution', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();
    const deletedFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [formulaFieldId, deletedFieldId],
      selectQuery: selectResult.value,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;
    expect(updateResult.value.sql).toContain('"col_score" = "c"."__set_col_score"');
  });

  it('degrades to a no-op when every plan field id was deleted', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createFormulaTable();
    const deletedFieldId = FieldId.create(`fld${'z'.repeat(16)}`)._unsafeUnwrap();

    const selectBuilder = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
      .from(table)
      .select([formulaFieldId]);
    const selectResult = selectBuilder.build();
    expect(selectResult.isOk()).toBe(true);
    if (selectResult.isErr()) return;

    const builder = new UpdateFromSelectBuilder(db);
    const updateResult = builder.build({
      table,
      fieldIds: [deletedFieldId],
      selectQuery: selectResult.value,
    });

    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;
    expect(updateResult.value.sql).toBe('select 1 where false');
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

  it('builds a no-op returning query when all requested returned fields are skipped', () => {
    const db = createTestDb();
    const { table, formulaFieldId } = createErroredFormulaTable();

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
    expect(updateResult.value.compiled.sql).toBe(
      'select null::text as "__id", null::integer as "__old_version" where false'
    );
    expect(updateResult.value.columnToFieldId.size).toBe(0);
    expect(updateResult.value.oldColumnAliases.size).toBe(0);
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
      "update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "__version" = "u"."__version" + 1, "col_score" = "c"."__set_col_score"::double precision from (select "c_src"."__id" as "__id", CASE
          WHEN ("c_src"."col_score") IS NULL THEN NULL
          WHEN BTRIM(("c_src"."col_score")::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
            THEN BTRIM(("c_src"."col_score")::text)::double precision
          ELSE NULL
        END as "__set_col_score" from (select "t"."__id" as "__id", "t"."__version" as "__version", NULLIF(BTRIM((1)::text), '')::double precision as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" inner join "tmp_computed_dirty" as "__dirty" on "t"."__id" = "__dirty"."record_id" and "__dirty"."table_id" = $1) as "c_src") as "c" where "u"."__id" = "c"."__id" and (("u"."col_score")::double precision IS DISTINCT FROM ("c"."__set_col_score")::double precision)"
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
    expect(updateResult.value.sql).toContain(
      '"col_created_time" = "c"."__set_col_created_time"::timestamptz'
    );
    expect(updateResult.value.sql).toContain(
      '"col_last_modified_time" = "c"."__set_col_last_modified_time"::timestamptz'
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
      expect(updateResult.value.compiled.sql).toContain('"__old"."col_score" as "__old_0"');
      expect(updateResult.value.oldColumnAliases.get('col_score')).toBe('__old_0');

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

  it('keeps the previous required link display value when the computed projection is null', () => {
    const db = createTestDb();
    const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
    const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'f'.repeat(16)}`)._unsafeUnwrap();
    const linkFieldId = FieldId.create(`fld${'l'.repeat(16)}`)._unsafeUnwrap();
    const lookupFieldId = FieldId.create(`fld${'p'.repeat(16)}`)._unsafeUnwrap();

    const foreignBuilder = Table.builder()
      .withId(foreignTableId)
      .withBaseId(baseId)
      .withName(TableName.create('Profiles')._unsafeUnwrap());
    foreignBuilder
      .field()
      .singleLineText()
      .withId(lookupFieldId)
      .withName(FieldName.create('profile_id')._unsafeUnwrap())
      .done();
    foreignBuilder.view().defaultGrid().done();
    const foreignTable = foreignBuilder.build()._unsafeUnwrap();
    foreignTable
      .getFields()[0]
      .setDbFieldName(DbFieldName.rehydrate('profile_id')._unsafeUnwrap())
      ._unsafeUnwrap();
    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: foreignTableId.toString(),
      lookupFieldId: lookupFieldId.toString(),
      isOneWay: true,
      fkHostTableName: `${BASE_ID}.${TABLE_ID}`,
      selfKeyName: '__id',
      foreignKeyName: '__fk_status',
    })._unsafeUnwrap();

    const builder = Table.builder()
      .withId(tableId)
      .withBaseId(baseId)
      .withName(TableName.create('Tasks')._unsafeUnwrap());
    builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
    builder
      .field()
      .link()
      .withId(linkFieldId)
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withConfig(linkConfig)
      .withNotNull(FieldNotNull.required())
      .done();
    builder.view().defaultGrid().done();

    const table = builder.build({ foreignTables: [foreignTable] })._unsafeUnwrap();
    table
      .getFields()[0]
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    table
      .getFields()[1]
      .setDbFieldName(DbFieldName.rehydrate('Status')._unsafeUnwrap())
      ._unsafeUnwrap();

    const selectResult = new ComputedTableRecordQueryBuilder(db, {
      foreignTables: new Map([[foreignTableId.toString(), foreignTable]]),
      typeValidationStrategy,
    })
      .from(table)
      .select([linkFieldId])
      .withDirtyFilter({ tableId: table.id().toString() })
      .build();
    if (selectResult.isErr()) {
      throw new Error(selectResult.error.message);
    }

    const updateResult = new UpdateFromSelectBuilder(db).build({
      table,
      fieldIds: [linkFieldId],
      selectQuery: selectResult.value,
    });
    expect(updateResult.isOk()).toBe(true);
    if (updateResult.isErr()) return;

    // A null projection (missed join or cleared FK) must keep the existing
    // display value so the NOT NULL display column is never assigned NULL.
    expect(updateResult.value.sql).toContain('COALESCE("c"."__set_Status"::jsonb, "u"."Status")');
    expect(updateResult.value.sql).not.toContain('ELSE "c"."__set_Status"::jsonb END');
    expect(updateResult.value.sql).toContain('("c"."__set_Status") IS NOT NULL');
    expect(updateResult.value.sql).not.toContain('"u"."__fk_status" IS NULL OR');
    expect(updateResult.value.sql).not.toContain('"Status" = "c"."__set_Status"');
  });
});
