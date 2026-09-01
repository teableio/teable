import {
  DateTimeFormatting,
  FieldId,
  FieldName,
  LookupField,
  LookupOptions,
  NumberFormatting,
  NumberFormattingType,
  TimeFormatting,
  createCheckboxField,
  createDateField,
  createNumberField,
  createSingleLineTextField,
  createUserField,
  type Field,
} from '@teable/v2-core';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { describe, expect, test } from 'vitest';

import type { DynamicDB } from '../ITableRecordQueryBuilder';
import {
  applyStoredFieldOrderByClause,
  buildStoredFieldOrderByClauses,
  type StoredFieldOrderByClause,
} from './storedFieldOrderBy';

const createTestDb = () =>
  new Kysely<DynamicDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const createMultipleLookup = (innerField: Field): LookupField => {
  const lookupOptions = LookupOptions.create({
    linkFieldId: `fld${'l'.repeat(16)}`,
    lookupFieldId: innerField.id().toString(),
    foreignTableId: `tbl${'f'.repeat(16)}`,
  })._unsafeUnwrap();

  return LookupField.create({
    id: FieldId.create(`fld${'u'.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create('Lookup')._unsafeUnwrap(),
    innerField,
    lookupOptions,
    isMultipleCellValue: true,
  })._unsafeUnwrap();
};

const compileOrderBy = (clauses: ReadonlyArray<StoredFieldOrderByClause>): string => {
  const db = createTestDb();
  const query = clauses.reduce(
    (builder, clause) => applyStoredFieldOrderByClause(builder, clause),
    db.selectFrom('records as t').selectAll()
  );
  return query.compile().sql;
};

const orderSqlFor = (innerField: Field): string => {
  const result = buildStoredFieldOrderByClauses(
    createMultipleLookup(innerField),
    'lookup_values',
    'asc',
    't'
  );
  expect(result.isOk()).toBe(true);
  return compileOrderBy(result._unsafeUnwrap());
};

describe('storedFieldOrderBy', () => {
  test.each([
    [
      'string',
      createSingleLineTextField({
        id: FieldId.create(`fld${'s'.repeat(16)}`)._unsafeUnwrap(),
        name: FieldName.create('Text')._unsafeUnwrap(),
      })._unsafeUnwrap(),
    ],
    [
      'boolean',
      createCheckboxField({
        id: FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap(),
        name: FieldName.create('Checked')._unsafeUnwrap(),
      })._unsafeUnwrap(),
    ],
  ] as const)('pushes multiple lookup %s first-value ordering into SQL', (_type, innerField) => {
    const sql = orderSqlFor(innerField);

    expect(sql).toContain(`jsonb_typeof("t"."lookup_values"::jsonb) = 'array'`);
    expect(sql).toContain(`END ->> 0 asc nulls first`);
    expect(sql).not.toContain('is null');
    expect(sql).not.toContain('"t"."lookup_values"::jsonb::text');
  });

  test('pushes formatted multiple lookup number ordering into SQL', () => {
    const formatting = NumberFormatting.create({
      type: NumberFormattingType.Decimal,
      precision: 1,
    })._unsafeUnwrap();
    const innerField = createNumberField({
      id: FieldId.create(`fld${'n'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Amount')._unsafeUnwrap(),
      formatting,
    })._unsafeUnwrap();
    const sql = orderSqlFor(innerField);

    expect(sql).toContain("string_agg(trim(to_char((lookup_element #>> '{}')::numeric");
    expect(sql).toContain("'999999990D0'");
    expect(sql).toContain("', ' ORDER BY lookup_ordinality");
    expect(sql).toContain('WITH ORDINALITY AS lookup_values(lookup_element, lookup_ordinality)');
  });

  test('pushes formatted multiple lookup date ordering into SQL', () => {
    const formatting = DateTimeFormatting.create({
      date: 'M/D/YYYY',
      time: TimeFormatting.None,
      timeZone: 'utc',
    })._unsafeUnwrap();
    const innerField = createDateField({
      id: FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Due')._unsafeUnwrap(),
      formatting,
    })._unsafeUnwrap();
    const sql = orderSqlFor(innerField);

    expect(sql).toContain(
      "string_agg(TO_CHAR((lookup_element #>> '{}')::timestamptz AT TIME ZONE 'UTC', 'FMMM/FMDD/YYYY')"
    );
    expect(sql).toContain("', ' ORDER BY lookup_ordinality");
    expect(sql).toContain('WITH ORDINALITY AS lookup_values(lookup_element, lookup_ordinality)');
  });

  test('collates lookup-of-user group sorts by identity instead of the raw snapshot', () => {
    const innerField = createUserField({
      id: FieldId.create(`fld${'i'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Owner')._unsafeUnwrap(),
    })._unsafeUnwrap();
    const lookupField = LookupField.create({
      id: FieldId.create(`fld${'u'.repeat(16)}`)._unsafeUnwrap(),
      name: FieldName.create('Lookup Owner')._unsafeUnwrap(),
      innerField,
      lookupOptions: LookupOptions.create({
        linkFieldId: `fld${'l'.repeat(16)}`,
        lookupFieldId: innerField.id().toString(),
        foreignTableId: `tbl${'f'.repeat(16)}`,
      })._unsafeUnwrap(),
      isMultipleCellValue: false,
    })._unsafeUnwrap();

    const result = buildStoredFieldOrderByClauses(lookupField, 'lookup_owner', 'asc', 't', {
      groupIdentityCollation: true,
    });
    expect(result.isOk()).toBe(true);
    const sql = compileOrderBy(result._unsafeUnwrap());

    expect(sql).toContain(`CASE jsonb_typeof("t"."lookup_owner"::jsonb)`);
    expect(sql).toContain(`->> 'title' asc nulls first`);
    expect(sql).not.toContain('is null');
    expect(sql).not.toContain('"t"."lookup_owner"::jsonb is null');
  });
});
