/* eslint-disable @typescript-eslint/naming-convention */
/**
 * Regression guard for GHSA-7r23-c67v-m5c5 and GHSA-p7h6-58r8-v27m:
 * SQL injection via record filter value on JSON-backed fields.
 *
 * The `is` / `isNot` / `contains` / `doesNotContain` handlers of
 * MultipleStringCellValueFilterAdapter, and the `contains` / `doesNotContain`
 * handlers of the (Multiple)JsonCellValueFilterAdapter used by Link fields and
 * multi-value lookups, previously interpolated the raw filter value into
 * whereRaw(), so a single quote closed the SQL string literal and injected
 * arbitrary SQL. The fix binds the jsonpath as a parameter and escapes the
 * value for the jsonpath string literal.
 *
 * These tests prove the value is now a bound parameter (not inlined SQL) and
 * that the rendered SQL cannot be broken out of by the injection payload.
 */
import {
  CellValueType,
  DbFieldType,
  DriverClient,
  FieldType,
  LinkFieldCore,
  MultipleSelectFieldCore,
  Relationship,
  SelectFieldCore,
  SingleLineTextFieldCore,
  contains,
  doesNotContain,
  hasAnyOf,
  is,
  isNot,
} from '@teable/core';
import type { FieldCore, IFilter, ILinkFieldOptions } from '@teable/core';
import knex from 'knex';
import { escapeJsonPathRegexLiteral } from '../../../utils/postgres-regex-escape';
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

// Link fields are always JSON columns; a many-one link is single-valued and
// routes to JsonCellValueFilterAdapter, a many-many link to the Multiple one.
function createLinkField(isMultipleCellValue: boolean): LinkFieldCore {
  const field = new LinkFieldCore();
  field.id = isMultipleCellValue ? 'fld_link_multi' : 'fld_link_single';
  field.name = field.id;
  field.dbFieldName = `${field.id}_col`;
  field.type = FieldType.Link;
  field.options = {
    relationship: isMultipleCellValue ? Relationship.ManyMany : Relationship.ManyOne,
    foreignTableId: 'tbl_foreign',
    lookupFieldId: 'fld_foreign_primary',
    fkHostTableName: 'junction_table',
    selfKeyName: '__id',
    foreignKeyName: '__fk_link',
  } as ILinkFieldOptions;
  field.cellValueType = CellValueType.String;
  field.isMultipleCellValue = isMultipleCellValue;
  field.isLookup = false;
  field.dbFieldType = DbFieldType.Json;
  return field;
}

// A text field looked up through a many-many link: multi-valued and stored as
// JSON, so it routes to MultipleJsonCellValueFilterAdapter with `$[*]`.
function createTextLookupViaLinkField(): SingleLineTextFieldCore {
  const field = new SingleLineTextFieldCore();
  field.id = 'fld_lookup_text';
  field.name = 'fld_lookup_text';
  field.dbFieldName = 'lookup_text_col';
  field.type = FieldType.SingleLineText;
  field.options = SingleLineTextFieldCore.defaultOptions();
  field.cellValueType = CellValueType.String;
  field.isMultipleCellValue = true;
  field.isLookup = true;
  field.dbFieldType = DbFieldType.Json;
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

  it('multi-select fields bind `hasAnyOf` values through the json adapter', () => {
    const ms = createMultiSelectField();
    expect(ms.dbFieldType).toBe(DbFieldType.Json);
    // `contains` is not a valid MultipleSelect operator (parseFilter drops it),
    // so exercise an operator that actually reaches the adapter.
    const { sql, bindings } = build(ms, {
      conjunction: 'and',
      filterSet: [{ fieldId: ms.id, operator: hasAnyOf.value, value: [INJECTION] }],
    });
    expect(sql).not.toContain('OR 1=1');
    expect(sql).toContain('jsonb_exists_any');
    expect(bindings).toContainEqual([INJECTION]);
  });
});

describe('GHSA-p7h6: JSON contains/doesNotContain filters are no longer injectable', () => {
  const CASES = [
    { name: 'single-value link', field: createLinkField(false), selector: '$.title' },
    { name: 'multi-value link', field: createLinkField(true), selector: '$[*].title' },
    { name: 'text lookup via link', field: createTextLookupViaLinkField(), selector: '$[*]' },
  ];
  const OPERATORS = [
    { name: 'contains', op: contains.value },
    { name: 'doesNotContain', op: doesNotContain.value },
  ];

  describe.each(CASES)('$name', ({ field, selector }) => {
    it.each(OPERATORS)('binds the value for `$name` instead of inlining it', ({ op }) => {
      const { sql, bindings } = build(field, {
        conjunction: 'and',
        filterSet: [{ fieldId: field.id, operator: op, value: INJECTION }],
      });

      // Neither the payload nor its quotes reach the SQL text; the jsonpath is
      // passed as a single bound parameter.
      expect(sql).not.toContain('OR 1=1');
      expect(sql).not.toContain(INJECTION);
      expect(sql).not.toContain('like_regex');
      expect(sql).toContain('?');

      const jsonPathBinding = bindings.find(
        (b): b is string => typeof b === 'string' && b.includes('like_regex')
      );
      // The payload's double quote and regex metacharacters are escaped for
      // the jsonpath string literal, so it cannot terminate the pattern either;
      // the single quote stays as plain data inside the binding.
      expect(jsonPathBinding).toBe(
        `${selector} ? (@ like_regex "${escapeJsonPathRegexLiteral(INJECTION)}" flag "i")`
      );
      expect(jsonPathBinding).toContain("' OR 1=1 --");
    });
  });
});
