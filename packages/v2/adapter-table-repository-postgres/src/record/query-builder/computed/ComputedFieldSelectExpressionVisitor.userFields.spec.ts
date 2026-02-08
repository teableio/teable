/**
 * Integration tests for CreatedBy/LastModifiedBy fields in ComputedFieldSelectExpressionVisitor.
 *
 * These fields should read from system columns (__created_by, __last_modified_by)
 * and join the users table to populate complete user objects.
 */
import {
  BaseId,
  DbFieldName,
  FieldId,
  FieldName,
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

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const TEXT_FIELD_ID = `fld${'c'.repeat(16)}`;
const CREATED_BY_FIELD_ID = `fld${'d'.repeat(16)}`;
const LAST_MODIFIED_BY_FIELD_ID = `fld${'e'.repeat(16)}`;

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

const compileQuery = (db: Kysely<DynamicDB>, builder: ComputedTableRecordQueryBuilder) => {
  const result = builder.build();
  expect(result.isOk()).toBe(true);
  if (result.isErr()) throw new Error(result.error.message);
  const compiled = result.value.compile();
  return { sql: compiled.sql, parameters: compiled.parameters };
};

const createTableWithUserFields = () => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const textFieldId = FieldId.create(TEXT_FIELD_ID)._unsafeUnwrap();
  const createdByFieldId = FieldId.create(CREATED_BY_FIELD_ID)._unsafeUnwrap();
  const lastModifiedByFieldId = FieldId.create(LAST_MODIFIED_BY_FIELD_ID)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('UserFieldsTable')._unsafeUnwrap());

  // Add text field
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();

  // Add CreatedBy field
  builder
    .field()
    .createdBy()
    .withId(createdByFieldId)
    .withName(FieldName.create('CreatedBy')._unsafeUnwrap())
    .done();

  // Add LastModifiedBy field
  builder
    .field()
    .lastModifiedBy()
    .withId(lastModifiedByFieldId)
    .withName(FieldName.create('LastModifiedBy')._unsafeUnwrap())
    .done();

  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();

  // Set db field names
  const fields = table.getFields();
  fields[0].setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())._unsafeUnwrap();
  fields[1].setDbFieldName(DbFieldName.rehydrate('col_created_by')._unsafeUnwrap())._unsafeUnwrap();
  fields[2]
    .setDbFieldName(DbFieldName.rehydrate('col_last_modified_by')._unsafeUnwrap())
    ._unsafeUnwrap();

  return table;
};

describe('ComputedTableRecordQueryBuilder with CreatedBy/LastModifiedBy fields', () => {
  it('should read CreatedBy field from __created_by system column with users join', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    // CreatedBy field should read from __created_by system column
    expect(sql).toContain('where u.id = "t"."__created_by"');

    // Should build user object with jsonb_build_object
    expect(sql).toContain('jsonb_build_object');
    expect(sql).toContain("'id', u.id");
    expect(sql).toContain("'title', u.name");
    expect(sql).toContain("'email', u.email");
    expect(sql).toContain("'avatarUrl'");

    // Should have avatar prefix parameter
    expect(parameters).toContain('/api/attachments/read/public/avatar/');
  });

  it('should read LastModifiedBy field from __last_modified_by system column with users join', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql } = compileQuery(db, qb.from(table));

    // LastModifiedBy field should read from __last_modified_by system column
    expect(sql).toContain('where u.id = "t"."__last_modified_by"');
  });

  it('should generate correct SELECT expression for user fields', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    // Should have exactly 2 avatar prefix parameters (one for CreatedBy, one for LastModifiedBy)
    const avatarPrefixes = parameters.filter((p) => p === '/api/attachments/read/public/avatar/');
    expect(avatarPrefixes).toHaveLength(2);

    // Should alias as the field's db column name
    expect(sql).toContain('as "col_created_by"');
    expect(sql).toContain('as "col_last_modified_by"');
  });
});
