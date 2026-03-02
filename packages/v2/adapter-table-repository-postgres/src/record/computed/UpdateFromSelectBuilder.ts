import { domainError, Field, FieldType, FieldValueTypeVisitor } from '@teable/v2-core';
import type {
  DomainError,
  ConditionalLookupField,
  FieldId,
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
};

/**
 * Result of UPDATE with RETURNING clause.
 */
export type UpdateWithReturningResult = {
  /** The compiled query */
  compiled: CompiledQuery;
  /** Mapping from column name to field ID */
  columnToFieldId: Map<string, string>;
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

  build(params: UpdateFromSelectParams): Result<CompiledQuery, DomainError> {
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
        const distinctFilter = params.skipDistinctFilter
          ? undefined
          : projectionPlan.buildDistinctFilter(tableAlias);

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(typedSelectQuery.as(selectAlias))
          .set((eb) => projectionPlan.buildSetValues(tableAlias)(eb))
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
        const distinctFilter = params.skipDistinctFilter
          ? undefined
          : projectionPlan.buildDistinctFilter(tableAlias);
        const columnMapping = projectionPlan.buildColumnMapping();

        let query = this.db
          .updateTable(`${tableName} as ${tableAlias}`)
          .from(typedSelectQuery.as(selectAlias))
          .set((eb) => projectionPlan.buildSetValues(tableAlias)(eb))
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
        const returningColumns = [
          `"${tableAlias}"."__id"`,
          `"${tableAlias}"."__version" - 1 as "__old_version"`,
        ];
        for (const [column] of columnMapping) {
          returningColumns.push(`"${tableAlias}"."${column}"`);
        }

        // Use raw SQL for RETURNING since Kysely's typing doesn't support it well for updates
        const compiled = query.compile();
        const returningClause = ` RETURNING ${returningColumns.join(', ')}`;
        const sqlWithReturning = compiled.sql + returningClause;

        return ok({
          compiled: {
            ...compiled,
            sql: sqlWithReturning,
          },
          columnToFieldId: columnMapping,
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

const resolveLookupScalarDbFieldType = (
  field: Field,
  valueType: FieldValueType
): Result<string, DomainError> => {
  const base = resolveDbFieldType(field, valueType.cellValueType.toString(), false);
  if (field.type().equals(FieldType.lookup())) {
    return (field as LookupField)
      .innerFieldType()
      .map((innerType) => {
        // V1 compatibility: AutoNumber lookups should use INTEGER, not REAL/double precision
        if (innerType.equals(FieldType.autoNumber())) {
          return 'INTEGER';
        }
        return base;
      })
      .orElse(() => {
        // Fallback: If inner field isn't resolved (pending validation), infer from dbFieldType
        // This handles V1 fields where dbFieldType might already be set correctly (e.g., INTEGER)
        return field
          .dbFieldType()
          .andThen((dbFieldType) => dbFieldType.value())
          .orElse(() => ok(base));
      });
  }
  if (field.type().equals(FieldType.conditionalLookup())) {
    return (field as ConditionalLookupField)
      .innerFieldType()
      .map((innerType) => {
        if (innerType.equals(FieldType.autoNumber())) {
          return 'INTEGER';
        }
        return base;
      })
      .orElse(() => {
        return field
          .dbFieldType()
          .andThen((dbFieldType) => dbFieldType.value())
          .orElse(() => ok(base));
      });
  }
  return ok(base);
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

const buildLookupAssignmentFromRef = (
  sourceRef: unknown,
  lookupDbFieldType: string,
  isLookupMultiValue: boolean,
  isLookupAutoNumber: boolean
) => {
  const normalizedType = normalizeDbFieldType(lookupDbFieldType);
  if (normalizedType === 'jsonb') {
    const refJson = sql`to_jsonb(${sourceRef})`;
    if (isLookupMultiValue && !isLookupAutoNumber) {
      return refJson;
    }
    return sql`(CASE WHEN jsonb_typeof(${refJson}) = 'array' THEN ${refJson} -> 0 ELSE ${refJson} END)`;
  }
  const scalarText = sql`(${sourceRef} ->> 0)`;
  return buildLookupScalarCast(scalarText, normalizedType);
};

const buildFieldMappings = (
  table: Table,
  fieldIds: ReadonlyArray<FieldId>
): Result<ReadonlyArray<FieldMapping>, DomainError> => {
  return safeTry<ReadonlyArray<FieldMapping>, DomainError>(function* () {
    const mappings: FieldMapping[] = [];
    const valueTypeVisitor = new FieldValueTypeVisitor();

    for (const fieldId of fieldIds) {
      const field = yield* table.getField((candidate) => candidate.id().equals(fieldId));
      // Skip fields with errors - they should not be updated
      if (field.hasError().isError()) {
        continue;
      }
      const dbFieldName = yield* field.dbFieldName();
      const columnName = yield* dbFieldName.value();
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

      // Created/LastModified time fields are stored as TEXT columns even though their
      // semantic value type is DATETIME. Use TEXT here to align DISTINCT comparisons
      // with the actual column type and avoid type-mismatch errors.
      if (
        field.type().equals(FieldType.createdTime()) ||
        field.type().equals(FieldType.lastModifiedTime())
      ) {
        dbFieldType = 'TEXT';
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
        fieldId,
        isLookup,
        isLookupMultiValue,
        isLookupAutoNumber,
        dbFieldType,
      });
    }

    return ok(mappings);
  });
};

type UpdateAssignmentStrategy = 'lookup' | 'json' | 'numeric' | 'scalar';

const normalizeIdentifierPart = (value: string): string => value.replace(/[^a-zA-Z0-9_]/g, '_');

class UpdateAssignmentPlan {
  readonly column: string;
  readonly fieldId: FieldId;
  readonly projectionColumnAlias: string;
  readonly strategy: UpdateAssignmentStrategy;
  private readonly normalizedDbType: string;

  private constructor(
    private readonly mapping: FieldMapping,
    projectionColumnAlias: string
  ) {
    this.column = mapping.column;
    this.fieldId = mapping.fieldId;
    this.projectionColumnAlias = projectionColumnAlias;
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
        return sql`to_jsonb(${sourceRef})`;
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
    tableAlias: string
  ): (eb: ExpressionBuilder<DynamicDB, string>) => Record<string, unknown> {
    return (eb) => {
      const values: Record<string, unknown> = {};
      // Increment __version for computed updates (like V1 does)
      values['__version'] = sql`"${sql.raw(tableAlias)}"."__version" + 1`;

      for (const plan of this.assignmentPlans) {
        values[plan.column] = plan.buildProjectedRef(eb, this.projectionAlias);
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
        const projected = plan.buildProjectedRef(eb, this.projectionAlias);
        return sql<SqlBool>`"${sql.raw(tableAlias)}"."${sql.raw(
          plan.column
        )}" IS DISTINCT FROM ${projected}`;
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
}
