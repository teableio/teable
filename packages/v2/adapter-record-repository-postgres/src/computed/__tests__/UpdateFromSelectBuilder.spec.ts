import {
  BaseId,
  DbFieldName,
  FieldName,
  FormulaExpression,
  Table,
  TableId,
  TableName,
} from '@teable/v2-core';
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

    const selectBuilder = new ComputedTableRecordQueryBuilder(db)
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
      `"update "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "u" set "col_score" = "c"."col_score" from (select "t"."__id" as "__id", 1 as "col_score" from "bseaaaaaaaaaaaaaaaa"."tblbbbbbbbbbbbbbbbb" as "t" where "t"."__id" in (select "d"."record_id" from "tmp_computed_dirty" as "d" where "d"."table_id" = $1)) as "c" where "u"."__id" = "c"."__id""`
    );
  });
});
