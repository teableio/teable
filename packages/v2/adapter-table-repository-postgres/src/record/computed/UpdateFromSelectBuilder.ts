import { domainError, Field, FieldType, FieldValueTypeVisitor } from '@teable/v2-core';
import type {
  DomainError,
  ConditionalLookupField,
  FieldId,
  LinkField,
  LookupField,
  Table,
  TableId,
  FieldValueType,
} from '@teable/v2-core';
import type {
  CompiledQuery,
  Expression,
  ExpressionBuilder,
  Kysely,
  SqlBool,
  UpdateQueryBuilder,
  UpdateResult,
} from 'kysely';
import { sql } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DynamicDB, QB } from '../query-builder';
import { COMPUTED_TABLE_ALIAS } from '../query-builder/computed';

export type UpdateRecordFilter = (params: {
  db: Kysely<DynamicDB>;
  query: UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;
  tableId: TableId;
  tableAlias: string;
  selectAlias: string;
}) => UpdateQueryBuilder<DynamicDB, string, string, UpdateResult>;

/**
 * Configuration for dirty record filtering.
 * When provided, the UPDATE will only affect records in the dirty table.
 */
export type DirtyFilterConfig = {
  /** The table ID to filter by in the dirty table */
  tableId: TableId;
  /** The name of the dirty table (default: 'tmp_computed_dirty') */
  dirtyTableName?: string;
  /** Column name for table ID in dirty table (default: 'table_id') */
  tableIdColumn?: string;
  /** Column name for record ID in dirty table (default: 'record_id') */
  recordIdColumn?: string;
};

export type UpdateFromSelectParams = {
  table: Table;
  fieldIds: ReadonlyArray<FieldId>;
  selectQuery: QB;
  tableAlias?: string;
  selectAlias?: string;
  recordFilter?: UpdateRecordFilter;
  /**
   * When provided, applies a dirty filter to only update records
   * that exist in the dirty table. This ensures computed updates
   * only affect records that have been marked as dirty.
   */
  dirtyFilter?: DirtyFilterConfig;
  /**
   * When true, skip the IS DISTINCT FROM optimisation and update all rows
   * unconditionally.  Use after a field type conversion where the stored
   * column type differs from the newly-computed value type, making a safe
   * type-aware comparison impossible.
   */
  skipDistinctFilter?: boolean;
  /**
   * Whether this UPDATE should increment __version for changed rows.
   * Wide computed updates may split field assignments across multiple
   * statements, then bump versions once after all field chunks finish.
   */
  incrementVersion?: boolean;
};

/**
 * Result of UPDATE with RETURNING clause.
 */
export type UpdateWithReturningResult = {
  /** The compiled query */
  compiled: CompiledQuery;
  /** Mapping from column name to field ID */
  columnToFieldId: Map<string, string>;
  /** Mapping from column name to RETURNING alias for the old value */
  oldColumnAliases: Map<string, string>;
};

/**
 * A row returned from UPDATE...RETURNING.
 */
export type UpdatedRecordRow = {
  __id: string;
  /** Version of the record BEFORE this computed update (version - 1 after UPDATE) */
  __old_version: number;
  [column: string]: unknown;
};

// Index-based so the alias stays under Postgres' 63-byte identifier limit no
// matter how long the column name is: a truncated alias would make the
// RETURNING key miss `row[alias]` and read old values as undefined.
const oldValueAliasForColumn = (columnIndex: number): string => `__old_${columnIndex}`;

const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const quoteRef = (...parts: string[]): string => parts.map(quoteIdentifier).join('.');

const quoteQualifiedTableName = (value: string): string =>
  value.split('.').map(quoteIdentifier).join('.');

/**
 * Build UPDATE...FROM statements using a computed SELECT subquery.
 *
 * Example
 * ```typescript
 * const compiled = await builder.build({
 *   table,
 *   fieldIds: [formulaFieldId],
 *   selectQuery: computedSelect,
 * });
 * await db.executeQuery(compiled);
 * ```
 */
export class UpdateFromSelectBuilder {
  constructor(private readonly db: Kysely<DynamicDB>) {}

  private buildNoopQuery(): CompiledQuery {
    return sql`select 1 where false`.compile(this.db);
  }

  private buildNoopReturningQuery(): CompiledQuery {
    return sql`select null::text as "__id", null::integer as "__old_version" where false`.compile(
      this.db
    );
  }

  build(
    params: UpdateFromSelectParams & {
      /** Preserve the version increments of separate single-field backfill statements. */
      countChangedFieldsForVersion?: boolean;
    }
  ): Result<CompiledQuery, DomainError> {
    const tableAlias = params.tableAlias ?? 'u';
    const selectAlias = params.selectAlias ?? 'c';
    const fieldIds = params.fieldIds;

    if (fieldIds.length === 0) {
      return err(
        domainError.validation({ message: 'UpdateFromSelect requires at least one field' })
      );
    }

    return this.prepareUpdateProjectionContext(params, selectAlias).andThen(
      ({ tableName, projectionPlan, typedSelectQuery }) => {
        const incrementVersion = params.incrementVersion ?? true;
        const distinctFilter = params.skipDistinctFilter
          ? undefined
          : projectionPlan.buildDistinctFilter(tableAlias);

        if (projectionPlan.isEmpty()) {
          return ok(this.buildNoopQuery());
        }

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(typedSelectQuery.as(selectAlias))
          .set((eb) =>
            projectionPlan.buildSetValues(tableAlias, {
              incrementVersion,
              countChangedFieldsForVersion: params.countChangedFieldsForVersion,
              skipDistinctFilter: params.skipDistinctFilter,
            })(eb)
          )
          .whereRef(`${tableAlias}.__id`, '=', `${selectAlias}.__id`);

        if (params.recordFilter) {
          query = params.recordFilter({
            db: this.db,
            query,
            tableId: params.table.id(),
            tableAlias,
            selectAlias,
          });
        }

        if (distinctFilter) {
          query = query.where((eb) => distinctFilter(eb));
        }

        return ok(query.compile());
      }
    );
  }

  /**
   * Build UPDATE...FROM statement with RETURNING clause to get updated record IDs and new values.
   * This is used for event generation after computed field updates.
   */
  buildWithReturning(
    params: UpdateFromSelectParams
  ): Result<UpdateWithReturningResult, DomainError> {
    const tableAlias = params.tableAlias ?? 'u';
    const selectAlias = params.selectAlias ?? 'c';
    const fieldIds = params.fieldIds;

    if (fieldIds.length === 0) {
      return err(
        domainError.validation({ message: 'UpdateFromSelect requires at least one field' })
      );
    }

    return this.prepareUpdateProjectionContext(params, selectAlias).andThen(
      ({ tableName, projectionPlan, typedSelectQuery }) => {
        const incrementVersion = params.incrementVersion ?? true;
        const distinctFilter = params.skipDistinctFilter
          ? undefined
          : projectionPlan.buildDistinctFilter(tableAlias);
        const columnMapping = projectionPlan.buildColumnMapping();

        if (projectionPlan.isEmpty()) {
          return ok({
            compiled: this.buildNoopReturningQuery(),
            columnToFieldId: columnMapping,
            oldColumnAliases: new Map(),
          });
        }

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(typedSelectQuery.as(selectAlias))
          .set((eb) => projectionPlan.buildSetValues(tableAlias, { incrementVersion })(eb))
          .whereRef(`${tableAlias}.__id`, '=', `${selectAlias}.__id`);

        if (params.recordFilter) {
          query = params.recordFilter({
            db: this.db,
            query,
            tableId: params.table.id(),
            tableAlias,
            selectAlias,
          });
        }

        if (distinctFilter) {
          query = query.where((eb) => distinctFilter(eb));
        }

        // Add RETURNING clause for record ID, old version, and all updated columns
        // Use double quotes to preserve case-sensitivity in PostgreSQL
        // Return __version - 1 as __old_version (the version BEFORE this computed update)
        const oldVersionExpression = incrementVersion
          ? `${quoteRef(tableAlias, '__version')} - 1`
          : quoteRef(tableAlias, '__version');
        const oldTableAlias = '__old';
        const returningColumns = [
          quoteRef(tableAlias, '__id'),
          `${oldVersionExpression} as "__old_version"`,
        ];
        const oldColumnAliases = new Map<string, string>();
        let oldAliasIndex = 0;
        for (const [column] of columnMapping) {
          const oldAlias = oldValueAliasForColumn(oldAliasIndex++);
          oldColumnAliases.set(column, oldAlias);
          returningColumns.push(
            `${quoteRef(oldTableAlias, column)} as ${quoteIdentifier(oldAlias)}`
          );
          returningColumns.push(quoteRef(tableAlias, column));
        }

        // Use raw SQL for RETURNING since Kysely's typing doesn't support it well for updates
        const compiled = query.compile();
        const whereIndex = compiled.sql.lastIndexOf(' where ');
        if (whereIndex === -1) {
          return err(
            domainError.validation({
              message: 'UpdateFromSelect returning query is missing WHERE clause',
            })
          );
        }
        const sqlWithOldTable =
          compiled.sql.slice(0, whereIndex) +
          `, ${quoteQualifiedTableName(tableName)} as "${oldTableAlias}"` +
          compiled.sql.slice(whereIndex, whereIndex + ' where '.length) +
          `${quoteRef(oldTableAlias, '__id')} = ${quoteRef(selectAlias, '__id')} and ` +
          compiled.sql.slice(whereIndex + ' where '.length);
        const returningClause = ` RETURNING ${returningColumns.join(', ')}`;
        const sqlWithReturning = sqlWithOldTable + returningClause;

        return ok({
          compiled: {
            ...compiled,
            sql: sqlWithReturning,
          },
          columnToFieldId: columnMapping,
          oldColumnAliases,
        });
      }
    );
  }

  private prepareUpdateProjectionContext(
    params: UpdateFromSelectParams,
    selectAlias: string
  ): Result<
    {
      tableName: string;
      projectionPlan: UpdateAssignmentProjectionPlan;
      typedSelectQuery: QB;
    },
    DomainError
  > {
    return params.table
      .dbTableName()
      .andThen((dbTableName) => dbTableName.value())
      .andThen((tableName) => {
        const fieldMappingsResult = buildFieldMappings(params.table, params.fieldIds);
        if (fieldMappingsResult.isErr()) return err(fieldMappingsResult.error);

        const projectionPlan = UpdateAssignmentProjectionPlan.create(
          fieldMappingsResult.value,
          selectAlias
        );
        const sourceQuery = this.applyDirtyFilter(params.selectQuery, params.dirtyFilter);
        const typedSelectQuery = projectionPlan.buildTypedSelectQuery(this.db, sourceQuery);
        return ok({ tableName, projectionPlan, typedSelectQuery });
      });
  }

  /**
   * Apply dirty filter to the source SELECT before assignment projection.
   * The dirty join must remain at this stage so planner can still push it down.
   */
  private applyDirtyFilter(selectQuery: QB, dirtyFilter?: DirtyFilterConfig): QB {
    if (!dirtyFilter) {
      return selectQuery;
    }

    const {
      tableId,
      dirtyTableName = 'tmp_computed_dirty',
      tableIdColumn = 'table_id',
      recordIdColumn = 'record_id',
    } = dirtyFilter;

    return selectQuery.innerJoin(`${dirtyTableName} as __dirty`, (join) =>
      join
        .onRef(`${COMPUTED_TABLE_ALIAS}.__id`, '=', `__dirty.${recordIdColumn}`)
        .on(`__dirty.${tableIdColumn}`, '=', tableId.toString())
    ) as QB;
  }
}

type FieldMapping = {
  column: string;
  fieldId: FieldId;
  isLookup: boolean;
  isLookupMultiValue: boolean;
  isLookupAutoNumber: boolean;
  dbFieldType: string;
  /**
   * FK column of a required FK-hosting link (manyOne / hosting oneOne). A null
   * projection must never be written to the NOT NULL display column: a missed
   * join (orphaned FK) and a cleared FK are both stored as a null projection,
   * and either one would 23502 if assigned. Presence of this column is the
   * marker to COALESCE onto the existing display value instead.
   */
  requiredLinkFkColumn: string | null;
};

const resolveRequiredLinkFkColumn = (field: Field): string | null => {
  if (!field.type().equals(FieldType.link())) return null;
  if (!field.notNull().toBoolean()) return null;
  const linkField = field as LinkField;
  const relationship = linkField.relationship().toString();
  if (relationship !== 'manyOne' && relationship !== 'oneOne') return null;
  const fkColumn = linkField.foreignKeyNameString().unwrapOr('__id');
  // '__id' means the FK column lives on the other table (symmetric oneOne side)
  return fkColumn === '__id' ? null : fkColumn;
};

const jsonSpecResult = Field.specs().isJson().build();

const fieldIsJson = (field: Field): boolean => {
  if (jsonSpecResult.isErr()) return false;
  return jsonSpecResult.value.isSatisfiedBy(field);
};

const resolveDbFieldType = (
  field: Field,
  cellValueType: string,
  isMultipleCellValue: boolean
): string => {
  if (isMultipleCellValue) return 'JSON';
  if (fieldIsJson(field)) return 'JSON';
  switch (cellValueType) {
    case 'number':
      return 'REAL';
    case 'dateTime':
      return 'DATETIME';
    case 'boolean':
      return 'BOOLEAN';
    case 'string':
      return 'TEXT';
    default:
      return 'TEXT';
  }
};

const resolveStorageDbFieldTypeFromFieldType = (fieldType: FieldType): string | undefined => {
  if (fieldType.equals(FieldType.autoNumber())) return 'INTEGER';
  if (fieldType.equals(FieldType.number()) || fieldType.equals(FieldType.rating())) return 'REAL';
  if (
    fieldType.equals(FieldType.link()) ||
    fieldType.equals(FieldType.user()) ||
    fieldType.equals(FieldType.createdBy()) ||
    fieldType.equals(FieldType.lastModifiedBy()) ||
    fieldType.equals(FieldType.attachment()) ||
    fieldType.equals(FieldType.button())
  ) {
    return 'JSON';
  }
  if (
    fieldType.equals(FieldType.date()) ||
    fieldType.equals(FieldType.createdTime()) ||
    fieldType.equals(FieldType.lastModifiedTime())
  ) {
    return 'DATETIME';
  }
  if (fieldType.equals(FieldType.checkbox())) return 'BOOLEAN';
  return undefined;
};

const isConcreteStorageDbFieldType = (normalized: string): boolean => {
  return (
    normalized === 'jsonb' ||
    normalized === 'boolean' ||
    isTemporalDbFieldType(normalized) ||
    isNumericDbFieldType(normalized)
  );
};

const resolveLookupScalarDbFieldType = (
  field: Field,
  valueType: FieldValueType
): Result<string, DomainError> => {
  const persistedDbFieldType = field.dbFieldType().andThen((dbFieldType) => dbFieldType.value());
  if (persistedDbFieldType.isOk()) {
    const persisted = persistedDbFieldType.value;
    const normalizedPersisted = normalizeDbFieldType(persisted);
    if (isConcreteStorageDbFieldType(normalizedPersisted)) {
      return ok(persisted);
    }
  }
  const base = resolveDbFieldType(field, valueType.cellValueType.toString(), false);
  const pendingFallback = (): Result<string, DomainError> => ok(base);
  const resolveFromInner = (
    innerTypeResult: Result<FieldType, DomainError>
  ): Result<string, DomainError> =>
    innerTypeResult
      .map((innerType) => resolveStorageDbFieldTypeFromFieldType(innerType) ?? base)
      .orElse(pendingFallback);

  if (field.type().equals(FieldType.lookup())) {
    return resolveFromInner((field as LookupField).innerFieldType());
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    return resolveFromInner((field as ConditionalLookupField).innerFieldType());
  }
  return ok(resolveStorageDbFieldTypeFromFieldType(field.type()) ?? base);
};

const normalizeDbFieldType = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case 'JSON':
      return 'jsonb';
    case 'REAL':
      return 'double precision';
    case 'DATETIME':
      return 'timestamptz';
    case 'BOOLEAN':
      return 'boolean';
    case 'TEXT':
      return 'text';
    default:
      return normalized.toLowerCase();
  }
};

const isNumericDbFieldType = (value: string): boolean => {
  return (
    value === 'double precision' ||
    value === 'numeric' ||
    value === 'decimal' ||
    value === 'integer' ||
    value === 'bigint' ||
    value === 'smallint'
  );
};

const isTemporalDbFieldType = (value: string): boolean => {
  return (
    value === 'timestamptz' ||
    value === 'timestamp with time zone' ||
    value === 'timestamp' ||
    value === 'timestamp without time zone' ||
    value === 'date'
  );
};

const buildNumericCastExpression = (expression: ReturnType<typeof sql>, columnType: string) => {
  return sql`CASE
    WHEN (${expression}) IS NULL THEN NULL
    WHEN BTRIM((${expression})::text) ~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      THEN BTRIM((${expression})::text)::${sql.raw(columnType)}
    ELSE NULL
  END`;
};

const buildLookupScalarCast = (expression: ReturnType<typeof sql>, columnType: string) => {
  switch (columnType) {
    case 'double precision':
    case 'numeric':
    case 'decimal':
    case 'integer':
    case 'bigint':
    case 'smallint':
      return buildNumericCastExpression(expression, columnType);
    case 'boolean':
      return sql`${expression}::boolean`;
    case 'timestamptz':
    case 'timestamp with time zone':
      return sql`${expression}::timestamptz`;
    case 'timestamp':
    case 'timestamp without time zone':
      return sql`${expression}::timestamp`;
    case 'date':
      return sql`${expression}::date`;
    default:
      return expression;
  }
};

const buildNullableLookupSourceJson = (sourceRef: unknown) => {
  return sql`(CASE
    WHEN ${sourceRef} IS NULL THEN NULL::jsonb
    ELSE (${sourceRef})::jsonb
  END)`;
};

const buildNullableJsonProjectionSource = (sourceRef: unknown) => {
  return sql`(CASE
    WHEN ${sourceRef} IS NULL THEN NULL::jsonb
    ELSE to_jsonb(${sourceRef})
  END)`;
};

const buildLookupAssignmentFromRef = (
  sourceRef: unknown,
  lookupDbFieldType: string,
  isLookupMultiValue: boolean,
  isLookupAutoNumber: boolean
) => {
  const normalizedType = normalizeDbFieldType(lookupDbFieldType);
  const refJson = buildNullableLookupSourceJson(sourceRef);

  if (normalizedType === 'jsonb') {
    if (isLookupMultiValue && !isLookupAutoNumber) {
      return refJson;
    }
    return sql`(CASE WHEN jsonb_typeof(${refJson}) = 'array' THEN ${refJson} -> 0 ELSE ${refJson} END)`;
  }
  const scalarText = sql`(CASE
    WHEN ${refJson} IS NULL THEN NULL
    ELSE ${refJson} ->> 0
  END)`;
  return buildLookupScalarCast(scalarText, normalizedType);
};

const buildFieldMappings = (
  table: Table,
  fieldIds: ReadonlyArray<FieldId>
): Result<ReadonlyArray<FieldMapping>, DomainError> => {
  return safeTry<ReadonlyArray<FieldMapping>, DomainError>(function* () {
    const mappings: FieldMapping[] = [];
    const valueTypeVisitor = new FieldValueTypeVisitor();
    const selectedFieldIds = new Set(fieldIds.map((fieldId) => fieldId.toString()));
    const selectedFields = table
      .getFields()
      .filter(
        (field) => selectedFieldIds.has(field.id().toString()) && !field.hasError().isError()
      );
    const lastFieldIdByColumn = new Map<string, string>();

    // Plans are persisted; a field can be deleted between planning and
    // execution. A deleted field simply has nothing left to update, so skip it
    // instead of failing the whole step (a hard error here is classified as
    // transient and retried to dead letter). An all-deleted step degrades to a
    // no-op via projectionPlan.isEmpty().

    for (const field of selectedFields) {
      const dbFieldName = yield* field.dbFieldName();
      lastFieldIdByColumn.set(yield* dbFieldName.value(), field.id().toString());
    }

    const selectedFieldById = new Map(
      selectedFields.map((field) => [field.id().toString(), field] as const)
    );
    for (const fieldId of fieldIds) {
      const field = selectedFieldById.get(fieldId.toString());
      if (!field) continue;
      const dbFieldName = yield* field.dbFieldName();
      const columnName = yield* dbFieldName.value();
      if (lastFieldIdByColumn.get(columnName) !== field.id().toString()) continue;
      // Determine if this is a lookup field
      // V1 compatibility: V1 stores lookup fields with isLookup=true metadata and a specific type
      // (e.g., type='autoNumber', isLookup=true). When loaded by V2, these become LookupField instances
      // with the original field type as the inner field.
      const isLookup =
        field.type().equals(FieldType.lookup()) ||
        field.type().equals(FieldType.conditionalLookup());
      const isLookupAutoNumber = (() => {
        if (field.type().equals(FieldType.lookup())) {
          return (field as LookupField)
            .innerFieldType()
            .map((innerType) => innerType.equals(FieldType.autoNumber()))
            .unwrapOr(false);
        }
        if (field.type().equals(FieldType.conditionalLookup())) {
          return (field as ConditionalLookupField)
            .innerFieldType()
            .map((innerType) => innerType.equals(FieldType.autoNumber()))
            .unwrapOr(false);
        }
        return false;
      })();

      const valueType = yield* field.accept(valueTypeVisitor);
      const isLookupMultiValue = isLookup && valueType.isMultipleCellValue.toBoolean();
      const derivedDbFieldType = resolveDbFieldType(
        field,
        valueType.cellValueType.toString(),
        valueType.isMultipleCellValue.toBoolean()
      );
      const persistedDbFieldTypeResult = field
        .dbFieldType()
        .andThen((dbFieldType) => dbFieldType.value());
      const persistedDbFieldType = persistedDbFieldTypeResult.isOk()
        ? persistedDbFieldTypeResult.value
        : undefined;
      let dbFieldType = persistedDbFieldType ?? derivedDbFieldType;

      // V1 parity: autoNumber fields use INTEGER, not REAL
      if (field.type().equals(FieldType.autoNumber())) {
        dbFieldType = 'INTEGER';
      }

      // For multi-value lookups, always use JSON storage semantics. This protects against
      // stale scalar dbFieldType metadata that can otherwise produce jsonb=integer DISTINCT
      // comparisons during computed updates.
      if (isLookup && valueType.isMultipleCellValue.toBoolean()) {
        dbFieldType = 'JSON';
      }

      // For single-value lookups, resolve the scalar dbFieldType for proper SQL generation.
      // The SELECT query (built by ComputedTableRecordQueryBuilder) returns JSONB arrays for all
      // lookup fields. For single-value lookups stored in scalar columns, we need to extract the
      // first array element and cast it to the target type.
      //
      // V1 compatibility: V1 stores AutoNumber lookups with dbFieldType='INTEGER'. V2 needs to
      // handle these correctly by ensuring buildLookupAssignment receives the right dbFieldType.
      if (isLookup && !valueType.isMultipleCellValue.toBoolean()) {
        // Always resolve to the scalar type for single-value lookups. This avoids stale JSON
        // dbFieldType metadata from v1 causing jsonb assignments into scalar columns.
        dbFieldType = yield* resolveLookupScalarDbFieldType(field, valueType);
      }

      mappings.push({
        column: columnName,
        fieldId: field.id(),
        isLookup,
        isLookupMultiValue,
        isLookupAutoNumber,
        dbFieldType,
        requiredLinkFkColumn: resolveRequiredLinkFkColumn(field),
      });
    }

    return ok(mappings);
  });
};

type UpdateAssignmentStrategy = 'lookup' | 'json' | 'numeric' | 'scalar';

const normalizeIdentifierPart = (value: string): string => value.replace(/\W/g, '_');

class UpdateAssignmentPlan {
  readonly column: string;
  readonly fieldId: FieldId;
  readonly projectionColumnAlias: string;
  readonly strategy: UpdateAssignmentStrategy;
  readonly requiredLinkFkColumn: string | null;
  private readonly normalizedDbType: string;

  private constructor(
    private readonly mapping: FieldMapping,
    projectionColumnAlias: string
  ) {
    this.column = mapping.column;
    this.fieldId = mapping.fieldId;
    this.projectionColumnAlias = projectionColumnAlias;
    this.requiredLinkFkColumn = mapping.requiredLinkFkColumn;
    this.normalizedDbType = normalizeDbFieldType(mapping.dbFieldType);

    if (mapping.isLookup) {
      this.strategy = 'lookup';
    } else if (this.normalizedDbType === 'jsonb') {
      this.strategy = 'json';
    } else if (isNumericDbFieldType(this.normalizedDbType)) {
      this.strategy = 'numeric';
    } else {
      this.strategy = 'scalar';
    }
  }

  static createMany(mappings: ReadonlyArray<FieldMapping>): ReadonlyArray<UpdateAssignmentPlan> {
    const usedAliases = new Set<string>();

    return mappings.map((mapping) => {
      const baseAlias = `__set_${normalizeIdentifierPart(mapping.column)}`;
      let alias = baseAlias;
      let index = 1;
      while (usedAliases.has(alias)) {
        alias = `${baseAlias}_${index}`;
        index += 1;
      }
      usedAliases.add(alias);
      return new UpdateAssignmentPlan(mapping, alias);
    });
  }

  buildProjectionExpression(
    eb: ExpressionBuilder<DynamicDB, string>,
    sourceAlias: string
  ): unknown {
    const sourceRef = eb.ref(`${sourceAlias}.${this.column}`);

    switch (this.strategy) {
      case 'lookup':
        return buildLookupAssignmentFromRef(
          sourceRef,
          this.mapping.dbFieldType,
          this.mapping.isLookupMultiValue,
          this.mapping.isLookupAutoNumber
        );
      case 'json':
        return buildNullableJsonProjectionSource(sourceRef);
      case 'numeric':
        return buildNumericCastExpression(sql`${sourceRef}`, this.normalizedDbType);
      case 'scalar':
      default:
        return sql`${sourceRef}::${sql.raw(this.normalizedDbType)}`;
    }
  }

  buildProjectedRef(eb: ExpressionBuilder<DynamicDB, string>, projectionAlias: string) {
    return eb.ref(`${projectionAlias}.${this.projectionColumnAlias}`);
  }

  buildSetAssignment(eb: ExpressionBuilder<DynamicDB, string>, projectionAlias: string) {
    const projected = this.buildProjectedRef(eb, projectionAlias);
    // PostgreSQL types UPDATE ... SET from the FROM-subquery column. Kysely's
    // aliased projection can be inferred as text even when the SELECT expression
    // was already jsonb/timestamptz/numeric. Recast every physical type,
    // including jsonb, so schema backfill does not die on text→jsonb.
    return sql`${projected}::${sql.raw(this.normalizedDbType)}`;
  }

  buildDistinctCondition(
    eb: ExpressionBuilder<DynamicDB, string>,
    tableAlias: string,
    projectionAlias: string
  ): Expression<SqlBool> {
    const target = sql.raw(quoteRef(tableAlias, this.column));
    const projected = this.buildProjectedRef(eb, projectionAlias);

    // Always cast both sides to a shared comparable type. PostgreSQL implements
    // IS DISTINCT FROM via `=`, so mixed physical/projection types
    // (double precision vs text, jsonb vs text, etc.) fail hard during backfill.
    // Temporal columns already used text; extend the same defense to every type.
    const changed =
      this.normalizedDbType === 'jsonb'
        ? sql<SqlBool>`(${target})::jsonb IS DISTINCT FROM (${projected})::jsonb`
        : isTemporalDbFieldType(this.normalizedDbType) || this.normalizedDbType === 'text'
          ? sql<SqlBool>`(${target})::text IS DISTINCT FROM (${projected})::text`
          : isNumericDbFieldType(this.normalizedDbType) || this.normalizedDbType === 'boolean'
            ? sql<SqlBool>`(${target})::${sql.raw(this.normalizedDbType)} IS DISTINCT FROM (${projected})::${sql.raw(this.normalizedDbType)}`
            : sql<SqlBool>`(${target})::text IS DISTINCT FROM (${projected})::text`;

    if (!this.requiredLinkFkColumn) {
      return changed;
    }

    // Never apply a null projection to a NOT NULL display column. A missed join
    // and a cleared FK both project null; writing that null is a 23502 either
    // way. Skip the row for this field (sibling columns in the same UPDATE can
    // still match via OR).
    return sql<SqlBool>`(${projected}) IS NOT NULL AND ${changed}`;
  }
}

class UpdateAssignmentProjectionPlan {
  readonly assignmentPlans: ReadonlyArray<UpdateAssignmentPlan>;
  readonly sourceAlias: string;
  readonly projectionAlias: string;

  private constructor(params: {
    assignmentPlans: ReadonlyArray<UpdateAssignmentPlan>;
    sourceAlias: string;
    projectionAlias: string;
  }) {
    this.assignmentPlans = params.assignmentPlans;
    this.sourceAlias = params.sourceAlias;
    this.projectionAlias = params.projectionAlias;
  }

  static create(
    mappings: ReadonlyArray<FieldMapping>,
    projectionAlias: string
  ): UpdateAssignmentProjectionPlan {
    return new UpdateAssignmentProjectionPlan({
      assignmentPlans: UpdateAssignmentPlan.createMany(mappings),
      sourceAlias: `${projectionAlias}_src`,
      projectionAlias,
    });
  }

  buildTypedSelectQuery(db: Kysely<DynamicDB>, sourceQuery: QB): QB {
    return db
      .selectFrom(sourceQuery.as(this.sourceAlias))
      .select((eb) => [
        sql`${eb.ref(`${this.sourceAlias}.__id`)}`.as('__id'),
        ...this.assignmentPlans.map((plan) =>
          sql`${plan.buildProjectionExpression(eb, this.sourceAlias)}`.as(
            plan.projectionColumnAlias
          )
        ),
      ]) as QB;
  }

  buildSetValues(
    tableAlias: string,
    options?: {
      incrementVersion?: boolean;
      countChangedFieldsForVersion?: boolean;
      skipDistinctFilter?: boolean;
    }
  ): (eb: ExpressionBuilder<DynamicDB, string>) => Record<string, unknown> {
    return (eb) => {
      const values: Record<string, unknown> = {};
      if (options?.incrementVersion ?? true) {
        // Increment __version for computed updates (like V1 does)
        const increment = options?.countChangedFieldsForVersion
          ? sql.join(
              this.assignmentPlans.map((plan) =>
                options.skipDistinctFilter
                  ? sql`1`
                  : sql`CASE WHEN ${plan.buildDistinctCondition(eb, tableAlias, this.projectionAlias)} THEN 1 ELSE 0 END`
              ),
              sql` + `
            )
          : sql`1`;
        values['__version'] = sql`${sql.raw(quoteRef(tableAlias, '__version'))} + ${increment}`;
      }
      for (const plan of this.assignmentPlans) {
        const assigned = plan.buildSetAssignment(eb, this.projectionAlias);
        values[plan.column] = plan.requiredLinkFkColumn
          ? sql`COALESCE(${assigned}, ${sql.raw(quoteRef(tableAlias, plan.column))})`
          : assigned;
      }
      return values;
    };
  }

  buildDistinctFilter(
    tableAlias: string
  ): ((eb: ExpressionBuilder<DynamicDB, string>) => Expression<SqlBool>) | undefined {
    if (this.assignmentPlans.length === 0) return undefined;
    return (eb) => {
      const conditions = this.assignmentPlans.map((plan) => {
        return plan.buildDistinctCondition(eb, tableAlias, this.projectionAlias);
      });
      return sql<SqlBool>`(${sql.join(conditions, sql` OR `)})`;
    };
  }

  buildColumnMapping(): Map<string, string> {
    const mapping = new Map<string, string>();
    for (const plan of this.assignmentPlans) {
      mapping.set(plan.column, plan.fieldId.toString());
    }
    return mapping;
  }

  isEmpty(): boolean {
    return this.assignmentPlans.length === 0;
  }
}
