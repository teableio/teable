import { PGlite } from '@electric-sql/pglite';
import {
  DbFieldName,
  DbFieldType,
  FieldId,
  FieldName,
  LookupField,
  LookupOptions,
  RecordConditionLiteralValue,
  createNumberField,
  createSingleLineTextField,
} from '@teable/v2-core';
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

const compileLookupFilter = (params: {
  storage: 'REAL' | 'JSON' | 'TEXT' | undefined;
  value: string | number;
  operator?: 'is' | 'isNot';
}) => {
  const fieldParams = {
    id: FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Product')._unsafeUnwrap(),
  };
  const innerField =
    params.storage === 'TEXT'
      ? createSingleLineTextField(fieldParams)._unsafeUnwrap()
      : createNumberField(fieldParams)._unsafeUnwrap();
  const lookup = LookupField.create({
    id: FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Product Lookup')._unsafeUnwrap(),
    innerField,
    lookupOptions: LookupOptions.create({
      linkFieldId: `fld${'c'.repeat(16)}`,
      lookupFieldId: innerField.id().toString(),
      foreignTableId: `tbl${'d'.repeat(16)}`,
    })._unsafeUnwrap(),
    isMultipleCellValue: false,
  })._unsafeUnwrap();
  lookup.setDbFieldName(DbFieldName.rehydrate('product_id')._unsafeUnwrap())._unsafeUnwrap();
  if (params.storage) {
    lookup.setDbFieldType(DbFieldType.rehydrate(params.storage)._unsafeUnwrap())._unsafeUnwrap();
  }
  const visitor = new TableRecordConditionWhereVisitor({ tableAlias: 't' });
  lookup
    .spec()
    .create({
      operator: params.operator ?? 'is',
      value: RecordConditionLiteralValue.create(params.value)._unsafeUnwrap(),
    })
    ._unsafeUnwrap()
    .accept(visitor)
    ._unsafeUnwrap();
  const compiler = new Kysely<Record<string, Record<string, unknown>>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return sql`${visitor.where()._unsafeUnwrap()}`.compile(compiler);
};

describe('scalar lookup filters preserve results while using an ordered index', () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE orders (__id integer PRIMARY KEY, product_id double precision);
      INSERT INTO orders SELECT n, n % 18000 FROM generate_series(1, 176000) n;
      CREATE INDEX orders_product_page_idx ON orders(product_id, __id);
      ANALYZE orders;
      CREATE TABLE text_lookups (__id integer PRIMARY KEY, product_id text);
      INSERT INTO text_lookups VALUES (1, 'Alpha'), (2, 'alpha'), (3, 'ALPHA'),
        (4, 'other'), (5, NULL), (6, 'a.b'), (7, 'axb');
      CREATE TABLE json_lookups (__id integer PRIMARY KEY, product_id jsonb);
      INSERT INTO json_lookups VALUES (1, '[42]'), (2, '42'), (3, '[1, 42]'),
        (4, '[]'), (5, NULL), (6, 'null'), (7, '[43]');
    `);
  });
  afterAll(() => db.close());

  it('selects the matching page through the product index instead of filtering the primary key scan', async () => {
    const compiled = compileLookupFilter({ storage: 'REAL', value: 42 });
    const query = `SELECT t.__id FROM orders t WHERE ${compiled.sql} ORDER BY t.__id LIMIT 5`;
    const result = await db.query(query, [...compiled.parameters]);
    expect(result.rows).toEqual([
      { __id: 42 },
      { __id: 18042 },
      { __id: 36042 },
      { __id: 54042 },
      { __id: 72042 },
    ]);
    const plan = await db.query(`EXPLAIN (FORMAT JSON, ANALYZE, BUFFERS) ${query}`, [
      ...compiled.parameters,
    ]);
    const serialized = JSON.stringify(plan.rows);
    expect(serialized).toContain('orders_product_page_idx');
    expect(serialized).not.toContain('orders_pkey');
  });

  it.each(['is', 'isNot'] as const)(
    'preserves case-insensitive text lookup %s and NULL handling',
    async (operator) => {
      const compiled = compileLookupFilter({ storage: 'TEXT', value: 'alpha', operator });
      const result = await db.query(
        `SELECT t.__id FROM text_lookups t WHERE ${compiled.sql} ORDER BY t.__id`,
        [...compiled.parameters]
      );
      expect(result.rows).toEqual(
        (operator === 'is' ? [1, 2, 3] : [4, 5, 6, 7]).map((__id) => ({ __id }))
      );
    }
  );

  it('keeps JSON lookup membership even when its declared multiplicity is single', async () => {
    const compiled = compileLookupFilter({ storage: 'JSON', value: 42 });
    const result = await db.query(
      `SELECT t.__id FROM json_lookups t WHERE ${compiled.sql} ORDER BY t.__id`,
      [...compiled.parameters]
    );
    expect(result.rows).toEqual([{ __id: 1 }, { __id: 2 }, { __id: 3 }]);
  });

  it('keeps the JSON-safe fallback when persisted storage metadata is unavailable', async () => {
    const compiled = compileLookupFilter({ storage: undefined, value: 42 });
    const result = await db.query(
      `SELECT t.__id FROM json_lookups t WHERE ${compiled.sql} ORDER BY t.__id`,
      [...compiled.parameters]
    );
    expect(result.rows).toEqual([{ __id: 1 }, { __id: 2 }, { __id: 3 }]);
  });
});
