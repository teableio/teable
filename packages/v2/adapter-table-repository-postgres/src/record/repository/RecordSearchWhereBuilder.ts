import {
  CellValueType,
  type ConditionalLookupField,
  type ConditionalRollupField,
  type CreatedTimeField,
  DateTimeFormatting,
  type DateField,
  type DomainError,
  type Field,
  FieldType,
  FieldValueTypeVisitor,
  type FormulaField,
  type LastModifiedTimeField,
  type LookupField,
  type NumberField,
  type NumberFormatting,
  type RecordQuerySearch,
  type RollupField,
  type Table,
} from '@teable/v2-core';
import { sql, type Expression, type SqlBool } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { getDateSearchRange } from './dateSearchRange';

const fieldValueTypeVisitor = new FieldValueTypeVisitor();
const escapeLikeWildcards = (input: string): string => {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
};

const escapePostgresRegex = (input: string): string => {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const normalizeToJsonArray = (columnRef: Expression<unknown>) => sql`CASE
  WHEN jsonb_typeof(to_jsonb(${columnRef})) = 'array' THEN to_jsonb(${columnRef})
  WHEN to_jsonb(${columnRef}) IS NULL THEN '[]'::jsonb
  ELSE jsonb_build_array(to_jsonb(${columnRef}))
END`;

const buildLongTextExpression = (columnRef: Expression<unknown>) => sql<string>`REPLACE(
  REPLACE(REPLACE(${columnRef}, CHR(13), ' '::text), CHR(10), ' '::text),
  CHR(9),
  ' '::text
)`;

const buildStructuredSingleCondition = (columnRef: Expression<unknown>, searchValue: string) => {
  return sql<SqlBool>`((${columnRef})::jsonb #>> '{title}') ILIKE ${`%${escapeLikeWildcards(searchValue)}%`} ESCAPE '\\'`;
};

const buildPlainMultipleCondition = (columnRef: Expression<unknown>, searchValue: string) => {
  const arrayExpr = normalizeToJsonArray(columnRef);
  return sql<SqlBool>`
    EXISTS (
      SELECT 1
      FROM (
        SELECT string_agg(elem.value, ', ') AS aggregated
        FROM jsonb_array_elements_text(${arrayExpr}) AS elem(value)
      ) AS sub
      WHERE sub.aggregated ~* ${escapePostgresRegex(searchValue)}
    )
  `;
};

const buildStructuredMultipleCondition = (columnRef: Expression<unknown>, searchValue: string) => {
  const arrayExpr = normalizeToJsonArray(columnRef);
  return sql<SqlBool>`
    EXISTS (
      WITH RECURSIVE f(e) AS (
        SELECT ${arrayExpr}
        UNION ALL
        SELECT jsonb_array_elements(f.e)
        FROM f
        WHERE jsonb_typeof(f.e) = 'array'
      )
      SELECT 1
      FROM (
        SELECT string_agg((e ->> 'title')::text, ', ') AS aggregated
        FROM f
        WHERE jsonb_typeof(e) <> 'array'
      ) AS sub
      WHERE sub.aggregated ~* ${escapePostgresRegex(searchValue)}
    )
  `;
};

const buildNumberMultipleCondition = (
  columnRef: Expression<unknown>,
  searchValue: string,
  precision: number
) => {
  const arrayExpr = normalizeToJsonArray(columnRef);
  return sql<SqlBool>`
    EXISTS (
      SELECT 1
      FROM (
        SELECT string_agg(ROUND((elem.value)::numeric, ${precision})::text, ', ') AS aggregated
        FROM jsonb_array_elements_text(${arrayExpr}) AS elem(value)
      ) AS sub
      WHERE sub.aggregated ILIKE ${`%${escapeLikeWildcards(searchValue)}%`} ESCAPE '\\'
    )
  `;
};

const buildDateMultipleCondition = (
  columnRef: Expression<unknown>,
  searchValue: string,
  formatting?: DateTimeFormatting
) => {
  const range = getDateSearchRange(searchValue, formatting);
  if (!range) {
    return sql<SqlBool>`false`;
  }

  const arrayExpr = normalizeToJsonArray(columnRef);
  return sql<SqlBool>`
    EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(${arrayExpr}) AS elem(value)
      WHERE CAST(elem.value AS timestamp with time zone) >= ${range.start}
        AND CAST(elem.value AS timestamp with time zone) < ${range.end}
    )
  `;
};

const resolveSearchShapeSourceField = (field: Field): Field => {
  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    const innerField = field.type().equals(FieldType.lookup())
      ? (field as LookupField).innerField()
      : (field as ConditionalLookupField).innerField();
    if (innerField.isOk()) {
      return resolveSearchShapeSourceField(innerField.value);
    }
  }

  return field;
};

const isStructuredStringField = (field: Field): boolean => {
  const sourceField = resolveSearchShapeSourceField(field);
  return (
    sourceField.type().equals(FieldType.user()) ||
    sourceField.type().equals(FieldType.createdBy()) ||
    sourceField.type().equals(FieldType.lastModifiedBy()) ||
    sourceField.type().equals(FieldType.link()) ||
    sourceField.type().equals(FieldType.attachment())
  );
};

const isLongTextField = (field: Field): boolean => {
  return resolveSearchShapeSourceField(field).type().equals(FieldType.longText());
};

const resolveNumberFormatting = (field: Field): NumberFormatting | undefined => {
  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    const innerField = field.type().equals(FieldType.lookup())
      ? (field as LookupField).innerField()
      : (field as ConditionalLookupField).innerField();
    return innerField.isOk() ? resolveNumberFormatting(innerField.value) : undefined;
  }

  if (field.type().equals(FieldType.number())) {
    return (field as NumberField).formatting();
  }

  if (
    field.type().equals(FieldType.formula()) ||
    field.type().equals(FieldType.rollup()) ||
    field.type().equals(FieldType.conditionalRollup())
  ) {
    const formatting = field.type().equals(FieldType.formula())
      ? (field as FormulaField).formatting()
      : field.type().equals(FieldType.rollup())
        ? (field as RollupField).formatting()
        : (field as ConditionalRollupField).formatting();

    return formatting instanceof DateTimeFormatting ? undefined : formatting;
  }

  return undefined;
};

const resolveDateTimeFormatting = (field: Field): DateTimeFormatting | undefined => {
  if (
    field.type().equals(FieldType.lookup()) ||
    field.type().equals(FieldType.conditionalLookup())
  ) {
    const innerField = field.type().equals(FieldType.lookup())
      ? (field as LookupField).innerField()
      : (field as ConditionalLookupField).innerField();
    return innerField.isOk() ? resolveDateTimeFormatting(innerField.value) : undefined;
  }

  if (field.type().equals(FieldType.date())) {
    return (field as DateField).formatting();
  }

  if (field.type().equals(FieldType.createdTime())) {
    return (field as CreatedTimeField).formatting();
  }

  if (field.type().equals(FieldType.lastModifiedTime())) {
    return (field as LastModifiedTimeField).formatting();
  }

  if (
    field.type().equals(FieldType.formula()) ||
    field.type().equals(FieldType.rollup()) ||
    field.type().equals(FieldType.conditionalRollup())
  ) {
    const formatting = field.type().equals(FieldType.formula())
      ? (field as FormulaField).formatting()
      : field.type().equals(FieldType.rollup())
        ? (field as RollupField).formatting()
        : (field as ConditionalRollupField).formatting();

    return formatting instanceof DateTimeFormatting ? formatting : undefined;
  }

  return undefined;
};

const resolveNumberPrecision = (field: Field): number => {
  return resolveNumberFormatting(field)?.precision().toNumber() ?? 0;
};

const resolveColumnRef = (
  field: Field,
  tableAlias: string
): Result<Expression<unknown>, DomainError> => {
  return field
    .dbFieldName()
    .andThen((dbFieldName) => dbFieldName.value())
    .map((dbFieldName) => sql.ref(`${tableAlias}.${dbFieldName}`) as Expression<unknown>);
};

const buildFieldSearchCondition = (
  field: Field,
  search: RecordQuerySearch['search'],
  tableAlias: string
): Result<Expression<SqlBool> | undefined, DomainError> => {
  return safeTry(function* () {
    if (field.type().equals(FieldType.button())) {
      return ok(undefined);
    }

    const columnRef = yield* resolveColumnRef(field, tableAlias);
    const fieldValueType = yield* field.accept(fieldValueTypeVisitor);
    const cellValueType = fieldValueType.cellValueType;
    const isMultiple = fieldValueType.isMultipleCellValue.isMultiple();

    if (cellValueType.equals(CellValueType.boolean()) && search.searchesAllFields()) {
      return ok(undefined);
    }

    if (isStructuredStringField(field)) {
      return ok(
        isMultiple
          ? buildStructuredMultipleCondition(columnRef, search.value)
          : buildStructuredSingleCondition(columnRef, search.value)
      );
    }

    if (cellValueType.equals(CellValueType.number())) {
      const precision = resolveNumberPrecision(field);
      return ok(
        isMultiple
          ? buildNumberMultipleCondition(columnRef, search.value, precision)
          : sql<SqlBool>`ROUND(${columnRef}::numeric, ${precision})::text ILIKE ${`%${escapeLikeWildcards(search.value)}%`} ESCAPE '\\'`
      );
    }

    if (cellValueType.equals(CellValueType.dateTime())) {
      const formatting = resolveDateTimeFormatting(field);
      const range = getDateSearchRange(search.value, formatting);
      if (!range) {
        return ok(sql<SqlBool>`false`);
      }

      return ok(
        isMultiple
          ? buildDateMultipleCondition(columnRef, search.value, formatting)
          : sql<SqlBool>`${columnRef} >= ${range.start} AND ${columnRef} < ${range.end}`
      );
    }

    if (cellValueType.equals(CellValueType.boolean())) {
      return ok(undefined);
    }

    if (isMultiple) {
      return ok(buildPlainMultipleCondition(columnRef, search.value));
    }

    if (isLongTextField(field)) {
      return ok(
        sql<SqlBool>`${buildLongTextExpression(columnRef)} ILIKE ${`%${escapeLikeWildcards(search.value)}%`} ESCAPE '\\'`
      );
    }

    return ok(
      sql<SqlBool>`${columnRef} ILIKE ${`%${escapeLikeWildcards(search.value)}%`} ESCAPE '\\'`
    );
  });
};

export const buildRecordSearchWhereClause = (
  table: Table,
  recordSearch: RecordQuerySearch | undefined,
  options?: { tableAlias?: string }
): Result<Expression<SqlBool> | null, DomainError> => {
  if (!recordSearch) {
    return ok(null);
  }

  return safeTry<Expression<SqlBool> | null, DomainError>(function* () {
    const tableAlias = options?.tableAlias ?? 't';
    const resolvedFields = yield* recordSearch.search.resolveFields(table, {
      visibleFieldIds: recordSearch.visibleFieldIds,
    });

    const searchConditions: Expression<SqlBool>[] = [];
    for (const field of resolvedFields) {
      const condition = yield* buildFieldSearchCondition(field, recordSearch.search, tableAlias);
      if (condition) {
        searchConditions.push(condition);
      }
    }

    if (!searchConditions.length) {
      return ok(resolvedFields.length ? null : sql<SqlBool>`false`);
    }

    const [firstCondition, ...restConditions] = searchConditions;
    if (!firstCondition) {
      return ok(sql<SqlBool>`false`);
    }

    const combinedCondition = restConditions.reduce<Expression<SqlBool>>(
      (acc, condition) => sql<SqlBool>`(${acc}) OR (${condition})`,
      firstCondition
    );

    return ok(combinedCondition);
  });
};
