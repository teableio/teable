import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  DbFieldName,
  DbFieldType,
  FieldId,
  FieldName,
  LookupField,
  LookupOptions,
  NumberConditionSpec,
  RecordConditionFieldReferenceValue,
  createNumberField,
} from '@teable/v2-core';
import {
  Pg16TypeValidationStrategy,
  PgLegacyTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
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

const compileMembership = (legacy = false) => {
  const foreign = createNumberField({
    id: FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Account')._unsafeUnwrap(),
  })._unsafeUnwrap();
  foreign.setDbFieldName(DbFieldName.rehydrate('account')._unsafeUnwrap())._unsafeUnwrap();
  foreign.setDbFieldType(DbFieldType.rehydrate('REAL')._unsafeUnwrap())._unsafeUnwrap();
  const host = LookupField.create({
    id: FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Accounts')._unsafeUnwrap(),
    innerField: foreign,
    lookupOptions: LookupOptions.create({
      linkFieldId: `fld${'c'.repeat(16)}`,
      lookupFieldId: foreign.id().toString(),
      foreignTableId: `tbl${'d'.repeat(16)}`,
    })._unsafeUnwrap(),
    isMultipleCellValue: true,
  })._unsafeUnwrap();
  host.setDbFieldName(DbFieldName.rehydrate('accounts')._unsafeUnwrap())._unsafeUnwrap();
  const visitor = new TableRecordConditionWhereVisitor({
    tableAlias: 'f',
    hostTableAlias: 'h',
    typeValidationStrategy: legacy
      ? new PgLegacyTypeValidationStrategy()
      : new Pg16TypeValidationStrategy(),
  });
  NumberConditionSpec.create(
    foreign,
    'is',
    RecordConditionFieldReferenceValue.create(host)._unsafeUnwrap()
  )
    .accept(visitor)
    ._unsafeUnwrap();
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

/** T7180: same scalar-number / array-lookup membership shape as the slow rollup. */
describe('conditional numeric membership keeps the foreign btree usable', () => {
  const db = new PGlite();
  beforeAll(async () => {
    // Model an existing PG15 installation, then run the actual upgrade migration.
    await db.exec(`CREATE FUNCTION public.teable_try_cast_valid(text, text)
      RETURNS boolean LANGUAGE SQL AS 'SELECT false'`);
    await db.exec(
      readFileSync(
        new URL(
          '../../../../../db-main-prisma/prisma/postgres/migrations/20260907111000_extend_try_cast_double_precision/migration.sql',
          import.meta.url
        ),
        'utf8'
      )
    );
    await db.exec(`SET enable_seqscan = on; CREATE TABLE source (account double precision, amount integer);
      CREATE INDEX source_account_idx ON source(account);
      INSERT INTO source SELECT n, 1 FROM generate_series(1, 20000) n;
      INSERT INTO source VALUES (42, 2), (NULL, 3), ('NaN', 4), ('Infinity', 5), ('-Infinity', 6), (0, 7), ('-0', 8);
      CREATE TABLE host (accounts jsonb);
      INSERT INTO host VALUES ('[42, 42, null]'); ANALYZE source; ANALYZE host;`);
  });
  afterAll(() => db.close());

  it('uses a parameterized foreign index scan for one host instead of scanning all source rows', async () => {
    const compiled = compileMembership();
    const { rows } = await db.query(
      `EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS)
      SELECT SUM(total) FROM (
        SELECT h.accounts, SUM(f.amount) AS total FROM host h LEFT JOIN source f ON ${compiled.sql}
          WHERE current_setting('extra_float_digits')::integer > 0 GROUP BY h.accounts
        UNION ALL
        SELECT h.accounts, SUM(f.amount) AS total FROM host h LEFT JOIN source f ON
          EXISTS (SELECT 1 FROM jsonb_array_elements_text(h.accounts) elem WHERE elem = f.account::text)
          WHERE current_setting('extra_float_digits')::integer <= 0 GROUP BY h.accounts
      ) chosen`,
      [...compiled.parameters]
    );
    const plan = JSON.stringify(rows);
    expect(plan).toContain('source_account_idx');
    const findSequentialSourceScans = (value: unknown): object[] => {
      if (Array.isArray(value)) return value.flatMap(findSequentialSourceScans);
      if (!value || typeof value !== 'object') return [];
      const entries = Object.entries(value);
      const isSourceScan =
        entries.some(([key, item]) => key === 'Relation Name' && item === 'source') &&
        entries.some(([key, item]) => key === 'Node Type' && item === 'Seq Scan');
      return [
        ...(isSourceScan ? [value] : []),
        ...Object.values(value).flatMap(findSequentialSourceScans),
      ];
    };
    const inactiveScans = findSequentialSourceScans(rows);
    expect(inactiveScans.length).toBeGreaterThan(0);
    for (const scan of inactiveScans)
      expect(Object.entries(scan)).toContainEqual(['Actual Loops', 0]);
    expect(compiled.sql).toContain('("f"."account" = ANY(');
  });

  it.each([false, true])(
    'preserves text membership, duplicates and NULLs (legacy=%s)',
    async (legacy) => {
      const compiled = compileMembership(legacy);
      const values = [
        '[42,42,null]',
        '["-0"]',
        '["0"]',
        '["42", "042", "42.0", "4.2e1", " 42"]',
        '["1e99999", "1e-99999", "invalid", {}, true]',
        '["NaN", "Infinity", "-Infinity", "nan", "-0", "0"]',
        '[]',
        'null',
        null,
        '42',
        '"42"',
        '[1.0, 42.00, 0]',
      ];
      for (const value of values) {
        const { rows } = await db.query(
          `WITH h AS (SELECT $1::jsonb AS accounts)
        SELECT f.account::text AS account, (${compiled.sql}) AS optimized,
          EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE
            WHEN jsonb_typeof(to_jsonb(h.accounts)) = 'array' THEN to_jsonb(h.accounts)
            WHEN to_jsonb(h.accounts) IS NULL THEN '[]'::jsonb
            ELSE jsonb_build_array(to_jsonb(h.accounts)) END) elem
            WHERE elem = f.account::text) AS original
        FROM h CROSS JOIN source f WHERE f.account IN (0,1,42,'NaN','Infinity','-Infinity') OR f.account IS NULL`,
          [value]
        );
        for (const row of rows)
          expect(row.optimized, JSON.stringify({ value, row })).toBe(row.original);
      }
      const { rows } = await db.query(
        `SELECT SUM(f.amount) AS total FROM host h LEFT JOIN source f ON ${compiled.sql}`
      );
      expect(rows[0].total).toBe(3);
    }
  );

  it('retains every existing polyfill target while adding double precision safely', async () => {
    const { rows } = await db.query(`SELECT
      public.teable_try_cast_valid('1', 'numeric') AS numeric,
      public.teable_try_cast_valid('{}', 'jsonb') AS jsonb,
      public.teable_try_cast_valid('2026-01-01', 'timestamp') AS timestamp,
      public.teable_try_cast_valid('2026-01-01', 'timestamptz') AS timestamptz,
      public.teable_try_cast_valid('1e9999', 'double precision') AS overflow,
      public.teable_try_cast_valid('1e-9999', 'double precision') AS underflow`);
    expect(rows[0]).toEqual({
      numeric: true,
      jsonb: true,
      timestamp: true,
      timestamptz: true,
      overflow: false,
      underflow: false,
    });
  });

  it('uses the existing PG15 cast validation polyfill rather than PG16-only SQL', () => {
    const compiled = compileMembership(true);
    expect(compiled.sql).toContain(
      "public.teable_try_cast_valid(__membership.value, 'double precision')"
    );
    expect(compiled.sql).not.toContain('pg_input_is_valid');
  });
});
