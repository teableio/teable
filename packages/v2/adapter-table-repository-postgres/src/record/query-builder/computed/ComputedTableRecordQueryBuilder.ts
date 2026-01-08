import {
  AndSpec,
  domainError,
  FieldId,
  FieldType,
  LinkForeignTableReferenceVisitor,
  LinkRelationship,
  type DomainError,
  type FieldCondition,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type LinkField,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
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

export interface IComputedQueryBuilderOptions {
  /** Foreign tables for link/lookup/rollup - can be pre-set (for tests) or loaded via prepare() */
  readonly foreignTables?: ReadonlyMap<string, Table>;
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
  private orderByColumnValue: OrderByColumn | null = null;
  private orderByDirection: 'asc' | 'desc' = 'asc';
  private foreignTables: ReadonlyMap<string, Table>;
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];

  readonly mode: QueryMode = 'computed';

  constructor(
    private readonly db: Kysely<DynamicDB>,
    options?: IComputedQueryBuilderOptions
  ) {
    this.foreignTables = options?.foreignTables ?? new Map();
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
    this.orderByColumnValue = column;
    this.orderByDirection = direction;
    return this;
  }

  where(spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>): this {
    this.whereSpecs.push(spec);
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
            return err(
              domainError.notFound({
                code: 'foreign_table.not_found',
                message: `Foreign tables not found: ${missingIds.map((id) => id.toString()).join(', ')}`,
              })
            );
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
        const selectColumns = [idColumn, ...fieldSelectColumns];

        // Resolve orderBy column name
        const orderByColumn = yield* this.resolveOrderByColumn(table);

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;
        const query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => selectColumns)
          .$call(applyLateralJoins)
          .$call(applyConditionalJoins)
          .$if(whereClause !== null, (qb) =>
            qb.where(whereClause as unknown as Expression<SqlBool>)
          )
          .$if(orderByColumn !== null, (qb) =>
            qb.orderBy(sql`${sql.ref(`${T}.${orderByColumn}`)}`, this.orderByDirection)
          )
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));
        return ok(query);
      }.bind(this)
    );
  }

  private createLateralContext() {
    // Link-based laterals (keyed by linkFieldId)
    const laterals = new Map<
      string,
      {
        linkFieldId: FieldId;
        alias: string;
        foreignTableId: string;
        columns: Array<{ outputAlias: string; columnType: LateralColumnType }>;
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

    const ctx: ILateralContext = {
      addColumn(linkFieldId, foreignTableId, outputAlias, columnType) {
        const key = linkFieldId.toString();
        if (!laterals.has(key)) {
          laterals.set(key, { linkFieldId, alias: `lat_${key}`, foreignTableId, columns: [] });
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
    return safeTry(function* () {
      const visitor = new ComputedFieldSelectExpressionVisitor(table, T, lateralCtx);
      const columns: AliasedRawBuilder<unknown, string>[] = [];

      for (const field of table.getFields()) {
        if (projection && !projection.some((p) => p.toString() === field.id().toString())) {
          continue;
        }
        columns.push(yield* field.accept(visitor));
      }

      return ok(columns);
    });
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

          subqueries.push(
            this.db
              .selectFrom(`${foreignTableName} as ${F}`)
              .select(selectExprs)
              .where(joinCondition)
              .as(lateral.alias)
          );
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
          const needsSubquery = Boolean(sortClause || limitValue);
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
                  orderBy: sortClause ?? undefined,
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
                if (sortClause !== null) {
                  baseQuery = baseQuery.orderBy(
                    sql.ref(`${F}.${sortClause.column}`),
                    sortClause.direction
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

    if (!condition || !condition.hasFilter()) {
      return ok(null);
    }

    return safeTry<Expression<SqlBool> | null, DomainError>(function* () {
      // Convert FieldCondition to RecordConditionSpec using the canonical pattern
      const spec = yield* condition.toRecordConditionSpec(foreignTable);

      if (!spec) {
        return ok(null);
      }

      // Use the visitor pattern to translate spec to SQL WHERE clause
      // Pass 'f' as the table alias since lateral join subqueries use 'f' for foreign table
      const visitor = new TableRecordConditionWhereVisitor({ tableAlias: F });
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
        .with({ type: 'conditionalLookup' }, ({ foreignFieldId }) =>
          // For conditional lookup, aggregate all matching values as a JSONB array
          this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias, {
            tableAlias,
            orderBy: options?.orderBy,
          })
        )
        .with({ type: 'conditionalRollup' }, ({ foreignFieldId, aggregate }) =>
          // For conditional rollup, apply the aggregate function
          this.getForeignColRef(foreignTable, foreignFieldId, tableAlias).map((colRef) =>
            sql`${sql.raw(aggregate)}(${colRef})`.as(outputAlias)
          )
        )
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
          this.getForeignColRef(foreignTable, lookupFieldId).map((titleRef) => {
            // Build JSON object: {id: ..., title: ...}
            const jsonObj = sql`jsonb_strip_nulls(jsonb_build_object('id', ${sql.ref(`${F}.__id`)}, 'title', ${titleRef}))`;
            const orderByExpr = buildLinkOrderByExpr(orderBy);
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
        .with({ type: 'lookup' }, ({ foreignFieldId }) =>
          this.buildLookupAggExpr(foreignTable, foreignFieldId, outputAlias)
        )
        .with({ type: 'rollup' }, ({ foreignFieldId, aggregate }) =>
          this.getForeignColRef(foreignTable, foreignFieldId).map((colRef) =>
            sql`${sql.raw(aggregate)}(${colRef})`.as(outputAlias)
          )
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
    options?: { tableAlias?: string; orderBy?: { column: string; direction: 'asc' | 'desc' } }
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    const tableAlias = options?.tableAlias ?? F;
    const orderBy = options?.orderBy;
    return foreignTable
      .getField((f) => f.id().equals(foreignFieldId))
      .andThen((foreignField) =>
        foreignField
          .dbFieldName()
          .andThen((dbFieldName) => dbFieldName.value())
          .map((columnName) => {
            const colRef = sql.ref(`${tableAlias}.${columnName}`);
            // Include leading space in orderByRef so no trailing space when empty
            const orderByRef = orderBy
              ? sql` order by ${sql.ref(`${tableAlias}.${orderBy.column}`)} ${sql.raw(
                  orderBy.direction
                )}`
              : sql``;

            // Check if the foreign field stores data as JSONB (lookup, link)
            // These fields already contain JSONB arrays and should not be wrapped with to_jsonb()
            const isJsonbStorage =
              foreignField.type().equals(FieldType.lookup()) ||
              foreignField.type().equals(FieldType.link());

            if (isJsonbStorage) {
              // For JSONB columns, use ::jsonb cast and then flatten nested arrays.
              //
              // V1 uses a post-aggregation flattening CTE. We implement this as:
              // 1. First aggregate: jsonb_agg(col::jsonb)
              // 2. Then apply recursive flattening to unwrap nested arrays
              //
              // The recursive CTE extracts all non-array leaf values.
              const aggExpr = sql`jsonb_agg(${colRef}::jsonb${orderByRef})`;

              return sql`(
                WITH RECURSIVE __flat(e) AS (
                  SELECT ${aggExpr}
                  UNION ALL
                  SELECT jsonb_array_elements(__flat.e)
                  FROM __flat
                  WHERE jsonb_typeof(__flat.e) = 'array'
                )
                SELECT jsonb_agg(e) FILTER (WHERE jsonb_typeof(e) <> 'array') FROM __flat
              )`.as(outputAlias);
            }

            // For regular columns, use to_jsonb() to convert to JSONB
            return sql`jsonb_agg(to_jsonb(${colRef})${orderByRef})`.as(outputAlias);
          })
      );
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
  private resolveOrderByColumn(table: Table): Result<string | null, DomainError> {
    if (this.orderByColumnValue === null) {
      return ok(null);
    }

    // If it's a FieldId, resolve to dbFieldName
    if (this.orderByColumnValue instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(this.orderByColumnValue as FieldId))
        .andThen((field) => field.dbFieldName())
        .andThen((dbFieldName) => dbFieldName.value());
    }

    // System column - use as-is
    return ok(this.orderByColumnValue);
  }
}

const buildLinkOrderByExpr = (orderBy?: LinkOrderBy): RawBuilder<unknown> | null => {
  if (!orderBy) return null;
  if (orderBy.source === 'foreign') {
    return sql`${sql.ref(`${F}.${orderBy.column}`)}`;
  }
  return sql`(SELECT ${sql.ref(`j.${orderBy.column}`)} FROM ${sql.table(orderBy.junctionTable)} AS j WHERE ${sql.ref(`j.${orderBy.selfKey}`)} = ${sql.ref(`${T}.__id`)} AND ${sql.ref(`j.${orderBy.foreignKey}`)} = ${sql.ref(`${F}.__id`)})`;
};
