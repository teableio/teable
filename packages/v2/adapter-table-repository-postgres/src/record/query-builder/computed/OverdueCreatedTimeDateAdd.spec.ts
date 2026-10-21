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
import { describe, expect, test } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

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

const compileOverdueSql = () => {
  const db = createTestDb();
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'m'.repeat(16)}`)._unsafeUnwrap();
  const statusFieldId = FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap();
  const hoursFieldId = FieldId.create(`fld${'h'.repeat(16)}`)._unsafeUnwrap();
  const formulaFieldId = FieldId.create(`fld${'o'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('OverdueTable')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withId(statusFieldId)
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .done();
  builder
    .field()
    .number()
    .withId(hoursFieldId)
    .withName(FieldName.create('SlaHours')._unsafeUnwrap())
    .done();
  builder
    .field()
    .formula()
    .withId(formulaFieldId)
    .withName(FieldName.create('Overdue')._unsafeUnwrap())
    .withExpression(
      FormulaExpression.create(
        `IF(OR({${statusFieldId.toString()}} = "Completed",{${statusFieldId.toString()}} = "Cancelled"), false, IF({${hoursFieldId.toString()}} > 0, IF(IS_AFTER(NOW(), DATE_ADD(CREATED_TIME(), {${hoursFieldId.toString()}}, "hours")), true, false), false))`
      )._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();
  table
    .getFields()[0]
    .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[1]
    .setDbFieldName(DbFieldName.rehydrate('col_status')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[2]
    .setDbFieldName(DbFieldName.rehydrate('col_sla_hours')._unsafeUnwrap())
    ._unsafeUnwrap();
  table
    .getFields()[3]
    .setDbFieldName(DbFieldName.rehydrate('col_overdue')._unsafeUnwrap())
    ._unsafeUnwrap();

  const result = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy })
    .from(table)
    .select([formulaFieldId])
    .build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) throw new Error(result.error.message);
  return result.value.compile().sql.replace(/\s+/g, ' ');
};

describe('overdue created-time date add backfill', () => {
  test('does not pass timestamptz into BTRIM when compiling overdue formula', () => {
    const normalizedSql = compileOverdueSql();
    expect(normalizedSql).toContain("INTERVAL '1 hour'");
    expect(normalizedSql).not.toMatch(/BTRIM\(\s*(NOW\(\)|"t"\."__created_time")/);
    expect(normalizedSql).not.toMatch(/BTRIM\(\s*\(\s*(NOW\(\)|"t"\."__created_time")\s*\)\s*\)/);
  });
});
