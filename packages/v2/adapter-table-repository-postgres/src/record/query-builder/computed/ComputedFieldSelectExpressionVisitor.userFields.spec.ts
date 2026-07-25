/**
 * Integration tests for CreatedBy/LastModifiedBy fields in ComputedFieldSelectExpressionVisitor.
 *
 * These fields should read stored data-table snapshots and fall back to system ids without
 * joining meta-plane users from the data DB.
 */
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

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import { ComputedTableRecordQueryBuilder } from './ComputedTableRecordQueryBuilder';

// Fixed IDs for stable snapshots
const BASE_ID = `bse${'a'.repeat(16)}`;
const TABLE_ID = `tbl${'b'.repeat(16)}`;
const TEXT_FIELD_ID = `fld${'c'.repeat(16)}`;
const CREATED_BY_FIELD_ID = `fld${'d'.repeat(16)}`;
const LAST_MODIFIED_BY_FIELD_ID = `fld${'e'.repeat(16)}`;
const CREATED_BY_FORMULA_FIELD_ID = `fld${'f'.repeat(16)}`;
const LAST_MODIFIED_BY_FORMULA_FIELD_ID = `fld${'g'.repeat(16)}`;

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

const createTableWithUserFields = (options: { includeFormulaFields?: boolean } = {}) => {
  const baseId = BaseId.create(BASE_ID)._unsafeUnwrap();
  const tableId = TableId.create(TABLE_ID)._unsafeUnwrap();
  const textFieldId = FieldId.create(TEXT_FIELD_ID)._unsafeUnwrap();
  const createdByFieldId = FieldId.create(CREATED_BY_FIELD_ID)._unsafeUnwrap();
  const lastModifiedByFieldId = FieldId.create(LAST_MODIFIED_BY_FIELD_ID)._unsafeUnwrap();
  const createdByFormulaFieldId = FieldId.create(CREATED_BY_FORMULA_FIELD_ID)._unsafeUnwrap();
  const lastModifiedByFormulaFieldId = FieldId.create(
    LAST_MODIFIED_BY_FORMULA_FIELD_ID
  )._unsafeUnwrap();

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

  if (options.includeFormulaFields) {
    builder
      .field()
      .formula()
      .withId(createdByFormulaFieldId)
      .withName(FieldName.create('CreatedByName')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`{${createdByFieldId.toString()}}`)._unsafeUnwrap())
      .done();

    builder
      .field()
      .formula()
      .withId(lastModifiedByFormulaFieldId)
      .withName(FieldName.create('LastModifiedByName')._unsafeUnwrap())
      .withExpression(
        FormulaExpression.create(`{${lastModifiedByFieldId.toString()}}`)._unsafeUnwrap()
      )
      .done();
  }

  builder.view().defaultGrid().done();

  const table = builder.build()._unsafeUnwrap();

  // Set db field names
  const setDbFieldName = (fieldId: FieldId, dbFieldName: string) => {
    table
      .getField((field) => field.id().equals(fieldId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate(dbFieldName)._unsafeUnwrap())
      ._unsafeUnwrap();
  };

  setDbFieldName(textFieldId, 'col_name');
  setDbFieldName(createdByFieldId, 'col_created_by');
  setDbFieldName(lastModifiedByFieldId, 'col_last_modified_by');

  if (options.includeFormulaFields) {
    setDbFieldName(createdByFormulaFieldId, 'col_created_by_name');
    setDbFieldName(lastModifiedByFormulaFieldId, 'col_last_modified_by_name');
  }

  return table;
};

describe('ComputedTableRecordQueryBuilder with CreatedBy/LastModifiedBy fields', () => {
  it('should read CreatedBy field from stored snapshot with __created_by fallback', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    expect(sql).not.toContain('public.users');
    expect(sql).not.toContain('where u.id');
    expect(sql).toContain('to_jsonb("t"."col_created_by")');
    expect(sql).toContain('"t"."__created_by"');
    expect(sql).toContain('jsonb_build_object');
    expect(parameters).toEqual([]);
  });

  it('should read LastModifiedBy field from stored snapshot with __last_modified_by fallback', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql } = compileQuery(db, qb.from(table));

    expect(sql).not.toContain('public.users');
    expect(sql).toContain('to_jsonb("t"."col_last_modified_by")');
    expect(sql).toContain('"t"."__last_modified_by"');
  });

  it('should generate correct SELECT expression for user fields', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    expect(sql).toContain('as "col_created_by"');
    expect(sql).toContain('as "col_last_modified_by"');
    expect(sql).not.toContain('public.users');
    expect(parameters).toEqual([]);
  });

  it('should use actor fallback for empty system user snapshots without joining users', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, {
      typeValidationStrategy,
      userSnapshotActorFallback: {
        actorId: 'usrTestUserId',
        actorName: 'test',
        actorEmail: 'test@teable.ai',
      },
    });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    expect(sql).not.toContain('public.users');
    expect(parameters).toContain('usrTestUserId');
    expect(parameters).toContain('test');
    expect(parameters).toContain('test@teable.ai');
  });

  it('should optionally resolve system user snapshots through users during backfill', () => {
    const db = createTestDb();
    const table = createTableWithUserFields();

    const qb = new ComputedTableRecordQueryBuilder(db, {
      typeValidationStrategy,
      resolveSystemUserSnapshotsFromUsers: true,
    });
    const { sql, parameters } = compileQuery(db, qb.from(table));

    expect(sql).toContain('FROM public.users u');
    expect(sql).toContain('COALESCE(u.name, u.id)');
    expect(sql).toContain("'/api/attachments/read/public/avatar/'");
    expect(parameters).toEqual([]);
  });

  it('should treat formula references to system user snapshots as scalar titles', () => {
    const db = createTestDb();
    const table = createTableWithUserFields({ includeFormulaFields: true });
    const createdByFormulaFieldId = FieldId.create(CREATED_BY_FORMULA_FIELD_ID)._unsafeUnwrap();
    const lastModifiedByFormulaFieldId = FieldId.create(
      LAST_MODIFIED_BY_FORMULA_FIELD_ID
    )._unsafeUnwrap();

    const qb = new ComputedTableRecordQueryBuilder(db, { typeValidationStrategy });
    const { sql } = compileQuery(
      db,
      qb.from(table).select([createdByFormulaFieldId, lastModifiedByFormulaFieldId])
    );

    expect(sql).toContain('as "col_created_by_name"');
    expect(sql).toContain('as "col_last_modified_by_name"');
    expect(sql).toContain('"t"."__created_by"');
    expect(sql).toContain('"t"."__last_modified_by"');
    expect(sql).not.toContain('jsonb_typeof((COALESCE(');
  });
});
