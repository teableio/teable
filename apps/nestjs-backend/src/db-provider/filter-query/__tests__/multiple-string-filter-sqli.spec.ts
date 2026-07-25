/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Regression guard for GHSA-7r23-c67v-m5c5:
 * SQL injection via record filter value on multi-value string fields.
 *
 * The `is` / `isNot` / `contains` / `doesNotContain` handlers of
 * MultipleStringCellValueFilterAdapter previously interpolated the raw filter
 * value into whereRaw(), so a single quote closed the SQL string literal and
 * injected arbitrary SQL. The fix binds the jsonpath as a parameter and escapes
 * the value for the jsonpath string literal.
 *
 * This test proves the value is now a bound parameter (not inlined SQL) and
 * that the rendered SQL cannot be broken out of by the injection payload.
 */
import {
  CellValueType,
  DbFieldType,
  DriverClient,
  FieldType,
  MultipleSelectFieldCore,
  SelectFieldCore,
  SingleLineTextFieldCore,
  contains,
  doesNotContain,
  is,
  isNot,
} from '@teable/core';
import type { FieldCore, IFilter } from '@teable/core';
import knex from 'knex';
import type { IDbProvider } from '../../db.provider.interface';
import { FilterQueryPostgres } from '../postgres/filter-query.postgres';

const knexBuilder = knex({ client: 'pg' });
const dbProviderStub = { driver: DriverClient.Pg } as unknown as IDbProvider;

// Payload that used to close the jsonpath literal, then the SQL literal, then
// inject a tautology and comment out the trailing syntax.
const INJECTION = 'zzz") \' OR 1=1 --';

function build(field: FieldCore, filter: IFilter) {
  const qb = knexBuilder('main_table as main');
  new FilterQueryPostgres(qb, { [field.id]: field }, filter, undefined, dbProviderStub, {
    selectionMap: new Map([[field.id, `"main"."${field.dbFieldName}"`]]),
  }).appendQueryBuilder();
  // toSQL() keeps parameters as bindings instead of inlining them.
  return qb.toSQL();
}

// A multi-value String field whose dbFieldType is Text — the shape that routes
// to MultipleStringCellValueFilterAdapter.
function createMultiTextField(): SingleLineTextFieldCore {
  const field = new SingleLineTextFieldCore();
  field.id = 'fld_multitext';
  field.name = 'fld_multitext';
  field.dbFieldName = 'multitext_col';
  field.type = FieldType.SingleLineText;
  field.options = SingleLineTextFieldCore.defaultOptions();
  field.cellValueType = CellValueType.String;
  field.isMultipleCellValue = true;
  field.isLookup = true;
  field.dbFieldType = DbFieldType.Text;
  return field;
}

function createMultiSelectField(): MultipleSelectFieldCore {
  const field = new MultipleSelectFieldCore();
  field.id = 'fld_ms';
  field.name = 'fld_ms';
  field.dbFieldName = 'ms_col';
  field.type = FieldType.MultipleSelect;
  field.options = SelectFieldCore.defaultOptions() as never;
  field.cellValueType = CellValueType.String;
  field.isMultipleCellValue = true;
  field.isLookup = false;
  field.updateDbFieldType();
  return field;
}

describe('GHSA-7r23: multi-value string filter is no longer injectable', () => {
  const field = createMultiTextField();

  const OPERATORS = [
    { name: 'is', op: is.value },
    { name: 'isNot', op: isNot.value },
    { name: 'contains', op: contains.value },
    { name: 'doesNotContain', op: doesNotContain.value },
  ];

  it.each(OPERATORS)('binds the value for `$name` instead of inlining it', ({ op }) => {
    const { sql, bindings } = build(field, {
      conjunction: 'and',
      filterSet: [{ fieldId: field.id, operator: op, value: INJECTION }],
    });

    // The value is passed as a bound parameter — the raw payload never appears
    // in the SQL text, so it cannot break out of the statement.
    expect(sql).not.toContain('OR 1=1');
    // Rendered as a jsonpath containment predicate with a bound placeholder.
    expect(sql).toContain('::jsonb @');
    expect(sql.endsWith('?)')).toBe(true);

    // The payload lives inside a jsonpath binding, quoted as a string literal.
    const jsonPathBinding = bindings.find(
      (b): b is string => typeof b === 'string' && b.includes('$[*]')
    );
    expect(jsonPathBinding).toBeDefined();
    expect(jsonPathBinding).toContain('OR 1=1'); // present, but as data in the binding
  });

  it('multi-select fields still route to the safe json adapter', () => {
    const ms = createMultiSelectField();
    expect(ms.dbFieldType).toBe(DbFieldType.Json);
    const { sql } = build(ms, {
      conjunction: 'and',
      filterSet: [{ fieldId: ms.id, operator: contains.value, value: INJECTION }],
    });
    expect(sql).not.toContain('OR 1=1');
  });
});
