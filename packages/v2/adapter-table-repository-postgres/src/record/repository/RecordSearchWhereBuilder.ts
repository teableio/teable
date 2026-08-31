import {
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
  isSearchFieldTextProjection,
  type LastModifiedTimeField,
  type LookupField,
  type RecordQuerySearch,
  type IRecordSearchAccessPath,
  resolveSearchFieldTextShape,
  type RollupField,
  type SearchFieldTextProjection,
  type SearchFieldTextShape,
  type Table,
} from '@teable/v2-core';
import { sql, type Expression, type SqlBool } from 'kysely';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { FieldMaskSqlMap } from '../query-builder/ITableRecordQueryBuilder';
import { buildStoredFieldValueExpression } from '../query-builder/stored/storedFieldValueExpression';
import { getDateSearchRange } from './dateSearchRange';

const fieldValueTypeVisitor = new FieldValueTypeVisitor();
const escapeLikeWildcards = (input: string): string => {
  return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
};

const isPostgresIdentifier = (input: string): boolean => {
  return /^[a-z_]\w*$/i.test(input);
};

type RecordSearchWhereBuilderOptions = {
  readonly tableAlias?: string;
  readonly searchAccessPath?: IRecordSearchAccessPath;
  readonly fieldMaskSqlMap?: FieldMaskSqlMap;
};

const applyFieldMask = (
  field: Field,
  condition: Expression<SqlBool>,
  fieldMaskSqlMap: FieldMaskSqlMap | undefined
): Expression<SqlBool> => {
  const maskSql = fieldMaskSqlMap?.get(field.id().toString());
  return maskSql ? sql<SqlBool>`(${maskSql}) AND (${condition})` : condition;
};

// Multi-value cells are physically jsonb; a direct cast plus text-level array
// wrapping keeps this expression identical to the generated document DDL,
// which must stay immutable — to_jsonb() and jsonb_build_array() are only
// STABLE and are rejected by generated columns.
const normalizeToJsonArray = (columnRef: Expression<unknown>) => sql`CASE
  WHEN jsonb_typeof((${columnRef})::jsonb) = 'array' THEN (${columnRef})::jsonb
  WHEN (${columnRef})::jsonb IS NULL THEN '[]'::jsonb
  ELSE ('[' || ((${columnRef})::jsonb)::text || ']')::jsonb
END`;

const buildMultilineExpression = (columnRef: Expression<unknown>) => sql<string>`REPLACE(
  REPLACE(REPLACE((${columnRef})::text, CHR(13), ' '::text), CHR(10), ' '::text),
  CHR(9),
  ' '::text
)`;

// jsonb renders arrays as `["a", "b"]`; strip the brackets, collapse the
// `", "` element separators, and trim the outer quotes so the projected text
// matches the `a, b` string users see in a cell. Titles containing quotes or
// backslashes keep their jsonb escaping — the same projection runs in the
// default predicate, the generated document, and the scoped rechecks, so all
// paths agree on the (slightly escaped) text they match against.
const buildJoinedJsonArrayText = (arrayExpr: Expression<unknown>) =>
  sql<string>`btrim(replace(btrim((${arrayExpr})::text, '[]'), '", "', ', '), '"')`;

const buildStructuredTitleListText = (columnRef: Expression<unknown>) =>
  buildJoinedJsonArrayText(
    sql`jsonb_path_query_array(${normalizeToJsonArray(columnRef)}, ${sql.raw(`'$[*].**."title"'`)})`
  );

const buildSearchProjectionText = (
  columnRef: Expression<unknown>,
  projection: SearchFieldTextProjection
): Expression<string> => {
  switch (projection.kind) {
    case 'plain':
      return sql<string>`(${columnRef})::text`;
    case 'multiline':
      return buildMultilineExpression(columnRef);
    case 'structured_title':
      return sql<string>`((${columnRef})::jsonb #>> '{title}')`;
    case 'structured_title_list':
      return buildStructuredTitleListText(columnRef);
    case 'plain_list':
      return buildJoinedJsonArrayText(normalizeToJsonArray(columnRef));
    case 'rounded_number':
      return sql<string>`ROUND((${columnRef})::numeric, ${projection.precision})::text`;
  }
};

const buildProjectionContainsCondition = (
  columnRef: Expression<unknown>,
  projection: SearchFieldTextProjection,
  searchValue: string
) =>
  sql<SqlBool>`${buildSearchProjectionText(columnRef, projection)} ILIKE ${`%${escapeLikeWildcards(searchValue)}%`} ESCAPE '\\'`;

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

const resolveColumnRef = (
  field: Field,
  tableAlias: string
): Result<Expression<unknown>, DomainError> => {
  return field
    .dbFieldName()
    .andThen((dbFieldName) => dbFieldName.value())
    .andThen((dbFieldName) => buildStoredFieldValueExpression(field, tableAlias, dbFieldName))
    .map(({ expression }) => expression as Expression<unknown>);
};

/**
 * Whether a field produces a search predicate for this search. Date fields are
 * excluded from all-field searches (matching hide-not-match semantics); they
 * remain searchable when addressed explicitly by field key.
 */
const shapeProducesCondition = (
  shape: SearchFieldTextShape,
  search: RecordQuerySearch['search']
): boolean => {
  if (shape.kind === 'none') return false;
  if (shape.kind === 'date_range' && search.searchesAllFields()) return false;
  return true;
};

const buildFieldSearchCondition = (
  field: Field,
  search: RecordQuerySearch['search'],
  tableAlias: string
): Result<Expression<SqlBool> | undefined, DomainError> => {
  return safeTry(function* () {
    const shape = yield* resolveSearchFieldTextShape(field);
    if (!shapeProducesCondition(shape, search)) {
      return ok(undefined);
    }

    const columnRef = yield* resolveColumnRef(field, tableAlias);

    if (shape.kind === 'date_range') {
      const fieldValueType = yield* field.accept(fieldValueTypeVisitor);
      const isMultiple = fieldValueType.isMultipleCellValue.isMultiple();
      const formatting = resolveDateTimeFormatting(field);
      const range = getDateSearchRange(search.value, formatting);
      if (!range) {
        return ok(sql<SqlBool>`false`);
      }

      return ok(
        isMultiple
          ? buildDateMultipleCondition(columnRef, search.value, formatting)
          : sql<SqlBool>`(${columnRef} >= ${range.start} AND ${columnRef} < ${range.end})`
      );
    }

    if (shape.kind === 'rounded_number_list') {
      return ok(buildNumberMultipleCondition(columnRef, search.value, shape.precision));
    }

    if (isSearchFieldTextProjection(shape)) {
      return ok(buildProjectionContainsCondition(columnRef, shape, search.value));
    }

    return ok(undefined);
  });
};

export type RecordSearchFieldMatch = {
  readonly field: Field;
  readonly condition: Expression<SqlBool>;
};

export const buildRecordSearchFieldMatches = (
  table: Table,
  recordSearch: RecordQuerySearch | undefined,
  options?: Pick<RecordSearchWhereBuilderOptions, 'tableAlias' | 'fieldMaskSqlMap'>
): Result<ReadonlyArray<RecordSearchFieldMatch>, DomainError> => {
  if (!recordSearch) return ok([]);

  return safeTry(function* () {
    const tableAlias = options?.tableAlias ?? 't';
    const fields = yield* recordSearch.search.resolveFields(table, {
      visibleFieldIds: recordSearch.visibleFieldIds,
    });
    const matches: RecordSearchFieldMatch[] = [];
    for (const field of fields) {
      const condition = yield* buildFieldSearchCondition(field, recordSearch.search, tableAlias);
      if (condition) {
        matches.push({
          field,
          condition: applyFieldMask(field, condition, options?.fieldMaskSqlMap),
        });
      }
    }
    return ok(matches);
  });
};

const buildSearchVectorDocumentPart = (
  field: Field,
  tableAlias: string
): Result<Expression<string>, DomainError> =>
  safeTry(function* () {
    const shape = yield* resolveSearchFieldTextShape(field);
    const columnRef = yield* resolveColumnRef(field, tableAlias);

    if (isSearchFieldTextProjection(shape)) {
      return ok(sql<string>`coalesce(${buildSearchProjectionText(columnRef, shape)}, '')`);
    }

    return ok(sql<string>`coalesce((${columnRef})::text, '')`);
  });
const buildGeneratedTsvectorSearchCondition = (
  resolvedFields: ReadonlyArray<Field>,
  recordSearch: RecordQuerySearch,
  accessPath: IRecordSearchAccessPath | undefined,
  tableAlias: string,
  fieldMaskSqlMap: FieldMaskSqlMap | undefined
): Result<Expression<SqlBool> | undefined, DomainError> => {
  if (accessPath?.kind !== 'generated_tsvector') {
    return ok(undefined);
  }

  if (
    !isPostgresIdentifier(accessPath.generatedColumnName) ||
    !isPostgresIdentifier(accessPath.languageConfig)
  ) {
    return ok(undefined);
  }

  const resolvedFieldIds = new Set(resolvedFields.map((field) => field.id().toString()));
  const coveredFieldIds = new Set(accessPath.coveredFieldIds.map((fieldId) => fieldId.toString()));
  const hasMaskedFields = resolvedFields.some((field) =>
    fieldMaskSqlMap?.has(field.id().toString())
  );
  if (
    coveredFieldIds.size === 0 ||
    !resolvedFields.some((field) => coveredFieldIds.has(field.id().toString()))
  ) {
    return ok(undefined);
  }

  const query = sql`websearch_to_tsquery(${accessPath.languageConfig}::regconfig, ${recordSearch.search.value})`;
  const globalCondition = sql<SqlBool>`${sql.ref(
    `${tableAlias}.${accessPath.generatedColumnName}`
  )} @@ ${query}`;

  if (recordSearch.search.searchesAllFields()) {
    if (
      accessPath.searchScope !== 'all_fields' ||
      coveredFieldIds.size !== resolvedFieldIds.size ||
      [...coveredFieldIds].some((fieldId) => !resolvedFieldIds.has(fieldId))
    ) {
      return ok(undefined);
    }
    // Without masks the generated document is the exact lexical oracle. When
    // masks exist it is only a prefilter; the scoped document below replaces
    // hidden cells with empty text before to_tsvector evaluation.
    if (!hasMaskedFields) {
      return ok(globalCondition);
    }
  }

  if (resolvedFields.some((field) => !coveredFieldIds.has(field.id().toString()))) {
    return ok(undefined);
  }

  return safeTry(function* () {
    const scopedDocumentParts: Expression<string>[] = [];
    for (const field of resolvedFields) {
      const documentPart = yield* buildSearchVectorDocumentPart(field, tableAlias);
      const maskSql = fieldMaskSqlMap?.get(field.id().toString());
      scopedDocumentParts.push(
        maskSql ? sql<string>`CASE WHEN ${maskSql} THEN ${documentPart} ELSE '' END` : documentPart
      );
    }

    const [firstPart, ...restParts] = scopedDocumentParts;
    if (!firstPart) return ok(undefined);
    const scopedDocument = restParts.reduce<Expression<string>>(
      (document, part) => sql<string>`${document} || ' ' || ${part}`,
      firstPart
    );
    const scopedCondition = sql<SqlBool>`to_tsvector(${accessPath.languageConfig}::regconfig, ${scopedDocument}) @@ ${query}`;

    return ok(sql<SqlBool>`(${globalCondition}) AND (${scopedCondition})`);
  });
};

const buildDefaultSearchCondition = (
  resolvedFields: ReadonlyArray<Field>,
  recordSearch: RecordQuerySearch,
  tableAlias: string,
  fieldMaskSqlMap: FieldMaskSqlMap | undefined
): Result<Expression<SqlBool> | null, DomainError> =>
  safeTry(function* () {
    const searchConditions: Expression<SqlBool>[] = [];
    for (const field of resolvedFields) {
      const condition = yield* buildFieldSearchCondition(field, recordSearch.search, tableAlias);
      if (condition) {
        searchConditions.push(applyFieldMask(field, condition, fieldMaskSqlMap));
      }
    }

    const [firstCondition, ...restConditions] = searchConditions;
    if (!firstCondition) return ok(resolvedFields.length ? null : sql<SqlBool>`false`);

    const combined = restConditions.reduce<Expression<SqlBool>>(
      (acc, condition) => sql<SqlBool>`(${acc}) OR (${condition})`,
      firstCondition
    );
    // Wrap the whole OR so a later `.where(filter).where(search)` cannot become
    // `filter AND text ILIKE OR date-range` and let the date arm bypass the filter.
    return ok(sql<SqlBool>`(${combined})`);
  });

const buildGeneratedTextSearchCondition = (
  resolvedFields: ReadonlyArray<Field>,
  recordSearch: RecordQuerySearch,
  accessPath: IRecordSearchAccessPath | undefined,
  tableAlias: string,
  fieldMaskSqlMap: FieldMaskSqlMap | undefined
): Result<Expression<SqlBool> | undefined, DomainError> => {
  if (accessPath?.kind !== 'generated_text') return ok(undefined);
  if (!isPostgresIdentifier(accessPath.generatedColumnName)) return ok(undefined);

  const probeLength = Array.from(recordSearch.search.value).length;
  if (accessPath.provider === 'pg_trgm' && probeLength < 3) return ok(undefined);
  if (accessPath.provider === 'pg_bigm' && probeLength < 2) return ok(undefined);

  const coveredFieldIds = new Set(accessPath.coveredFieldIds.map((fieldId) => fieldId.toString()));
  if (!coveredFieldIds.size) return ok(undefined);

  return safeTry(function* () {
    // The prefilter is sound as long as every field that contributes a
    // predicate has its projected text inside the generated document. Fields
    // that never produce a predicate for this search (checkbox/button, dates
    // in an all-field search) cannot cause a miss, so they neither need
    // coverage nor block the indexed path.
    const conditionFields: Field[] = [];
    for (const field of resolvedFields) {
      const shape = yield* resolveSearchFieldTextShape(field);
      if (!shapeProducesCondition(shape, recordSearch.search)) continue;
      // Shapes without a document projection (scoped date search, multi-value
      // numbers) cannot be prefiltered by the document; fall back entirely.
      if (!isSearchFieldTextProjection(shape)) {
        return ok(undefined);
      }
      conditionFields.push(field);
    }

    if (!conditionFields.length) return ok(undefined);
    if (conditionFields.some((field) => !coveredFieldIds.has(field.id().toString()))) {
      return ok(undefined);
    }

    const exactCondition = yield* buildDefaultSearchCondition(
      resolvedFields,
      recordSearch,
      tableAlias,
      fieldMaskSqlMap
    );
    if (!exactCondition) return ok(undefined);

    const pattern = `%${escapeLikeWildcards(recordSearch.search.value)}%`;
    const documentRef = sql.ref(`${tableAlias}.${accessPath.generatedColumnName}`);
    // pg_bigm indexes LIKE only. Keeping both providers on a normalized document gives the
    // runtime one predicate shape; the original field predicate below remains the result oracle.
    const indexedPrefilter = sql<SqlBool>`${documentRef} LIKE lower(${pattern}) ESCAPE '\\'`;
    return ok(sql<SqlBool>`(${indexedPrefilter}) AND (${exactCondition})`);
  });
};

export type RecordSearchWherePlan = {
  readonly condition: Expression<SqlBool> | null;
  readonly usedAccessPath: 'default' | 'generated_text' | 'generated_tsvector';
};

export const buildRecordSearchWherePlan = (
  table: Table,
  recordSearch: RecordQuerySearch | undefined,
  options?: RecordSearchWhereBuilderOptions
): Result<RecordSearchWherePlan, DomainError> => {
  if (!recordSearch) {
    return ok({ condition: null, usedAccessPath: 'default' });
  }

  return safeTry<RecordSearchWherePlan, DomainError>(function* () {
    const tableAlias = options?.tableAlias ?? 't';
    const resolvedFields = yield* recordSearch.search.resolveFields(table, {
      visibleFieldIds: recordSearch.visibleFieldIds,
    });

    const generatedTextCondition = yield* buildGeneratedTextSearchCondition(
      resolvedFields,
      recordSearch,
      options?.searchAccessPath,
      tableAlias,
      options?.fieldMaskSqlMap
    );
    if (generatedTextCondition) {
      return ok({ condition: generatedTextCondition, usedAccessPath: 'generated_text' });
    }

    const searchAccessPathCondition = yield* buildGeneratedTsvectorSearchCondition(
      resolvedFields,
      recordSearch,
      options?.searchAccessPath,
      tableAlias,
      options?.fieldMaskSqlMap
    );
    if (searchAccessPathCondition) {
      return ok({
        condition: searchAccessPathCondition,
        usedAccessPath: 'generated_tsvector',
      });
    }

    const defaultCondition = yield* buildDefaultSearchCondition(
      resolvedFields,
      recordSearch,
      tableAlias,
      options?.fieldMaskSqlMap
    );
    return ok({ condition: defaultCondition, usedAccessPath: 'default' });
  });
};

export const buildRecordSearchWhereClause = (
  table: Table,
  recordSearch: RecordQuerySearch | undefined,
  options?: RecordSearchWhereBuilderOptions
): Result<Expression<SqlBool> | null, DomainError> =>
  buildRecordSearchWherePlan(table, recordSearch, options).map((plan) => plan.condition);
