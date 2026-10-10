import { PGlite } from '@electric-sql/pglite';
import {
  DbFieldName,
  DbFieldType,
  FieldConditionSpecBuilder,
  FieldId,
  FieldName,
  LookupField,
  LookupOptions,
  RecordConditionFieldReferenceValue,
  createSingleLineTextField,
} from '@teable/v2-core';
import type { SingleLineTextField } from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TableRecordConditionWhereVisitor } from './TableRecordConditionWhereVisitor';

/**
 * T7653: an empty field-reference side must not match an empty compared side.
 * `normalizeToJsonArray` folds SQL NULL into '[]', so the array-like equality
 * needs an explicit non-empty guard; these cases execute the compiled predicate
 * against real Postgres rows rather than asserting SQL text.
 */
const buildLookupField = (params: {
  id: string;
  name: string;
  dbFieldName: string;
  innerField: SingleLineTextField;
  lookupFieldId: string;
}) => {
  const field = LookupField.create({
    id: FieldId.create(params.id)._unsafeUnwrap(),
    name: FieldName.create(params.name)._unsafeUnwrap(),
    innerField: params.innerField,
    lookupOptions: LookupOptions.create({
      linkFieldId: `fld${'c'.repeat(16)}`,
      lookupFieldId: params.lookupFieldId,
      foreignTableId: `tbl${'d'.repeat(16)}`,
    })._unsafeUnwrap(),
    isMultipleCellValue: true,
  })._unsafeUnwrap();
  field.setDbFieldName(DbFieldName.rehydrate(params.dbFieldName)._unsafeUnwrap())._unsafeUnwrap();
  field.setDbFieldType(DbFieldType.rehydrate('JSONB')._unsafeUnwrap())._unsafeUnwrap();
  return field;
};

const compileLookupEquality = (operator: 'is' | 'isNot') => {
  const innerFieldId = `fld${'a'.repeat(16)}`;
  const innerField = createSingleLineTextField({
    id: FieldId.create(innerFieldId)._unsafeUnwrap(),
    name: FieldName.create('Email')._unsafeUnwrap(),
  })._unsafeUnwrap();

  const foreignLookup = buildLookupField({
    id: `fld${'b'.repeat(16)}`,
    name: 'Customer Email',
    dbFieldName: 'customer_email',
    innerField,
    lookupFieldId: innerFieldId,
  });
  const hostLookup = buildLookupField({
    id: `fld${'e'.repeat(16)}`,
    name: 'Email Lookup',
    dbFieldName: 'host_email',
    innerField,
    lookupFieldId: innerFieldId,
  });

  const spec = FieldConditionSpecBuilder.create(foreignLookup)
    .create({
      operator,
      value: RecordConditionFieldReferenceValue.create(hostLookup)._unsafeUnwrap(),
    })
    ._unsafeUnwrap();

  const visitor = new TableRecordConditionWhereVisitor({
    tableAlias: 'f',
    hostTableAlias: 'h',
  });
  spec.accept(visitor)._unsafeUnwrap();
  const db = new Kysely<Record<string, Record<string, unknown>>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return sql`${visitor.where()._unsafeUnwrap()}`.compile(db);
};

describe('lookup field-reference equality ignores empty sides (T7653)', () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE host_rows (__id text primary key, host_email jsonb);
      INSERT INTO host_rows VALUES
        ('h-null', NULL),
        ('h-array-empty', '[]'::jsonb),
        ('h-json-null', 'null'::jsonb),
        ('h-null-element', '[null]'::jsonb),
        ('h-match', '["match@example.com"]'::jsonb),
        ('h-other', '["other@example.com"]'::jsonb);
      CREATE TABLE foreign_rows (__id text primary key, customer_email jsonb);
      INSERT INTO foreign_rows VALUES
        ('f-null', NULL),
        ('f-array-empty', '[]'::jsonb),
        ('f-json-null', 'null'::jsonb),
        ('f-null-element', '[null]'::jsonb),
        ('f-match', '["match@example.com"]'::jsonb),
        ('f-match-copy', '["match@example.com"]'::jsonb),
        ('f-other', '["other@example.com"]'::jsonb);
    `);
  });

  afterAll(() => db.close());

  it('does not join an empty host value to an empty foreign value with is', async () => {
    const compiled = compileLookupEquality('is');
    const { rows } = await db.query<{ host: string; foreign: string }>(
      `SELECT h.__id AS host, f.__id AS foreign
       FROM host_rows h JOIN foreign_rows f ON (${compiled.sql})
       ORDER BY h.__id, f.__id`,
      [...compiled.parameters]
    );

    expect(rows).toEqual([
      { host: 'h-match', foreign: 'f-match' },
      { host: 'h-match', foreign: 'f-match-copy' },
      { host: 'h-other', foreign: 'f-other' },
    ]);
  });

  it('excludes both-empty sides from isNot like scalar distinctness', async () => {
    const compiled = compileLookupEquality('isNot');
    const { rows } = await db.query<{ host: string; foreign: string }>(
      `SELECT h.__id AS host, f.__id AS foreign
       FROM host_rows h JOIN foreign_rows f ON (${compiled.sql})
       WHERE h.__id = 'h-null'
       ORDER BY f.__id`,
      [...compiled.parameters]
    );

    // h-null has no value: it differs from every populated foreign value, while the
    // no-value foreign rows (SQL NULL / '[]' / JSON null) are not "different" from it -
    // the same bound scalar `is distinct from` gives a NULL side.
    expect(rows.map((row) => row.foreign)).toEqual(['f-match', 'f-match-copy', 'f-other']);
  });
});
