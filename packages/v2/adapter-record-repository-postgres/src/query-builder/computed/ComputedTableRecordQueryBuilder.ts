import {
  domainError,
  FieldId,
  isNotFoundError,
  LinkForeignTableReferenceVisitor,
  LinkRelationship,
  type DomainError,
  type LinkField,
  type Table,
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

import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import {
  ComputedFieldSelectExpressionVisitor,
  type ILateralContext,
  type LateralColumnType,
} from './ComputedFieldSelectExpressionVisitor';
import { QueryMode } from '../TableRecordQueryBuilderManager';

const T = 't'; // main table alias
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
  private projection: FieldId[] | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private orderByColumnValue: OrderByColumn | null = null;
  private orderByDirection: 'asc' | 'desc' = 'asc';
  private foreignTables: ReadonlyMap<string, Table>;

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

  select(projection: FieldId[]): this {
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
    const { laterals, ctx: lateralCtx } = this.createLateralContext();

    return safeTry<QB, DomainError>(
      function* (this: ComputedTableRecordQueryBuilder) {
        const dbTableName = yield* table.dbTableName();
        const tableName = yield* dbTableName.value();

        const fieldSelectColumns = yield* this.buildSelectColumns(table, projection, lateralCtx);
        const applyLateralJoins = yield* this.buildLateralJoins(table, foreignTables, laterals);

        // Always include __id column for record identification
        const idColumn = sql`${sql.ref(`${T}.__id`)}`.as('__id');
        const selectColumns = [idColumn, ...fieldSelectColumns];

        // Resolve orderBy column name
        const orderByColumn = yield* this.resolveOrderByColumn(table);

        const query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => selectColumns)
          .$call(applyLateralJoins)
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
    const laterals = new Map<
      string,
      {
        linkFieldId: FieldId;
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
        laterals.get(key)!.columns.push({ outputAlias, columnType });
        return laterals.get(key)!.alias;
      },
    };

    return { laterals, ctx };
  }

  private buildSelectColumns(
    table: Table,
    projection: FieldId[] | null,
    lateralCtx: ILateralContext
  ): Result<AliasedRawBuilder<unknown, string>[], DomainError> {
    return safeTry(function* () {
      const visitor = new ComputedFieldSelectExpressionVisitor(T, lateralCtx);
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

  private buildLateralSelectExpr(
    foreignTable: Table,
    columnType: LateralColumnType,
    outputAlias: string
  ): Result<AliasedRawBuilder<unknown, string>, DomainError> {
    return match(columnType)
      .with({ type: 'link' }, ({ lookupFieldId, isMultiValue }) =>
        this.getForeignColRef(foreignTable, lookupFieldId).map((titleRef) => {
          // Build JSON object: {id: ..., title: ...}
          const jsonObj = sql`jsonb_strip_nulls(jsonb_build_object('id', ${sql.ref(`${F}.__id`)}, 'title', ${titleRef}))`;
          if (isMultiValue) {
            // Multi-value: aggregate as JSON array
            return sql`json_agg(${jsonObj})`.as(outputAlias);
          } else {
            // Single value: return single object (use first match)
            return sql`(json_agg(${jsonObj}))[0]`.as(outputAlias);
          }
        })
      )
      .with({ type: 'lookup' }, ({ foreignFieldId }) =>
        this.getForeignColRef(foreignTable, foreignFieldId).map((colRef) =>
          sql`ARRAY_AGG(${colRef})`.as(outputAlias)
        )
      )
      .with({ type: 'rollup' }, ({ foreignFieldId, aggregate }) =>
        this.getForeignColRef(foreignTable, foreignFieldId).map((colRef) =>
          sql`${sql.raw(aggregate)}(${colRef})`.as(outputAlias)
        )
      )
      .exhaustive();
  }

  private getForeignColRef(
    foreignTable: Table,
    foreignFieldId: FieldId
  ): Result<RawBuilder<unknown>, DomainError> {
    return foreignTable
      .getField((f) => f.id().equals(foreignFieldId))
      .andThen((field) =>
        field
          .dbFieldName()
          .andThen((dbFieldName) => dbFieldName.value())
          .map((columnName) => sql`${sql.ref(`${F}.${columnName}`)}`)
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
    if (relationship.equals(LinkRelationship.oneMany())) {
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
    if (relationship.equals(LinkRelationship.manyMany())) {
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
