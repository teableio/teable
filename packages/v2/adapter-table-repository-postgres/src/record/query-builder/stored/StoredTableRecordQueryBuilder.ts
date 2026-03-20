import {
  AndSpec,
  domainError,
  FieldId,
  FieldType,
  type DomainError,
  type ITableRecordConditionSpecVisitor,
  type ISpecification,
  type Table,
  type TableRecord,
} from '@teable/v2-core';
import {
  sql,
  type AliasedRawBuilder,
  type Expression,
  type Kysely,
  type RawBuilder,
  type SqlBool,
} from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok, safeTry } from 'neverthrow';

import { TableRecordConditionWhereVisitor } from '../../visitors';
import { buildDateLikeOrderExpression } from '../dateLikeOrderBy';
import type {
  DynamicDB,
  IQueryBuilderDeps,
  ITableRecordQueryBuilder,
  OrderByColumn,
  QB,
} from '../ITableRecordQueryBuilder';
import type { QueryMode } from '../TableRecordQueryBuilderManager';
import { StoredFieldSelectVisitor } from './StoredFieldSelectVisitor';

const T = 't'; // main table alias

type ResolvedOrderBy = {
  column: string;
  direction: 'asc' | 'desc';
  expression?: RawBuilder<unknown>;
  userLikeMode?: 'single' | 'multiple';
  userLikeSource?: 'field' | 'system';
  selectChoiceMode?: 'single' | 'multiple';
  selectChoiceOrder?: ReadonlyArray<string>;
};

export interface IStoredQueryBuilderOptions {
  sourceTableName?: string;
}

/**
 * Query builder that selects all stored column values directly.
 * No LATERAL joins, no formula computation - just raw column selection.
 * Used for fast reads when pre-computed values are acceptable.
 */
export class StoredTableRecordQueryBuilder implements ITableRecordQueryBuilder {
  private table: Table | null = null;
  private projection: ReadonlyArray<FieldId> | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private orderByValues: Array<{ column: OrderByColumn; direction: 'asc' | 'desc' }> = [];
  private whereSpecs: Array<ISpecification<TableRecord, ITableRecordConditionSpecVisitor>> = [];
  private readonly sourceTableName?: string;

  readonly mode: QueryMode = 'stored';

  constructor(
    private readonly db: Kysely<DynamicDB>,
    options?: IStoredQueryBuilderOptions
  ) {
    this.sourceTableName = options?.sourceTableName;
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
   * No preparation needed for stored builder - reads pre-stored values.
   */
  async prepare(_deps: IQueryBuilderDeps): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  build(): Result<QB, DomainError> {
    if (!this.table) {
      return err(domainError.validation({ message: 'Call from() first' }));
    }

    const table = this.table;
    const projection = this.projection;

    return safeTry<QB, DomainError>(
      function* (this: StoredTableRecordQueryBuilder) {
        const dbTableName = yield* table.dbTableName();
        const tableName = this.sourceTableName ?? (yield* dbTableName.value());

        const selectColumns = yield* this.buildSelectColumns(table, projection);

        // Always include __id column for record identification
        const idColumn = sql`${sql.ref(`${T}.__id`)}`.as('__id');

        // Always include __version column for realtime sync
        const versionColumn = sql`${sql.ref(`${T}.__version`)}`.as('__version');

        // Include system columns for undo/redo support
        const autoNumberColumn = sql`${sql.ref(`${T}.__auto_number`)}`.as('__auto_number');
        const createdTimeColumn = sql`${sql.ref(`${T}.__created_time`)}`.as('__created_time');
        const createdByColumn = sql`${sql.ref(`${T}.__created_by`)}`.as('__created_by');
        const lastModifiedTimeColumn = sql`${sql.ref(`${T}.__last_modified_time`)}`.as(
          '__last_modified_time'
        );
        const lastModifiedByColumn = sql`${sql.ref(`${T}.__last_modified_by`)}`.as(
          '__last_modified_by'
        );

        // Resolve orderBy columns
        const resolvedOrderBy: ResolvedOrderBy[] = [];
        for (const orderBy of this.orderByValues) {
          const resolved = yield* this.resolveOrderBy(table, orderBy.column, orderBy.direction);
          if (resolved !== null) {
            resolvedOrderBy.push(resolved);
          }
        }

        const whereClauseResult = this.buildWhereCondition();
        if (whereClauseResult.isErr()) {
          return err(whereClauseResult.error);
        }
        const whereClause = whereClauseResult.value;
        let query = this.db
          .selectFrom(`${tableName} as ${T}`)
          .select(() => [
            idColumn,
            versionColumn,
            autoNumberColumn,
            createdTimeColumn,
            createdByColumn,
            lastModifiedTimeColumn,
            lastModifiedByColumn,
            ...selectColumns,
          ])
          .$if(whereClause !== null, (qb) =>
            qb.where(whereClause as unknown as Expression<SqlBool>)
          );

        for (const orderBy of resolvedOrderBy) {
          if (orderBy.selectChoiceMode && orderBy.selectChoiceOrder?.length) {
            query = this.applySelectChoiceOrderBy(
              query,
              orderBy.column,
              orderBy.direction,
              orderBy.selectChoiceMode,
              orderBy.selectChoiceOrder
            );
          } else if (orderBy.userLikeMode) {
            query = this.applyUserLikeOrderBy(
              query,
              orderBy.column,
              orderBy.direction,
              orderBy.userLikeMode,
              orderBy.userLikeSource ?? 'field'
            );
          } else {
            // Align null ordering with v1: ASC => nulls first, DESC => nulls last.
            // Without this, PostgreSQL defaults to ASC NULLS LAST / DESC NULLS FIRST,
            // which is the opposite of v1, causing row offset mismatches during paste.
            const columnRef = orderBy.expression ?? sql`${sql.ref(`${T}.${orderBy.column}`)}`;
            const nullOrderDirection: 'asc' | 'desc' = orderBy.direction === 'asc' ? 'desc' : 'asc';
            query = query
              .orderBy(sql`${columnRef} is null`, nullOrderDirection)
              .orderBy(columnRef, orderBy.direction);
          }
        }

        query = query
          .$if(this.limitValue !== null, (qb) => qb.limit(this.limitValue!))
          .$if(this.offsetValue !== null, (qb) => qb.offset(this.offsetValue!));
        return ok(query);
      }.bind(this)
    );
  }

  private buildSelectColumns(
    table: Table,
    projection: ReadonlyArray<FieldId> | null
  ): Result<AliasedRawBuilder<unknown, string>[], DomainError> {
    return safeTry(function* () {
      const visitor = new StoredFieldSelectVisitor(T);
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

  private resolveOrderBy(
    table: Table,
    orderByColumn: OrderByColumn,
    direction: 'asc' | 'desc'
  ): Result<ResolvedOrderBy | null, DomainError> {
    if (orderByColumn instanceof FieldId) {
      return table
        .getField((f) => f.id().equals(orderByColumn as FieldId))
        .andThen((field) => {
          const fieldType = field.type();
          const isUserLike =
            fieldType.equals(FieldType.user()) ||
            fieldType.equals(FieldType.link()) ||
            fieldType.equals(FieldType.createdBy()) ||
            fieldType.equals(FieldType.lastModifiedBy());
          const resolveDateLikeOrderBy = (column: string) => {
            const expression = buildDateLikeOrderExpression(field, T, column);
            return ok(expression ? { column, direction, expression } : { column, direction });
          };

          if (fieldType.equals(FieldType.createdTime())) {
            return resolveDateLikeOrderBy('__created_time');
          }
          if (fieldType.equals(FieldType.lastModifiedTime())) {
            return resolveDateLikeOrderBy('__last_modified_time');
          }
          if (fieldType.equals(FieldType.createdBy())) {
            return ok({
              column: '__created_by',
              direction,
              userLikeMode: 'single',
              userLikeSource: 'system',
            });
          }
          if (fieldType.equals(FieldType.lastModifiedBy())) {
            return ok({
              column: '__last_modified_by',
              direction,
              userLikeMode: 'single',
              userLikeSource: 'system',
            });
          }
          if (fieldType.equals(FieldType.autoNumber())) {
            return ok({ column: '__auto_number', direction });
          }

          const selectChoiceOrder = this.extractSelectChoiceOrder(field);
          const multiplicityResult = isUserLike ? field.isMultipleCellValue() : undefined;
          if (multiplicityResult?.isErr()) {
            return err(multiplicityResult.error);
          }
          const multiplicity = multiplicityResult?.isOk() ? multiplicityResult.value : undefined;
          return field.dbFieldName().andThen((dbFieldName) =>
            dbFieldName.value().map((column) => ({
              column,
              direction,
              expression: buildDateLikeOrderExpression(field, T, column) ?? undefined,
              ...(isUserLike
                ? {
                    userLikeMode: (multiplicity?.isMultiple() ? 'multiple' : 'single') as Exclude<
                      ResolvedOrderBy['userLikeMode'],
                      undefined
                    >,
                    userLikeSource: 'field' as const,
                  }
                : {}),
              ...(selectChoiceOrder
                ? {
                    selectChoiceMode: selectChoiceOrder.mode,
                    selectChoiceOrder: selectChoiceOrder.values,
                  }
                : {}),
            }))
          );
        });
    }

    return ok({ column: orderByColumn, direction });
  }

  private extractSelectChoiceOrder(
    field: unknown
  ): { mode: 'single' | 'multiple'; values: string[] } | undefined {
    const candidate = field as {
      type?: () => { equals: (other: unknown) => boolean };
      selectOptions?: () => ReadonlyArray<{ name: () => { toString: () => string } }>;
      innerField?: () => { isOk: () => boolean; value: unknown };
      isMultipleCellValue?: () => { isOk: () => boolean; value: { isMultiple: () => boolean } };
    };
    const fieldType = candidate.type?.();
    if (!fieldType) {
      return undefined;
    }

    const toChoiceNames = (
      options: ReadonlyArray<{ name: () => { toString: () => string } }> | undefined
    ): string[] | undefined => {
      if (!options?.length) {
        return undefined;
      }
      const names = options.map((option) => option.name().toString()).filter(Boolean);
      return names.length ? names : undefined;
    };

    if (
      fieldType.equals(FieldType.singleSelect()) ||
      fieldType.equals(FieldType.multipleSelect())
    ) {
      const values = toChoiceNames(candidate.selectOptions?.());
      if (!values) {
        return undefined;
      }
      return {
        mode: fieldType.equals(FieldType.multipleSelect()) ? 'multiple' : 'single',
        values,
      };
    }

    if (fieldType.equals(FieldType.lookup())) {
      const innerFieldResult = candidate.innerField?.();
      if (!innerFieldResult?.isOk()) {
        return undefined;
      }
      const innerField = innerFieldResult.value as {
        type?: () => { equals: (other: unknown) => boolean };
        selectOptions?: () => ReadonlyArray<{ name: () => { toString: () => string } }>;
      };
      const innerType = innerField.type?.();
      if (!innerType) {
        return undefined;
      }
      if (
        !innerType.equals(FieldType.singleSelect()) &&
        !innerType.equals(FieldType.multipleSelect())
      ) {
        return undefined;
      }
      const values = toChoiceNames(innerField.selectOptions?.());
      if (!values) {
        return undefined;
      }
      // Lookup values are usually arrays; prefer multiple mode unless we know it is single-valued.
      let mode: 'single' | 'multiple' = 'multiple';
      const multiplicityResult = candidate.isMultipleCellValue?.();
      const multiplicity = multiplicityResult?.isOk() ? multiplicityResult.value : undefined;
      if (
        innerType.equals(FieldType.singleSelect()) &&
        multiplicity &&
        !multiplicity.isMultiple()
      ) {
        mode = 'single';
      }
      return { mode, values };
    }

    return undefined;
  }

  /**
   * Align user/link ordering with v1:
   * - single: sort by `title`
   * - multiple: sort by `titles[]` text projection
   * - null ordering: ASC => null first, DESC => null last
   */
  private applyUserLikeOrderBy(
    query: QB,
    column: string,
    direction: 'asc' | 'desc',
    mode: 'single' | 'multiple',
    source: 'field' | 'system'
  ): QB {
    const columnRef = sql.ref(`${T}.${column}`);
    // Keep v1 parity for user/link fields: cast stored value to jsonb and sort by title.
    // System fields (createdBy/lastModifiedBy) may be scalar strings, so keep to_jsonb().
    const columnJson = source === 'field' ? sql`${columnRef}::jsonb` : sql`to_jsonb(${columnRef})`;
    const arrayLikeColumnJson =
      source === 'field'
        ? sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            WHEN jsonb_typeof(${columnJson}) = 'object' THEN jsonb_build_array(${columnJson})
            ELSE '[]'::jsonb
          END`
        : sql`CASE
            WHEN jsonb_typeof(${columnJson}) = 'array' THEN ${columnJson}
            ELSE '[]'::jsonb
          END`;
    const titleExpr =
      mode === 'multiple'
        ? sql`jsonb_path_query_array(${arrayLikeColumnJson}, '$[*].title')::text`
        : source === 'field'
          ? sql`${columnJson} ->> 'title'`
          : sql`coalesce(${columnJson} ->> 'title', ${columnJson} ->> 'name', ${columnJson} #>> '{}')`;

    const nullOrderDirection: 'asc' | 'desc' = direction === 'asc' ? 'desc' : 'asc';

    return query
      .orderBy(sql`${titleExpr} is null`, nullOrderDirection)
      .orderBy(titleExpr, direction);
  }

  private applySelectChoiceOrderBy(
    query: QB,
    column: string,
    direction: 'asc' | 'desc',
    mode: 'single' | 'multiple',
    choiceOrder: ReadonlyArray<string>
  ): QB {
    const columnRef = sql.ref(`${T}.${column}`);
    const choiceArrayLiteral = sql`ARRAY[${sql.join(
      choiceOrder.map((name) => sql`${name}`),
      sql`, `
    )}]`;

    const choiceIndexExpr =
      mode === 'multiple'
        ? sql`CASE
            WHEN ${columnRef} IS NULL THEN NULL
            WHEN jsonb_typeof(${columnRef}::jsonb) = 'array'
              THEN ARRAY_POSITION(${choiceArrayLiteral}, jsonb_path_query_first(${columnRef}::jsonb, '$[0]') #>> '{}')
            ELSE ARRAY_POSITION(${choiceArrayLiteral}, ${columnRef}::text)
          END`
        : sql`ARRAY_POSITION(${choiceArrayLiteral}, ${columnRef}::text)`;

    const nullOrderDirection: 'asc' | 'desc' = direction === 'asc' ? 'desc' : 'asc';
    let ordered = query
      .orderBy(sql`${choiceIndexExpr} is null`, nullOrderDirection)
      .orderBy(choiceIndexExpr, direction);

    if (mode === 'multiple') {
      ordered = ordered.orderBy(sql`${columnRef}::jsonb::text`, direction);
    }

    return ordered;
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
}
