import {
  AndSpec,
  CellValueType,
  domainError,
  FieldId,
  FieldType,
  FieldValueTypeVisitor,
  LinkForeignTableReferenceVisitor,
  LinkRelationship,
  type DomainError,
  type Field,
  type FieldCondition,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type LinkField,
  type RollupFunction,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
import {
  extractJsonScalarText,
  formatFieldValueAsStringSql,
  type IPgTypeValidationStrategy,
} from '@teable/v2-formula-sql-pg';
import {
  sql,
  type AliasedExpression,
  type AliasedRawBuilder,
  type Expression,
  type Kysely,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';
import { match } from 'ts-pattern';

import { TableRecordConditionWhereVisitor } from '../../visitors';
import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import type { QueryMode } from '../TableRecordQueryBuilderManager';
import {
  ComputedFieldSelectExpressionVisitor,
  type ILateralContext,
  type LateralColumnType,
  type LinkOrderBy,
} from './ComputedFieldSelectExpressionVisitor';

export const COMPUTED_TABLE_ALIAS = 't';
const T = COMPUTED_TABLE_ALIAS; // main table alias
const F = 'f'; // foreign table alias in lateral
const DEFAULT_CONDITIONAL_ORDER_BY = { column: '__auto_number', direction: 'asc' } as const;

/**
 * Configuration for dirty record filtering.
 * When provided, the query will INNER JOIN with the dirty table early
 * (before lateral joins) to filter records efficiently.
 */
export interface IDirtyFilterConfig {
  /** The table ID to filter by in the dirty table */
  tableId: string;
  /** The name of the dirty table (default: 'tmp_computed_dirty') */
  dirtyTableName?: string;
  /** Column name for table ID in dirty table (default: 'table_id') */
  tableIdColumn?: string;
  /** Column name for record ID in dirty table (default: 'record_id') */
  recordIdColumn?: string;
}

export interface IComputedQueryBuilderOptions {
  /** Foreign tables for link/lookup/rollup - can be pre-set (for tests) or loaded via prepare() */
  readonly foreignTables?: ReadonlyMap<string, Table>;
  /** Type validation strategy for PostgreSQL version compatibility */
  readonly typeValidationStrategy: IPgTypeValidationStrategy;
  /** Prefer stored values for non-deterministic formulas like LAST_MODIFIED_TIME(field) */
  readonly preferStoredLastModifiedFormula?: boolean;
}

/**
 * Query builder that computes field values using LATERAL joins and SQL expressions.
 * Dynamically resolves link/lookup/rollup fields through database-side computation.
 */
export class ComputedTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private table: Table | null = null;
  private projection: ReadonlyArray<FieldId> | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private orderByValues: Array<{ column: OrderByColumn; direction: 'asc' | 'desc' }> = [];
  private foreignTables: ReadonlyMap<string, Table>;
  private missingForeignTableIds: ReadonlySet<string> = new Set();
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];
  private dirtyFilterConfig: IDirtyFilterConfig | null = null;
  private readonly typeValidationStrategy: IPgTypeValidationStrategy;
  private readonly preferStoredLastModifiedFormula: boolean;

  readonly mode: QueryMode = 'computed';

  constructor(
    private readonly db: Kysely<DynamicDB>,
    options: IComputedQueryBuilderOptions
  ) {
    this.foreignTables = options.foreignTables ?? new Map();
    this.typeValidationStrategy = options.typeValidationStrategy;
    this.preferStoredLastModifiedFormula = options.preferStoredLastModifiedFormula ?? false;
  }

  from(table: Table): this {
    this.table = table;
    return this;
  }

  select(projection: ReadonlyArray<FieldId>): this {
    this.projection = projection;
    return this;
  }

  limit(n: number): this {
    this.limitValue = n;
    return this;
  }

  offset(n: number): this {
    this.offsetValue = n;
    return this;
  }

  orderBy(column: OrderByColumn, direction: 'asc' | 'desc'): this {
    this.orderByValues.push({ column, direction });
    return this;
  }

  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this {
    this.whereSpecs.push(spec);
    return this;
  }

  /**
   * Set dirty filter configuration.
   * When set, the query will INNER JOIN with the dirty table immediately after
   * the main table (before any lateral joins), ensuring PostgreSQL can use the
   * small dirty table to drive indexed lookups on the main table.
   *
   * This is critical for UPDATE...FROM performance - without early filtering,
   * PostgreSQL may scan and compute lateral joins for all rows before filtering.
   */
  withDirtyFilter(config: IDirtyFilterConfig): this {
    this.dirtyFilterConfig = config;
    return this;
  }

  /**
   * Prepare by loading foreign tables needed for link/lookup/rollup fields.
   */
  async prepare(deps: IQueryBuilderDeps): Promise<Result<void, DomainError>> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;

    return safeTry<void, DomainError>(
      async function* (this: ComputedTableRecordQueryBuilder) {
        // Collect all foreign table references from link/lookup/rollup fields
        const visitor = new LinkForeignTableReferenceVisitor();
        const refs = yield* visitor.collect(table.getFields());

        if (refs.length === 0) {
          this.foreignTables = new Map();
          this.missingForeignTableIds = new Set();
          return ok(undefined);
        }

        const foreignTables = new Map<string, Table>();

        // Separate self-referential from external references
        const externalTableIds = refs
          .filter((ref) => !ref.foreignTableId.equals(table.id()))
          .map((ref) => ref.foreignTableId);

        // Add self-referential table if present
        const hasSelfRef = refs.some((ref) => ref.foreignTableId.equals(table.id()));
        if (hasSelfRef) {
          foreignTables.set(table.id().toString(), table);
        }

        // Batch load all external foreign tables in one query
        if (externalTableIds.length > 0) {
          // Use withoutBaseId() to support cross-base foreign tables
          const foreignSpec = yield* table.specs().withoutBaseId().byIds(externalTableIds).build();
          const loadedTables = yield* await deps.tableRepository.find(deps.context, foreignSpec);

          for (const loadedTable of loadedTables) {
            foreignTables.set(loadedTable.id().toString(), loadedTable);
          }

          // Check if all foreign tables were found
          const missingIds = externalTableIds.filter((id) => !foreignTables.has(id.toString()));
          if (missingIds.length > 0) {
            this.missingForeignTableIds = new Set(missingIds.map((id) => id.toString()));
          } else {
            this.missingForeignTableIds = new Set();
          }
        }

        this.foreignTables = foreignTables;
        return ok(undefined);
      }.bind(this)
    );
  }

  build(): Result<QB, DomainError> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;
    const foreignTables = this.foreignTables;
    const projection = this.projection;
    const { laterals, conditionalLaterals, ctx: lateralCtx } = this.createLateralContext();

    return safeTry<QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const fieldSelectColumns = yield* this.buildSelectColumns(table, projection, lateralCtx);
        const applyLateralJoins = yield* this.buildLateralJoins(table, foreignTables, laterals);
        const applyConditionalJoins = yield* this.buildConditionalJoins(
          foreignTables,
          conditionalLaterals
        );

        // Always include __id column for record identification
        const idColumn = sql`${sql.ref(`${T}.__id`)}`.as('__id');

        // Always include __version column for realtime sync
        const versionColumn = sql`${sql.ref(`${T}.__version`)}`.as('__version');

        const selectColumns = [idColumn, versionColumn, ...fieldSelectColumns];

        // Resolve orderBy columns
        const resolvedOrderBy: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
        for (const orderBy of this.orderByValues) {
          const columnResult = yield* this.resolveOrderByColumn(table, orderBy.column);
          if (columnResult !== null) {
            resolvedOrderBy.push({ column: columnResult, direction: orderBy.direction });
          }
        }

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;

        // Build dirty filter join function if configured.
        // This MUST be applied BEFORE lateral joins to allow PostgreSQL to use
        // the small dirty table to drive indexed lookups, avoiding full table scans.
        const applyDirtyFilter = this.buildDirtyFilterJoin();

        let query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => selectColumns)
          .$call(applyDirtyFilter) // Apply dirty filter BEFORE lateral joins
          .$call(applyLateralJoins)
          .$call(applyConditionalJoins)
          .$if(whereClause !== null, (qb) =>
            qb.where(whereClause as unknown as Expression<SqlBool>)
          );

        for (const orderBy of resolvedOrderBy) {
          query = query.orderBy(sql`${sql.ref(`${T}.${orderBy.column}`)}`, orderBy.direction);
        }

        query = query
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));
        return ok(query);
      }.bind(this)
    );
  }

  /**
   * Build the dirty filter join function.
   * When dirtyFilterConfig is set, returns a function that applies an INNER JOIN
   * with the dirty table. This must be called BEFORE lateral joins in the query
   * chain to ensure proper query planning.
   */
  private buildDirtyFilterJoin(): (qb: QB) => QB {
    if (!this.dirtyFilterConfig) {
      return (qb) => qb;
    }

    const {
      tableId,
      dirtyTableName = 'tmp_computed_dirty',
      tableIdColumn = 'table_id',
      recordIdColumn = 'record_id',
    } = this.dirtyFilterConfig;

    const DIRTY_ALIAS = '__dirty';

    return (qb) =>
      qb.innerJoin(`${dirtyTableName} as ${DIRTY_ALIAS}`, (join) =>
        join
          .onRef(`${T}.__id`, '=', `${DIRTY_ALIAS}.${recordIdColumn}`)
          .on(`${DIRTY_ALIAS}.${tableIdColumn}`, '=', tableId)
      ) as QB;
  }

  private createLateralContext() {
    // Link-based laterals (keyed by linkFieldId + lookup filter)
    const laterals = new Map<
      string,
      {
        linkFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
        condition?: FieldCondition;
      }
    >();

    // Conditional field laterals (keyed by conditionalFieldId)
    // These don't share a link field, so each conditional field gets its own entry
    const conditionalLaterals = new Map<
      string,
      {
        conditionalFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
      }
    >();

    const hashKey = (value: string): string => {
      if (!value) return '0';
      let hash = 5381;
      for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) + hash + value.charCodeAt(i);
      }
      return Math.abs(hash).toString(36);
    };

    const conditionKey = (columnType: LateralColumnType): string => {
      if (
        columnType.type !== 'lookup' ||
        !columnType.condition ||
        !columnType.condition.hasFilter()
      ) {
        return '';
      }
      return JSON.stringify(columnType.condition.toDto());
    };

    const ctx: ILateralContext = {
      addColumn(linkFieldId, foreignTableId, outputAlias, columnType) {
        const conditionKeyValue = conditionKey(columnType);
        const key = `${linkFieldId.toString()}|${foreignTableId}|${conditionKeyValue}`;
        if (!laterals.has(key)) {
          laterals.set(key, {
            linkFieldId,
            alias: `lat_${linkFieldId.toString()}_${hashKey(conditionKeyValue)}`,
            foreignTableId,
            columns: [],
            condition:
              columnType.type === 'lookup' && columnType.condition?.hasFilter()
                ? columnType.condition
                : undefined,
          });
        }
        const lateral = laterals.get(key)!;
        // Prevent duplicate columns with the same outputAlias
        // This can happen when a formula references a lookup field that is also being computed
        const existingColumn = lateral.columns.find((col) => col.outputAlias === outputAlias);
        if (!existingColumn) {
          lateral.columns.push({ outputAlias, columnType });
        }
        return lateral.alias;
      },
      addConditionalColumn(conditionalFieldId, foreignTableId, outputAlias, columnType) {
        const key = conditionalFieldId.toString();
        if (!conditionalLaterals.has(key)) {
          conditionalLaterals.set(key, {
            conditionalFieldId,
            alias: `cond_${key}`,
            foreignTableId,
            columns: [],
          });
        }
        const lateral = conditionalLaterals.get(key)!;
        const existingColumn = lateral.columns.find((col) => col.outputAlias === outputAlias);
        if (!existingColumn) {
          lateral.columns.push({ outputAlias, columnType });
        }
        return lateral.alias;
      },
    };

    return { laterals, conditionalLaterals, ctx };
  }

  private buildSelectColumns(
    table: Table,
    projection: ReadonlyArray<FieldId> | null,
    lateralCtx: ILateralContext
  ): Result<AliasedRawBuilder<unknown, string>[], DomainError> {
    return safeTry(
      function* (this: ComputedTableRecordQueryBuilder) {
        const visitor = new ComputedFieldSelectExpressionVisitor(
          table,
          T,
          lateralCtx,
          this.typeValidationStrategy,
          {
            preferStoredLastModifiedFormula: this.preferStoredLastModifiedFormula,
            missingForeignTableIds: this.missingForeignTableIds,
          }
        );
        const columns: AliasedRawBuilder<unknown, string>[] = [];

        for (const field of table.getFields()) {
          if (projection && !projection.some((p) => p.toString() === field.id().toString())) {
            continue;
          }
          columns.push(yield* field.accept(visitor));
        }

        return ok(columns);
      }.bind(this)
    );
  }

  private buildLateralJoins(
    table: Table,
    foreignTables: ReadonlyMap<string, Table>,
    laterals: Map<
      string,
      {
        linkFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
        condition?: FieldCondition;
      }
    >
  ): Result<(qb: QB) => QB, DomainError> {
    if (laterals.size === 0) {
      return ok((qb) => qb);
    }

    return safeTry<(qb: QB) => QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const subqueries: AliasedExpression<Record<string, unknown>, string>[] = [];

        for (const [, lateral] of laterals) {
          const foreignTable = foreignTables.get(lateral.foreignTableId);
          if (!foreignTable) {
            return err(
              domainError.notFound({
                message: `Foreign table not found: ${lateral.foreignTableId}`,
              })
            );
          }

          const linkField = yield* table
            .getField((f): f is LinkField => f.id().equals(lateral.linkFieldId))
            .mapErr(() =>
              domainError.notFound({ message: `Link field not found: ${lateral.linkFieldId}` })
            );

          const foreignDbTableName = yield* foreignTable.dbTableName();
          const foreignTableName = yield* foreignDbTableName.value();

          const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
          for (const col of lateral.columns) {
            selectExprs.push(
              yield* this.buildLateralSelectExpr(foreignTable, col.columnType, col.outputAlias)
            );
          }

          const joinCondition = yield* this.getJoinCondition(linkField, foreignTableName);

          const filterWhere = yield* this.buildFilterConditionWhere(
            foreignTable,
            lateral.condition
          );

          let baseQuery = this.db
            .selectFrom(`${foreignTableName} as ${F}`)
            .select(selectExprs)
            .where(joinCondition);

          if (filterWhere !== null) {
            baseQuery = baseQuery.where(filterWhere);
          }

          subqueries.push(baseQuery.as(lateral.alias));
        }

        return ok((qb: QB) =>
          subqueries.reduce((q, sub) => q.innerJoinLateral(sub, (j) => j.onTrue()), qb)
        );
      }.bind(this)
    );
  }

  /**
   * Build lateral joins for conditional fields (conditionalRollup, conditionalLookup).
   *
   * Unlike link-based lateral joins that use FK relationships, conditional joins
   * use a condition filter to select which foreign records to aggregate.
   *
   * The generated SQL structure for each conditional field:
   * - conditionalRollup: LATERAL (SELECT AGG(col) FROM foreign_table WHERE <condition>)
   * - conditionalLookup: LATERAL (SELECT jsonb_agg(col) FROM foreign_table WHERE <condition>)
   */
  private buildConditionalJoins(
    foreignTables: ReadonlyMap<string, Table>,
    conditionalLaterals: Map<
      string,
      {
        conditionalFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
      }
    >
  ): Result<(qb: QB) => QB, DomainError> {
    if (conditionalLaterals.size === 0) {
      return ok((qb) => qb);
    }

    return safeTry<(qb: QB) => QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const subqueries: AliasedExpression<Record<string, unknown>, string>[] = [];

        for (const [, lateral] of conditionalLaterals) {
          const foreignTable = foreignTables.get(lateral.foreignTableId);
          if (!foreignTable) {
            return err(
              domainError.notFound({
                message: `Foreign table not found for conditional field: ${lateral.foreignTableId}`,
              })
            );
          }

          const foreignDbTableName = yield* foreignTable.dbTableName();
          const foreignTableName = yield* foreignDbTableName.value();

          const firstColumnType = lateral.columns[0]?.columnType;
          const condition = match(firstColumnType)
            .with({ type: 'conditionalLookup' }, (c) => c.condition)
            .with({ type: 'conditionalRollup' }, (c) => c.condition)
            .otherwise(() => undefined);

          // Build WHERE clause from condition filter
          const whereClause = yield* this.buildConditionWhere(foreignTable, firstColumnType);

          const sortClause = condition
            ? yield* this.resolveConditionalSort(foreignTable, condition)
            : null;
          const limitValue = condition?.limit();
          const isConditionalDerived =
            firstColumnType?.type === 'conditionalLookup' ||
            firstColumnType?.type === 'conditionalRollup';
          const defaultOrderBy = isConditionalDerived ? DEFAULT_CONDITIONAL_ORDER_BY : undefined;
          const orderByForSelect = sortClause ?? defaultOrderBy;
          const orderByForLimit =
            sortClause ??
            (limitValue !== undefined && isConditionalDerived
              ? DEFAULT_CONDITIONAL_ORDER_BY
              : null);
          const needsSubquery = Boolean(orderByForLimit || limitValue);
          const sourceAlias = needsSubquery ? `${lateral.alias}_src` : F;

          const selectExprs: AliasedRawBuilder<unknown, string>[] = [];
          for (const col of lateral.columns) {
            selectExprs.push(
              yield* this.buildConditionalSelectExpr(
                foreignTable,
                col.columnType,
                col.outputAlias,
                {
                  tableAlias: sourceAlias,
                  orderBy: orderByForSelect ?? undefined,
                }
              )
            );
          }

          const query = needsSubquery
            ? (() => {
                let baseQuery = this.db.selectFrom(`${foreignTableName} as ${F}`).selectAll();
                if (whereClause !== null) {
                  baseQuery = baseQuery.where(whereClause);
                }
                if (orderByForLimit !== null) {
                  baseQuery = baseQuery.orderBy(
                    sql.ref(`${F}.${orderByForLimit.column}`),
                    orderByForLimit.direction
                  );
                }
                if (limitValue !== undefined) {
                  baseQuery = baseQuery.limit(limitValue);
                }

                return this.db
                  .selectFrom(baseQuery.as(sourceAlias))
                  .select(selectExprs)
                  .as(lateral.alias);
              })()
            : (() => {
                let baseQuery = this.db
                  .selectFrom(`${foreignTableName} as ${F}`)
                  .select(selectExprs);
                if (whereClause !== null) {
                  baseQuery = baseQuery.where(whereClause);
                }
                return baseQuery.as(lateral.alias);
              })();

          subqueries.push(query);
        }

        return ok((qb: QB) =>
          subqueries.reduce((q, sub) => q.innerJoinLateral(sub, (j) => j.onTrue()), qb)
        );
      }.bind(this)
    );
  }

  /**
   * Build WHERE clause from FieldCondition for conditional field subqueries.
   *
   * Uses the visitor pattern to translate conditions to SQL.
   * This is the canonical way to handle conditions - all operator logic
   * is centralized in TableRecordConditionWhereVisitor.
   *
   * @returns null if no filter conditions, or a SQL expression for WHERE clause
   */
  private buildConditionWhere(
    foreignTable: Table,
    columnType: LateralColumnType | undefined
  ): Result<Expression<SqlBool> | null, DomainError> {
    if (!columnType) {
      return ok(null);
    }

    // Extract condition from column type
    const condition = match(columnType)
      .with({ type: 'conditionalLookup' }, (c) => c.condition)
      .with({ type: 'conditionalRollup' }, (c) => c.condition)
      .otherwise(() => undefined);

    return this.buildFilterConditionWhere(foreignTable, condition);
  }

  private buildFilterConditionWhere(
    foreignTable: Table,
    condition?: FieldCondition
  ): Result<Expression<SqlBool> | null, DomainError> {
    if (!condition || !condition.hasFilter()) {
      return ok(null);
    }

    const hostTable = this.table ?? undefined;
    return safeTry<Expression<SqlBool> | null, DomainError>(function* () {
      // For conditional lookups, pass the host table to resolve field references (isSymbol)
      const spec = yield* condition.toRecordConditionSpec(foreignTable, hostTable);
      if (!spec) {
        return ok(null);
      }

      // Pass hostTableAlias (T) so field references are resolved from the host table
      const visitor = new TableRecordConditionWhereVisitor({
        tableAlias: F,
        hostTableAlias: T,
      });
      const acceptResult = spec.accept(visitor);
      if (acceptResult.isErr()) {
        return err(acceptResult.error);
      }
      const whereResult = visitor.where();
      if (whereResult.isErr()) {
        return err(whereResult.error);
      }
      return ok(whereResult.value as unknown as Expression<SqlBool>);
    });
  }

  private resolveConditionalSort(
    foreignTable: Table,
    condition: FieldCondition
  ): Result<{ column: string; direction: 'asc' | 'desc' } | null, DomainError> {
    if (!condition.hasSort()) {
      return ok(null);
    }

    return safeTry<{ column: string; direction: 'asc' | 'desc' } | null, DomainError>(function* () {
      const sort = condition.sort();
      if (!sort) return ok(null);

      const field = yield* foreignTable.getField((f) => f.id().equals(sort.fieldId()));
      const dbFieldName = yield* field.dbFieldName();
      const column = yield* dbFieldName.value();
      return ok({ column, direction: sort.order() });
    });
  }

  private buildWhereCondition(): Result<Expression<SqlBool> | null, DomainError> {
    if (this.whereSpecs.length === 0) {
      return ok(null);
    }

    let combinedSpec = this.whereSpecs[0];
    for (let i = 1; i < this.whereSpecs.length; i += 1) {
      combinedSpec = new AndSpec(combinedSpec, this.whereSpecs[i]);
    }

    const visitor = new TableRecordConditionWhereVisitor({ tableAlias: T });
    const acceptResult = combinedSpec.accept(visitor);
    if (acceptResult.isErr()) {
      return err(acceptResult.error);
    }
    const whereResult = visitor.where();
    if (whereResult.isErr()) {
      return err(whereResult.error);
    }
    return ok(whereResult.value as unknown as Expression<SqlBool>);
  }

  /**
   * Build SELECT expression for conditional field columns.
   */
  private buildConditionalSelectExpr(
    foreignTable: Table,
    columnType: LateralColumnType,
    outputAlias: string,
    options?: {
      tableAlias?: string;
      orderBy?: { column: string; direction: 'asc' | 'desc' };
    }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    return (
      match(columnType)
        .with({ type: 'conditionalLookup' }, ({ foreignFieldId, isMultiValue }) => {
          // For conditional lookup, aggregate all matching values as a JSONB array.
          // Default to __auto_number ordering to preserve insertion order deterministically.
          const orderBy = options?.orderBy ?? DEFAULT_CONDITIONAL_ORDER_BY;
          return this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias, {
            tableAlias,
            orderBy,
            isMultiValue,
          });
        })
        .with({ type: 'conditionalRollup' }, ({ foreignFieldId, expression }) => {
          // For conditional rollup, apply the aggregate function.
          // Default to __auto_number to keep result ordering deterministic for order-sensitive rolls.
          const orderBy = options?.orderBy ?? DEFAULT_CONDITIONAL_ORDER_BY;
          return this.buildRollupAggregateExpr(foreignTable, foreignFieldId, expression, {
            tableAlias,
            orderBy,
          }).map((expr: RawBuilder<unknown>) => expr.as(outputAlias));
        })
        // Other types should not appear in conditional laterals
        .with({ type: 'link' }, () =>
          err(domainError.invariant({ message: 'link type should not be in conditional laterals' }))
        )
        .with({ type: 'lookup' }, () =>
          err(
            domainError.invariant({ message: 'lookup type should not be in conditional laterals' })
          )
        )
        .with({ type: 'rollup' }, () =>
          err(
            domainError.invariant({ message: 'rollup type should not be in conditional laterals' })
          )
        )
        .exhaustive()
    );
  }

  private buildLateralSelectExpr(
    foreignTable: Table,
    columnType: LateralColumnType,
    outputAlias: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return (
      match(columnType)
        .with({ type: 'link' }, ({ lookupFieldId, isMultiValue, orderBy }) =>
          foreignTable
            .getField((f) => f.id().equals(lookupFieldId))
            .andThen((field) =>
              field
                .dbFieldName()
                .andThen((dbFieldName) => dbFieldName.value())
                .map((columnName) => {
                  const columnRef = sql.ref(`${F}.${columnName}`);
                  const qualifiedRef = this.buildQualifiedRef(F, columnName);
                  const formattedSql = formatFieldValueAsStringSql(field, qualifiedRef);

                  // For JSON-stored fields (User, Attachment, etc.), extract the 'title' property
                  // Check if field is stored as JSON by checking dbFieldType
                  const dbFieldTypeResult = field.dbFieldType().andThen((t) => t.value());
                  const isJsonbStorage =
                    dbFieldTypeResult.isOk() && dbFieldTypeResult.value.toUpperCase() === 'JSON';

                  // Check if the field is a multi-value field that needs array-to-string conversion
                  const isMultiValueResult = field
                    .isMultipleCellValue()
                    .map((multiplicity) => multiplicity.isMultiple());
                  const isMultiValueField = isMultiValueResult.isOk() && isMultiValueResult.value;

                  let titleTextRef: RawBuilder<unknown>;
                  if (formattedSql) {
                    // Use formatted SQL if available (for Number/DateTime formatting)
                    titleTextRef = sql.raw(formattedSql);
                  } else if (isMultiValueField) {
                    // For multi-value fields (e.g., formula returning array like ['A'] or ['B', 'C']),
                    // convert JSONB array to comma-separated string
                    // This matches v1's formatStringArray behavior
                    const columnJson = sql`to_jsonb(${columnRef})`;
                    const normalizedColumnJson = sql`(CASE
                      WHEN ${columnRef} IS NULL THEN '[]'::jsonb
                      WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
                      WHEN jsonb_typeof(${columnJson}) = 'null' THEN '[]'::jsonb
                      ELSE jsonb_build_array(${columnJson})
                    END)`;
                    titleTextRef = sql`(
                      SELECT string_agg(
                        CASE
                          WHEN jsonb_typeof(elem) = 'object' THEN COALESCE(elem->>'title', elem->>'name', elem #>> '{}')
                          ELSE elem #>> '{}'
                        END,
                        ', '
                        ORDER BY ord
                      )
                      FROM jsonb_array_elements(${normalizedColumnJson}) WITH ORDINALITY AS t(elem, ord)
                    )`;
                  } else if (isJsonbStorage) {
                    // For JSON-stored fields, extract a display-friendly scalar
                    titleTextRef = sql.raw(extractJsonScalarText(qualifiedRef));
                  } else {
                    // Default: cast to text
                    titleTextRef = sql`(${columnRef})::text`;
                  }
                  // Build JSON object: {id: ..., title: ...}
                  const jsonObj = sql`jsonb_strip_nulls(jsonb_build_object('id', ${sql.ref(`${F}.__id`)}, 'title', ${titleTextRef}))`;

                  // CRITICAL FIX: If multi-value and orderBy is undefined, provide default ordering
                  // This ensures OneMany foreign-based links get proper __id ordering
                  const effectiveOrderBy =
                    isMultiValue && !orderBy
                      ? ({ source: 'foreign' as const, column: undefined } as LinkOrderBy)
                      : orderBy;
                  const orderByExpr = buildLinkOrderByExpr(effectiveOrderBy);

                  if (isMultiValue) {
                    // Multi-value: aggregate as JSON array
                    // Use jsonb_agg to get JSONB type which is more efficient for storage and indexing
                    return orderByExpr
                      ? sql`jsonb_agg(${jsonObj} ORDER BY ${orderByExpr})`.as(outputAlias)
                      : sql`jsonb_agg(${jsonObj})`.as(outputAlias);
                  } else {
                    // Single value: return single object (use first match)
                    // Must use jsonb_agg (not json_agg) because only JSONB supports subscript [0] access
                    return orderByExpr
                      ? sql`(jsonb_agg(${jsonObj} ORDER BY ${orderByExpr}))[0]`.as(outputAlias)
                      : sql`(jsonb_agg(${jsonObj}))[0]`.as(outputAlias);
                  }
                })
            )
        )
        .with({ type: 'lookup' }, ({ foreignFieldId, orderBy, isMultiValue }) =>
          this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias, {
            orderBy,
            isMultiValue,
          })
        )
        .with({ type: 'rollup' }, ({ foreignFieldId, expression, orderBy }) =>
          this.buildRollupAggregateExpr(foreignTable, foreignFieldId, expression, {
            orderBy,
          }).map((expr: RawBuilder<unknown>) => expr.as(outputAlias))
        )
        // Conditional types are handled in buildConditionalJoins, not here
        .with({ type: 'conditionalLookup' }, () =>
          err(
            domainError.invariant({
              message: 'conditionalLookup should be handled in buildConditionalJoins',
            })
          )
        )
        .with({ type: 'conditionalRollup' }, () =>
          err(
            domainError.invariant({
              message: 'conditionalRollup should be handled in buildConditionalJoins',
            })
          )
        )
        .exhaustive()
    );
  }

  private buildQualifiedRef(tableAlias: string, columnName: string): string {
    const escapeIdentifier = (value: string): string => value.replace(/"/g, '""');
    return `"${escapeIdentifier(tableAlias)}"."${escapeIdentifier(columnName)}"`;
  }

  private getForeignColRef(
    foreignTable: Table,
    foreignFieldId: FieldId,
    tableAlias: string = F
  ): Result<RawBuilder<unknown>, DomainError> {
    return foreignTable
      .getField((f) => f.id().equals(foreignFieldId))
      .andThen((field) =>
        field
          .dbFieldName()
          .andThen((dbFieldName) => dbFieldName.value())
          .map((columnName) => sql`${sql.ref(`${tableAlias}.${columnName}`)}`)
      );
  }

  /**
   * Build lookup aggregation expression.
   *
   * For lookup fields that reference already-JSONB columns (like other lookup fields),
   * we need to handle nested arrays to avoid double-encoding.
   *
   * V1 approach (flattenLookupCteValue):
   * - For JSONB: Cast to jsonb (not to_jsonb) and flatten nested arrays
   * - Uses WITH RECURSIVE to unwrap all nested array levels
   *
   * Example: if B.ValueFromA = [10] and we link to one B record:
   * - With to_jsonb: jsonb_agg(to_jsonb([10])) = ["[10]"] (WRONG - string)
   * - With ::jsonb: jsonb_agg([10]::jsonb) = [[10]] (nested array)
   * - With flatten: [10] (correct - flattened)
   */
  private buildLookupAggExpr(
    foreignTable: Table,
    foreignFieldId: FieldId,
    outputAlias: string,
    options?: {
      tableAlias?: string;
      orderBy?: LinkOrderBy | { column: string; direction: 'asc' | 'desc' };
      isMultiValue?: boolean;
    }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    const orderBy = options?.orderBy;
    const isMultiValue = options?.isMultiValue ?? true;
    return foreignTable
      .getField((f) => f.id().equals(foreignFieldId))
      .andThen((foreignField) =>
        foreignField
          .dbFieldName()
          .andThen((dbFieldName) => dbFieldName.value())
          .andThen((columnName) => {
            const colRef = sql.ref(`${tableAlias}.${columnName}`);
            // Build orderBy expression - handle both LinkOrderBy and simple format
            const orderByExpr = orderBy
              ? 'source' in orderBy
                ? buildLinkOrderByExpr(orderBy)
                : sql`${sql.ref(`${tableAlias}.${orderBy.column}`)} ${sql.raw(orderBy.direction)}`
              : null;
            // Include leading space in orderByRef so no trailing space when empty
            const orderByRef = orderByExpr ? sql` order by ${orderByExpr}` : sql``;

            // Check if the foreign field actually stores data as JSONB by checking dbFieldType
            // Don't assume lookup/link fields are always JSONB - they might be TEXT if looking up text values
            const dbFieldTypeResult = foreignField.dbFieldType().andThen((t) => t.value());
            const isJsonbStorage =
              dbFieldTypeResult.isOk() && dbFieldTypeResult.value.toUpperCase() === 'JSON';

            if (isJsonbStorage) {
              // For JSONB columns, use ::jsonb cast and then flatten nested arrays.
              //
              // V1 uses a post-aggregation flattening CTE. We implement this as:
              // 1. First aggregate: jsonb_agg(col::jsonb)
              // 2. Then apply recursive flattening to unwrap nested arrays
              //
              // The recursive CTE extracts all non-array leaf values.
              const aggExpr = sql`jsonb_agg(${colRef}::jsonb${orderByRef}) FILTER (WHERE ${colRef} IS NOT NULL)`;
              const flattenedExpr = sql`(
                WITH RECURSIVE __flat(e) AS (
                  SELECT ${aggExpr}
                  UNION ALL
                  SELECT jsonb_array_elements(
                    CASE
                      WHEN jsonb_typeof(__flat.e) = 'array' THEN __flat.e
                      ELSE '[]'::jsonb
                    END
                  )
                  FROM __flat
                )
                SELECT jsonb_agg(e) FILTER (WHERE jsonb_typeof(e) <> 'array') FROM __flat
              )`;

              return ok(
                isMultiValue
                  ? sql`${flattenedExpr}`.as(outputAlias)
                  : sql`${flattenedExpr} -> 0`.as(outputAlias)
              );
            }

            // For regular columns, use to_jsonb() to convert to JSONB
            const aggExpr = sql`jsonb_agg(to_jsonb(${colRef})${orderByRef}) FILTER (WHERE ${colRef} IS NOT NULL)`;
            return ok(
              isMultiValue ? aggExpr.as(outputAlias) : sql`${aggExpr} -> 0`.as(outputAlias)
            );
          })
      );
  }

  private buildRollupAggregateExpr(
    foreignTable: Table,
    foreignFieldId: FieldId,
    expression: RollupFunction,
    options?: {
      tableAlias?: string;
      orderBy?: LinkOrderBy | { column: string; direction: 'asc' | 'desc' };
    }
  ): Result<RawBuilder<unknown>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    const orderByExpr = options?.orderBy
      ? 'source' in options.orderBy
        ? buildLinkOrderByExpr(options.orderBy)
        : sql`${sql.ref(`${tableAlias}.${options.orderBy.column}`)} ${sql.raw(
            options.orderBy.direction
          )}`
      : null;
    const orderBySql = orderByExpr ? sql` ORDER BY ${orderByExpr}` : sql``;

    return safeTry<RawBuilder<unknown>, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const foreignField = yield* foreignTable.getField((f) => f.id().equals(foreignFieldId));
        const colRef = yield* this.getForeignColRef(foreignTable, foreignFieldId, tableAlias);
        const valueType = yield* foreignField.accept(new FieldValueTypeVisitor());
        const isNumericTarget = valueType.cellValueType.equals(CellValueType.number());
        const isMultipleValue = valueType.isMultipleCellValue.isMultiple();
        const rowPresenceExpr = sql.ref(`${tableAlias}.__id`);

        switch (expression) {
          case 'sum({values})': {
            if (isNumericTarget) {
              if (isMultipleValue) {
                const numericExpr = this.buildJsonNumericSumExpression(colRef);
                return ok(this.castAgg(sql`COALESCE(SUM(${numericExpr}), 0)`));
              }
              return ok(this.castAgg(sql`COALESCE(SUM(${colRef}), 0)`));
            }
            return ok(this.castAgg(sql`SUM(0)`));
          }
          case 'average({values})': {
            if (isNumericTarget) {
              if (isMultipleValue) {
                const sumExpr = this.buildJsonNumericSumExpression(colRef);
                const countExpr = this.buildJsonNumericCountExpression(colRef);
                const sumAgg = sql`COALESCE(SUM(${sumExpr}), 0)`;
                const countAgg = sql`COALESCE(SUM(${countExpr}), 0)`;
                return ok(
                  this.castAgg(
                    sql`CASE WHEN ${countAgg} = 0 THEN 0 ELSE ${sumAgg} / ${countAgg} END`
                  )
                );
              }
              return ok(this.castAgg(sql`COALESCE(AVG(${colRef}), 0)`));
            }
            return ok(this.castAgg(sql`AVG(0)`));
          }
          case 'countall({values})': {
            if (foreignField.type().equals(FieldType.multipleSelect())) {
              return ok(
                this.castAgg(
                  sql`COALESCE(SUM(CASE WHEN ${colRef} IS NOT NULL THEN jsonb_array_length(${colRef}::jsonb) ELSE 0 END), 0)`
                )
              );
            }
            return ok(this.castAgg(sql`COALESCE(COUNT(${rowPresenceExpr}), 0)`));
          }
          case 'counta({values})':
          case 'count({values})':
            return ok(this.castAgg(sql`COALESCE(COUNT(${colRef}), 0)`));
          case 'max({values})': {
            const aggregate = sql`MAX(${colRef})`;
            return ok(
              valueType.cellValueType.equals(CellValueType.dateTime())
                ? aggregate
                : this.castAgg(aggregate)
            );
          }
          case 'min({values})': {
            const aggregate = sql`MIN(${colRef})`;
            return ok(
              valueType.cellValueType.equals(CellValueType.dateTime())
                ? aggregate
                : this.castAgg(aggregate)
            );
          }
          case 'and({values})':
            return ok(sql`BOOL_AND(${colRef}::boolean)`);
          case 'or({values})':
            return ok(sql`BOOL_OR(${colRef}::boolean)`);
          case 'xor({values})':
            return ok(sql`(COUNT(CASE WHEN ${colRef}::boolean THEN 1 END) % 2 = 1)`);
          case 'array_join({values})':
          case 'concatenate({values})': {
            const columnName = yield* foreignField
              .dbFieldName()
              .andThen((dbFieldName) => dbFieldName.value());
            const qualifiedRef = this.buildQualifiedRef(tableAlias, columnName);
            const shouldUseFormatted =
              foreignField.type().equals(FieldType.formula()) ||
              foreignField.type().equals(FieldType.conditionalRollup());
            const formattedSql = shouldUseFormatted
              ? formatFieldValueAsStringSql(foreignField, qualifiedRef)
              : undefined;
            return ok(
              sql`STRING_AGG(${formattedSql ? sql.raw(formattedSql) : sql`${colRef}::text`}, ', '${orderBySql})`
            );
          }
          case 'array_unique({values})':
            return ok(sql`json_agg(DISTINCT ${colRef})`);
          case 'array_compact({values})': {
            const baseAggregate = orderByExpr
              ? sql`jsonb_agg(${colRef} ORDER BY ${orderByExpr}) FILTER (WHERE (${colRef}) IS NOT NULL AND (${colRef})::text <> '')`
              : sql`jsonb_agg(${colRef}) FILTER (WHERE (${colRef}) IS NOT NULL AND (${colRef})::text <> '')`;
            if (isMultipleValue) {
              return ok(sql`(
              WITH RECURSIVE flattened(val) AS (
                SELECT COALESCE(${baseAggregate}, '[]'::jsonb)
                UNION ALL
                SELECT elem
                FROM flattened
                CROSS JOIN LATERAL jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(flattened.val) = 'array' THEN flattened.val
                    ELSE '[]'::jsonb
                  END
                ) AS elem
              )
              SELECT jsonb_agg(val) FILTER (
                WHERE jsonb_typeof(val) <> 'array'
                  AND jsonb_typeof(val) <> 'null'
                  AND val <> '""'::jsonb
              ) FROM flattened
            )`);
            }
            return ok(baseAggregate);
          }
          default:
            return ok(sql`ARRAY_AGG(${colRef})`);
        }
      }.bind(this)
    );
  }

  private sanitizeNumericTextExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    return sql`NULLIF(REGEXP_REPLACE((${expr})::text, '[^0-9.+-]', '', 'g'), '')::double precision`;
  }

  private buildJsonNumericSumExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const safeArrayExpr = sql`(CASE
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN ${expr}::jsonb
      ELSE '[]'::jsonb
    END)`;
    const arraySum = sql`(
      SELECT SUM(${this.sanitizeNumericTextExpression(sql`elem.value`)})
      FROM jsonb_array_elements_text(${safeArrayExpr}) AS elem(value)
    )`;
    return sql`(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${arraySum}, 0)
      ELSE COALESCE(${scalarValue}, 0)
    END)`;
  }

  private buildJsonNumericCountExpression(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    const scalarValue = this.sanitizeNumericTextExpression(expr);
    const scalarCount = sql`(CASE WHEN ${scalarValue} IS NULL THEN 0 ELSE 1 END)`;
    const safeArrayExpr = sql`(CASE
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN ${expr}::jsonb
      ELSE '[]'::jsonb
    END)`;
    const elementCount = sql`(
      SELECT SUM(CASE WHEN ${this.sanitizeNumericTextExpression(sql`elem.value`)} IS NULL THEN 0 ELSE 1 END)
      FROM jsonb_array_elements_text(${safeArrayExpr}) AS elem(value)
    )`;
    return sql`(CASE
      WHEN ${expr} IS NULL THEN 0
      WHEN jsonb_typeof(${expr}::jsonb) = 'array' THEN COALESCE(${elementCount}, 0)
      ELSE ${scalarCount}
    END)`;
  }

  private castAgg(expr: RawBuilder<unknown>): RawBuilder<unknown> {
    return sql`CAST(${expr} AS DOUBLE PRECISION)`;
  }

  /**
   * Build join condition based on relationship type.
   *
   * FK config meanings from LinkFieldConfig.buildDbConfig:
   * - manyOne/oneOne: selfKeyName='__id', foreignKeyName='__fk_{fieldId}' (FK in current table)
   *   → join: f.__id = t.{foreignKeyName}
   * - oneMany: selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id' (FK in foreign table)
   *   → join: f.{selfKeyName} = t.__id
   * - manyMany: both keys point to junction table columns
   *   → join via junction table
   */
  private getJoinCondition(
    linkField: LinkField,
    _foreignTableName: string
  ): Result<Expression<SqlBool>, DomainError> {
    const relationship = linkField.relationship();
    const isOneWay = linkField.isOneWay();
    const selfKeyNameResult = linkField.selfKeyName().value();
    const foreignKeyNameResult = linkField.foreignKeyName().value();

    // manyOne/oneOne: current table has FK pointing to foreign table's __id
    // selfKeyName='__id', foreignKeyName='__fk_{fieldId}'
    // join: f.__id = t.{foreignKeyName}
    if (
      relationship.equals(LinkRelationship.manyOne()) ||
      relationship.equals(LinkRelationship.oneOne())
    ) {
      if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${F}.__id`)} = ${sql.ref(`${T}.${foreignKeyNameResult.value}`)}`
        );
      }
      // Fallback for symmetric oneOne where foreign table holds FK
      if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${F}.${selfKeyNameResult.value}`)} = ${sql.ref(`${T}.__id`)}`
        );
      }
    }

    // oneMany: foreign table has FK pointing to this table's __id
    // selfKeyName='__fk_{symmetricFieldId}', foreignKeyName='__id'
    // join: f.{selfKeyName} = t.__id
    if (relationship.equals(LinkRelationship.oneMany()) && !isOneWay) {
      if (selfKeyNameResult.isOk() && selfKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${F}.${selfKeyNameResult.value}`)} = ${sql.ref(`${T}.__id`)}`
        );
      }
      // Fallback
      if (foreignKeyNameResult.isOk() && foreignKeyNameResult.value !== '__id') {
        return ok(
          sql<SqlBool>`${sql.ref(`${F}.__id`)} = ${sql.ref(`${T}.${foreignKeyNameResult.value}`)}`
        );
      }
    }

    // manyMany: use junction table
    // SELECT ... FROM foreign_table f
    // WHERE f.__id IN (SELECT j.foreignKeyName FROM junction_table j WHERE j.selfKeyName = t.__id)
    if (
      relationship.equals(LinkRelationship.manyMany()) ||
      (relationship.equals(LinkRelationship.oneMany()) && isOneWay)
    ) {
      const fkHostTableNameResult = linkField.fkHostTableName().value();
      if (fkHostTableNameResult.isOk() && selfKeyNameResult.isOk() && foreignKeyNameResult.isOk()) {
        const junctionTable = fkHostTableNameResult.value;
        const selfKey = selfKeyNameResult.value;
        const foreignKey = foreignKeyNameResult.value;

        // f.__id IN (SELECT j.foreignKey FROM junction j WHERE j.selfKey = t.__id)
        return ok(
          sql<SqlBool>`${sql.ref(`${F}.__id`)} IN (SELECT ${sql.ref(`j.${foreignKey}`)} FROM ${sql.table(junctionTable)} AS j WHERE ${sql.ref(`j.${selfKey}`)} = ${sql.ref(`${T}.__id`)})`
        );
      }
    }

    return err(
      domainError.validation({
        message: `Cannot build join condition for link field: missing FK configuration`,
      })
    );
  }

  /**
   * Resolve orderBy column to actual database column name.
   * If FieldId, look up the field's dbFieldName.
   * If system column string, use as-is.
   */
  private resolveOrderByColumn(
    table: Table,
    orderByColumn: OrderByColumn
  ): Result<string | null, DomainError> {
    // If it's a FieldId, resolve to dbFieldName
    if (orderByColumn instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(orderByColumn as FieldId))
        .andThen((field) => {
          const fieldType = field.type();
          if (fieldType.equals(FieldType.createdTime())) return ok('__created_time');
          if (fieldType.equals(FieldType.lastModifiedTime())) return ok('__last_modified_time');
          if (fieldType.equals(FieldType.createdBy())) return ok('__created_by');
          if (fieldType.equals(FieldType.lastModifiedBy())) return ok('__last_modified_by');
          if (fieldType.equals(FieldType.autoNumber())) return ok('__auto_number');
          return field.dbFieldName().andThen((dbFieldName) => dbFieldName.value());
        });
    }

    // System column - use as-is
    return ok(orderByColumn);
  }
}

const buildLinkOrderByExpr = (orderBy?: LinkOrderBy): RawBuilder<unknown> | null => {
  if (!orderBy) return null;

  if (orderBy.source === 'foreign') {
    // If explicit order column exists, use it with __auto_number as tie-breaker
    if (orderBy.column) {
      return sql`${sql.ref(`${F}.${orderBy.column}`)}, ${sql.ref(`${F}.__auto_number`)}`;
    }
    // No explicit order column - use __auto_number to maintain insertion/creation order
    // Foreign tables (regular data tables) have __auto_number column that reflects creation order
    // This is critical for tests that expect stable ordering based on record creation time
    return sql`${sql.ref(`${F}.__auto_number`)}`;
  }

  // Junction-based ordering (ManyMany, OneMany one-way)
  if (orderBy.column) {
    // Explicit order column exists - use it with junction __id as tie-breaker
    // This ensures stable ordering when multiple records have the same order value
    return sql`(SELECT ${sql.ref(`j.${orderBy.column}`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${F}.__id`)}), (SELECT ${sql.ref(`j.__id`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${F}.__id`)})`;
  }

  // No explicit order column - use junction table's __id to maintain insertion order
  // Junction tables only have __id (serial), not __auto_number
  // This is critical for tests that expect stable ordering based on link creation order
  return sql`(SELECT ${sql.ref(`j.__id`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${F}.__id`)})`;
};
