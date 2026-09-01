import {
  domainError,
  type ILogger,
  isDomainError,
  v2CoreTokens,
  type DomainError,
  type FieldOrderBy,
  FieldType,
  type Field,
  type IExecutionContext,
  type IRecordReadQuerySource,
  type IRecordSearchAccessPathResolution,
  type RecordQuerySearch,
  type ITableRecordQueryRepository,
  type ITableRecordCountQueryRepository,
  type ITableRecordCountOptions,
  type ITableRecordAggregationQueryRepository,
  type ITableRecordAggregationOptions,
  type ITableRecordCalendarQueryRepository,
  type ITableRecordCollaboratorQueryRepository,
  type TableRecordAggregation,
  type TableRecordAggregationGroup,
  type TableRecordAggregationValue,
  type TableRecordCalendarDailyCollection,
  type TableRecordCalendarDailyCollectionEntry,
  RecordByIdSpec,
  type ITableRecordQueryOptions,
  type ITableRecordQueryResult,
  type ITableRecordSearchMatch,
  type ITableRecordQueryStreamOptions,
  type ISpecification,
  type ITableRecordConditionSpecVisitor,
  type Table,
  type TableRecordReadModel,
  type TableRecord,
  type ViewCollaboratorField,
  viewCollaboratorFieldIsMultiple,
  type TableRecordQueryMode,
  FieldId,
  RecordId,
  type ITableRecordStreamPagination,
  type ITableRecordStreamPaginationStrategy,
  type LastModifiedByField,
  OffsetPagination,
  PageLimit,
  PageOffset,
  buildUserAvatarUrl,
  isFieldOrderBy,
  isSystemColumnOrderBy,
  type TableRecordOrderBy,
  createSearchTraceAttributes,
  createTableQueryTraceAttributes,
} from '@teable/v2-core';
import { inject, injectable } from '@teable/v2-di';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { CompiledQuery, sql } from 'kysely';
import type { Expression, Kysely, RawBuilder, SqlBool } from 'kysely';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { v2RecordRepositoryPostgresTokens } from '../di/tokens';
import {
  applyStoredFieldOrderByClause,
  buildStoredFieldValueExpression,
  buildStoredFieldOrderByClauses,
  FieldOutputColumnVisitor,
  type DynamicDB,
  type FieldOutputColumn,
  type StoredFieldOrderByClause,
  type ITableRecordQueryBuilder,
  type TableRecordQueryBuilderManager,
} from '../query-builder';
import { buildDateLikeGroupExpression } from '../query-builder/dateLikeOrderBy';
import { maskValueExpression } from '../query-builder/maskValueExpression';
import {
  buildUserGroupIdentityExpr,
  buildUserJsonObjectFromSnapshotExpr,
  resolveUserGroupIdentityMultiplicity,
} from '../query-builder/userSnapshotSql';
import { buildFieldMaskSqlMap } from './buildFieldMaskSql';
import { buildRecordWhereClause } from './buildRecordWhereClause';
import { CursorStreamPaginationStrategy } from './CursorStreamPaginationStrategy';
import { OffsetStreamPaginationStrategy } from './OffsetStreamPaginationStrategy';
import {
  buildBookmarkSeekExists,
  CURSOR_ORDER_BY_ERROR,
  getLastAutoNumberCursor,
  isAutoNumberOnlyCursorOrderBy,
  isRawColumnCursorField,
  orderByHasAutoNumberAsc,
  parseCursorToken,
  type CursorSeekKey,
} from './listRecordsCursor';
import {
  buildRecordSearchFieldMatches,
  buildRecordSearchWhereClause,
  buildRecordSearchWherePlan,
  type RecordSearchFieldMatch,
} from './RecordSearchWhereBuilder';
import {
  buildTableRecordAggregationExpression,
  normalizeTableRecordAggregationValue,
} from './TableRecordAggregationSql';

const RECORD_ID_COLUMN = '__id';
const RECORD_VERSION_COLUMN = '__version';
const TABLE_ALIAS = 't';
const GROUP_RESULT_ALIAS = 'g';
const ORDER_COLUMN_CACHE_TTL_MS = 5_000;
const LEGACY_AVATAR_PREFIX = '/api/attachments/read/public/avatar/';
const TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY = Symbol.for('teable.v2.tableOps.sqlDiagnostics');

// Single policy for which group expressions get identity-normalized: plain
// user fields and lookups whose presentation type is user. Returns null for
// every other field type. Lookup-of-user cells persist write-time snapshots,
// so grouping by the raw JSON would split one collaborator per email/avatar.
const userGroupIdentityExprForField = (
  field: Field,
  columnRef: RawBuilder<unknown>
): Result<RawBuilder<unknown> | null, DomainError> => {
  const multiplicity = resolveUserGroupIdentityMultiplicity(field);
  if (multiplicity.isErr()) return err(multiplicity.error);
  if (multiplicity.value == null) return ok(null);
  return ok(buildUserGroupIdentityExpr(columnRef, multiplicity.value));
};

const buildGroupFieldValueExpression = (
  field: Field,
  column: string
): Result<
  { expression: RawBuilder<unknown>; usesValueExpressionForOrder: boolean },
  DomainError
> => {
  const storedValue = buildStoredFieldValueExpression(field, TABLE_ALIAS, column);
  if (storedValue.isErr()) {
    return err(storedValue.error);
  }
  if (storedValue.value.usesErrorFallback) {
    return ok({
      expression: storedValue.value.expression,
      usesValueExpressionForOrder: true,
    });
  }

  const dateGroupExpression = buildDateLikeGroupExpression(field, TABLE_ALIAS, column);
  if (dateGroupExpression) {
    return ok({
      expression: dateGroupExpression,
      usesValueExpressionForOrder: true,
    });
  }

  const columnRef = sql.ref(`${TABLE_ALIAS}.${column}`);
  // createdBy / lastModifiedBy group by the full snapshot object; identity
  // drift across snapshot generations there is folded by the presentation
  // walk (buildGroupQueryExtra) instead of being normalized in SQL
  if (field.type().equals(FieldType.createdBy())) {
    return ok({
      expression: buildUserJsonObjectFromSnapshotExpr(
        columnRef,
        sql.ref(`${TABLE_ALIAS}.__created_by`)
      ),
      usesValueExpressionForOrder: true,
    });
  }
  if (
    field.type().equals(FieldType.lastModifiedBy()) &&
    (field as LastModifiedByField).isTrackAll()
  ) {
    return ok({
      expression: buildUserJsonObjectFromSnapshotExpr(
        columnRef,
        sql.ref(`${TABLE_ALIAS}.__last_modified_by`)
      ),
      usesValueExpressionForOrder: true,
    });
  }
  const userIdentity = userGroupIdentityExprForField(field, columnRef);
  if (userIdentity.isErr()) return err(userIdentity.error);
  if (userIdentity.value) {
    return ok({
      expression: userIdentity.value,
      usesValueExpressionForOrder: true,
    });
  }
  return ok({
    expression: storedValue.value.expression,
    usesValueExpressionForOrder: false,
  });
};

type OrderColumnExistsCacheEntry = {
  exists: boolean;
  cachedAt: number;
};

type IExecutionContextWithTableQuerySqlDiagnostics = IExecutionContext & {
  [TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY]?: {
    readonly record?: (input: {
      readonly source: string;
      readonly sql: string;
      readonly parameters?: ReadonlyArray<unknown>;
    }) => void;
  };
};

const createRecordSearchAccessPathResolution = (
  options: ITableRecordQueryOptions | undefined,
  used: IRecordSearchAccessPathResolution['used']
): IRecordSearchAccessPathResolution | undefined => {
  if (!options?.search) return undefined;
  const requested = options.searchAccessPath?.kind ?? 'default';
  const generatedTextFallbackReason =
    requested === 'generated_text' &&
    options.searchAccessPath?.kind === 'generated_text' &&
    options.searchAccessPath.provider === 'pg_trgm' &&
    Array.from(options.search.search.value).length < 3
      ? ('generated_text_probe_too_short' as const)
      : ('generated_text_unavailable' as const);
  return {
    requested,
    used,
    ...(requested === 'generated_text' && used === 'default'
      ? { fallbackReason: generatedTextFallbackReason }
      : {}),
    ...(requested === 'generated_tsvector' && used === 'default'
      ? { fallbackReason: 'generated_tsvector_unavailable' as const }
      : {}),
  };
};

const createRepositoryFindTraceAttributes = (
  table: Table,
  options: ITableRecordQueryOptions | undefined,
  source: 'repository.record_find' | 'repository.record_count',
  resolution?: IRecordSearchAccessPathResolution
) => {
  const search = options?.search?.search;
  const usesGeneratedText = Boolean(search && resolution?.used === 'generated_text');
  const usesSearchVector = Boolean(search && resolution?.used === 'generated_tsvector');
  const searchAccessPath = !search
    ? 'none'
    : resolution?.fallbackReason
      ? 'fallback'
      : usesGeneratedText && options?.searchAccessPath?.kind === 'generated_text'
        ? options.searchAccessPath.provider === 'pg_bigm'
          ? 'generated_text_bigram'
          : 'generated_text_trigram'
        : usesSearchVector
          ? 'generated_tsvector'
          : 'default_ilike';
  const searchMode = usesGeneratedText
    ? 'substring'
    : usesSearchVector
      ? 'full_text'
      : search
        ? 'ilike'
        : 'none';

  return {
    ...createTableQueryTraceAttributes({
      tableId: table.id().toString(),
      queryKind: search ? 'search' : 'record_list',
      querySource: source,
      hasSort: Boolean(options?.orderBy?.length),
      includeTotal: options?.includeTotal !== false,
    }),
    ...createSearchTraceAttributes({
      searchValue: search?.value,
      fieldCount: options?.search?.visibleFieldIds?.length,
      allFields: search?.searchesAllFields(),
      accessPath: searchAccessPath,
      searchMode,
      searchScope: search
        ? search.searchesAllFields()
          ? 'all_fields'
          : 'selected_fields'
        : 'none',
      languageConfig:
        usesSearchVector && options?.searchAccessPath?.kind === 'generated_tsvector'
          ? options.searchAccessPath.languageConfig
          : undefined,
      fallbackReason: resolution?.fallbackReason,
      generatedColumnName:
        (usesSearchVector && options?.searchAccessPath?.kind === 'generated_tsvector') ||
        (usesGeneratedText && options?.searchAccessPath?.kind === 'generated_text')
          ? options.searchAccessPath.generatedColumnName
          : undefined,
      indexProvider:
        usesGeneratedText && options?.searchAccessPath?.kind === 'generated_text'
          ? options.searchAccessPath.provider
          : undefined,
    }),
  };
};

@injectable()
export class PostgresTableRecordQueryRepository
  implements
    ITableRecordQueryRepository,
    ITableRecordCountQueryRepository,
    ITableRecordAggregationQueryRepository,
    ITableRecordCalendarQueryRepository,
    ITableRecordCollaboratorQueryRepository
{
  private readonly orderColumnExistsCache = new Map<string, OrderColumnExistsCacheEntry>();
  private readonly defaultStreamPaginationStrategy = new OffsetStreamPaginationStrategy();
  private readonly streamPaginationStrategies: ReadonlyArray<ITableRecordStreamPaginationStrategy> =
    [new CursorStreamPaginationStrategy(), this.defaultStreamPaginationStrategy];

  constructor(
    @inject(v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager)
    private readonly queryBuilderManager: TableRecordQueryBuilderManager,
    @inject(v2RecordRepositoryPostgresTokens.db)
    private readonly db: Kysely<V1TeableDatabase>,
    @inject(v2CoreTokens.logger)
    private readonly logger: ILogger
  ) {}

  async findDistinctUserIds(
    context: IExecutionContext,
    table: Table,
    field: ViewCollaboratorField,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
  ): Promise<Result<ReadonlyArray<string>, DomainError>> {
    const span = context.tracer?.startSpan('teable.repository.record.find_distinct_user_ids', {
      tableId: table.id().toString(),
      fieldId: field.id().toString(),
    });

    try {
      const queryBuilderResult = await this.queryBuilderManager.createBuilder(context, table, {
        mode: 'stored',
      });
      if (queryBuilderResult.isErr()) return err(queryBuilderResult.error);
      const queryBuilder = queryBuilderResult.value;
      queryBuilder.select([field.id()]);
      if (spec) queryBuilder.where(spec);
      const scopedQueryResult = queryBuilder.build();
      if (scopedQueryResult.isErr()) return err(scopedQueryResult.error);

      const columnAliasResult = new FieldOutputColumnVisitor().getColumnAlias(field);
      if (columnAliasResult.isErr()) return err(columnAliasResult.error);
      const scopeAlias = 'record_collaborator_scope';
      const column = sql.ref(`a.${columnAliasResult.value}`);
      const userIdExpression = viewCollaboratorFieldIsMultiple(field)
        ? sql<string>`jsonb_array_elements(COALESCE(${column}::jsonb, '[]'::jsonb))->>'id'`
        : sql<string>`${column}::jsonb->>'id'`;
      const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
      const query = dynamicDb
        .with(scopeAlias, () => scopedQueryResult.value)
        .selectFrom(`${scopeAlias} as a`)
        .select(userIdExpression.as('user_id'))
        .distinct();
      const compiled = query.compile();
      this.recordSqlDiagnostic(context, 'record_find_distinct_user_ids', compiled);
      const rows = await dynamicDb.executeQuery<{ user_id: string | null }>(compiled);
      return ok(rows.rows.flatMap((row) => (row.user_id ? [row.user_id] : [])));
    } catch (error) {
      return err(
        domainError.infrastructure({
          message: 'Failed to query distinct user IDs',
          details: { error: (error as Error)?.message ?? String(error) },
        })
      );
    } finally {
      span?.end();
    }
  }

  async aggregate(
    context: IExecutionContext,
    table: Table,
    aggregation: TableRecordAggregation,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordAggregationOptions
  ): Promise<Result<ReadonlyArray<TableRecordAggregationValue>, DomainError>> {
    if (!aggregation.fields.length) return ok([]);

    const span = context.tracer?.startSpan('teable.repository.record.aggregate', {
      tableId: table.id().toString(),
      fieldCount: aggregation.fields.length,
      groupDepth: aggregation.groupBy.length,
    });

    try {
      const queryBuilderResult = await this.queryBuilderManager.createBuilder(context, table, {
        // Aggregation follows the same persisted-value contract as ListTableRecordsHandler.
        mode: 'stored',
      });
      if (queryBuilderResult.isErr()) return err(queryBuilderResult.error);
      const queryBuilder = queryBuilderResult.value;
      const searchFieldsResult = options?.search
        ? options.search.search.resolveFields(table, {
            visibleFieldIds: options.search.visibleFieldIds,
          })
        : ok([]);
      if (searchFieldsResult.isErr()) return err(searchFieldsResult.error);
      const projection = [
        ...new Map(
          [
            ...aggregation.fields.map(({ fieldId }) => fieldId),
            ...aggregation.groupBy.map(({ fieldId }) => fieldId),
            ...searchFieldsResult.value.map((field) => field.id()),
          ].map((fieldId) => [fieldId.toString(), fieldId])
        ).values(),
      ];
      queryBuilder.select(projection);
      if (spec) queryBuilder.where(spec);
      const searchWherePlan = buildRecordSearchWherePlan(table, options?.search, {
        tableAlias: TABLE_ALIAS,
      });
      if (searchWherePlan.isErr()) return err(searchWherePlan.error);
      if (searchWherePlan.value.condition !== null) {
        queryBuilder.whereExpression(searchWherePlan.value.condition);
      }
      if (options?.orderBy?.length || options?.pagination) {
        const dbTableNameResult = table.dbTableName();
        if (dbTableNameResult.isErr()) return err(dbTableNameResult.error);
        const tableNameResult = dbTableNameResult.value.value();
        if (tableNameResult.isErr()) return err(tableNameResult.error);
        const [schemaName, tableNameOnly] = tableNameResult.value.split('.');
        const dynamicDbForOrder = this.db as unknown as Kysely<DynamicDB>;
        if (options.orderBy?.length) {
          await this.applyQueryOrderBy(
            queryBuilder,
            options.orderBy,
            dynamicDbForOrder,
            schemaName,
            tableNameOnly
          );
        } else {
          queryBuilder.orderBy('__auto_number', 'asc');
        }
        if (options.pagination) {
          queryBuilder.limit(options.pagination.limit().toNumber());
          queryBuilder.offset(options.pagination.offset().toNumber());
        }
      }
      const scopedQueryResult = queryBuilder.build();
      if (scopedQueryResult.isErr()) return err(scopedQueryResult.error);

      const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
      const fieldColumns = new Map<string, string>();
      const fieldsById = new Map<string, Field>();
      for (const fieldId of projection) {
        const fieldResult = table.getField((field) => field.id().equals(fieldId));
        if (fieldResult.isErr()) return err(fieldResult.error);
        const aliasResult = new FieldOutputColumnVisitor().getColumnAlias(fieldResult.value);
        if (aliasResult.isErr()) return err(aliasResult.error);
        fieldColumns.set(fieldId.toString(), aliasResult.value);
        fieldsById.set(fieldId.toString(), fieldResult.value);
      }

      const values: TableRecordAggregationValue[] = [];
      const levels: ReadonlyArray<ReadonlyArray<TableRecordAggregationGroup>> = [
        [],
        ...aggregation.groupBy.map((_, index) => aggregation.groupBy.slice(0, index + 1)),
      ];

      for (const groupFields of levels) {
        const scopeAlias = 'record_aggregation_scope';
        const aggregateAliases = aggregation.fields.map((_, index) => `__aggregation_${index}`);
        const groupAliases = groupFields.map((_, index) => `__group_${index}`);
        let aggregateQuery = dynamicDb
          .with(scopeAlias, () => scopedQueryResult.value)
          .selectFrom(`${scopeAlias} as a`)
          .select(
            aggregation.fields.map((aggregationField, index) => {
              const field = fieldsById.get(aggregationField.fieldId.toString())!;
              const columnName = fieldColumns.get(aggregationField.fieldId.toString())!;
              return buildTableRecordAggregationExpression(
                field,
                columnName,
                aggregationField.statisticFunc
              ).as(aggregateAliases[index]!);
            })
          );

        for (const [index, group] of groupFields.entries()) {
          const field = fieldsById.get(group.fieldId.toString())!;
          const columnName = fieldColumns.get(group.fieldId.toString())!;
          const column = sql.ref(`a.${columnName}`);
          const userIdentity = userGroupIdentityExprForField(field, column);
          if (userIdentity.isErr()) return err(userIdentity.error);
          const groupExpression = userIdentity.value ?? column;
          aggregateQuery = aggregateQuery
            .select(groupExpression.as(groupAliases[index]!))
            .groupBy(groupExpression);
          if (userIdentity.value) {
            // order user buckets by the same title+identity clauses the record
            // queries use, so share-view group points collate with their
            // record pages instead of by raw jsonb comparison
            const orderByClauses = buildStoredFieldOrderByClauses(
              field,
              columnName,
              group.order,
              'a',
              {
                columnExpression: userIdentity.value,
              }
            );
            if (orderByClauses.isErr()) return err(orderByClauses.error);
            for (const clause of orderByClauses.value) {
              aggregateQuery = applyStoredFieldOrderByClause(aggregateQuery, clause);
            }
          } else {
            aggregateQuery = aggregateQuery.orderBy(groupExpression, group.order);
          }
        }
        if (groupFields.length) {
          aggregateQuery = aggregateQuery.limit(options?.maxGroupPoints ?? 5_000);
        }

        const compiled = aggregateQuery.compile();
        this.recordSqlDiagnostic(context, 'record_aggregate', compiled);
        const rows = await dynamicDb.executeQuery<Record<string, unknown>>(compiled);
        for (const row of rows.rows) {
          const groupValues = groupAliases.map((alias, index) =>
            normalizeStoredGroupValue(
              fieldsById.get(groupFields[index]!.fieldId.toString())!,
              row[alias]
            )
          );
          aggregation.fields.forEach((aggregationField, index) => {
            values.push({
              fieldId: aggregationField.fieldId,
              statisticFunc: aggregationField.statisticFunc,
              value: normalizeTableRecordAggregationValue(
                row[aggregateAliases[index]!],
                aggregationField.statisticFunc
              ),
              ...(groupValues.length ? { groupValues } : {}),
            });
          });
        }
      }

      return ok(values);
    } catch (error) {
      return err(buildUnexpectedQueryError('Failed to aggregate table records', error));
    } finally {
      span?.end();
    }
  }

  async calendarDailyCollection(
    context: IExecutionContext,
    table: Table,
    calendar: TableRecordCalendarDailyCollection,
    range: {
      readonly startDate: string;
      readonly endDate: string;
    },
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: {
      readonly search?: RecordQuerySearch;
    }
  ): Promise<Result<ReadonlyArray<TableRecordCalendarDailyCollectionEntry>, DomainError>> {
    const span = context.tracer?.startSpan('teable.repository.record.calendar_daily_collection', {
      tableId: table.id().toString(),
      startFieldId: calendar.startFieldId.toString(),
      endFieldId: calendar.endFieldId.toString(),
    });

    try {
      const queryBuilderResult = await this.queryBuilderManager.createBuilder(context, table, {
        mode: 'stored',
      });
      if (queryBuilderResult.isErr()) return err(queryBuilderResult.error);
      const queryBuilder = queryBuilderResult.value;
      const searchFieldsResult = options?.search
        ? options.search.search.resolveFields(table, {
            visibleFieldIds: options.search.visibleFieldIds,
          })
        : ok([]);
      if (searchFieldsResult.isErr()) return err(searchFieldsResult.error);
      const projection = [
        ...new Map(
          [
            calendar.startFieldId,
            calendar.endFieldId,
            ...searchFieldsResult.value.map((field) => field.id()),
          ].map((fieldId) => [fieldId.toString(), fieldId])
        ).values(),
      ];
      queryBuilder.select(projection);
      if (spec) queryBuilder.where(spec);
      const scopedQueryResult = queryBuilder.build();
      if (scopedQueryResult.isErr()) return err(scopedQueryResult.error);

      const searchWherePlan = buildRecordSearchWherePlan(table, options?.search, {
        tableAlias: 'a',
      });
      if (searchWherePlan.isErr()) return err(searchWherePlan.error);

      const startFieldResult = table.getField((field) => field.id().equals(calendar.startFieldId));
      if (startFieldResult.isErr()) return err(startFieldResult.error);
      const endFieldResult = table.getField((field) => field.id().equals(calendar.endFieldId));
      if (endFieldResult.isErr()) return err(endFieldResult.error);
      const outputVisitor = new FieldOutputColumnVisitor();
      const startColumnResult = outputVisitor.getColumnAlias(startFieldResult.value);
      if (startColumnResult.isErr()) return err(startColumnResult.error);
      const endColumnResult = outputVisitor.getColumnAlias(endFieldResult.value);
      if (endColumnResult.isErr()) return err(endColumnResult.error);

      const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
      const scopeAlias = 'record_calendar_scope';
      const timeZone = calendar.timeZone.toString();
      const startColumn = sql.ref(`a.${startColumnResult.value}`);
      const endColumn = sql.ref(`a.${endColumnResult.value}`);
      const dateSeries = sql<{ date: Date }>`(
        SELECT date::date AS date
        FROM generate_series(
          (${range.startDate}::timestamptz AT TIME ZONE ${timeZone})::date,
          (${range.endDate}::timestamptz AT TIME ZONE ${timeZone})::date,
          '1 day'::interval
        ) AS date
      )`.as('dates');

      let query = dynamicDb
        .with(scopeAlias, () => scopedQueryResult.value)
        .selectFrom(`${scopeAlias} as a`)
        .innerJoin(dateSeries, (join) => join.onTrue())
        .select([
          sql<string>`to_char(${sql.ref('dates.date')}, 'YYYY-MM-DD')`.as('date'),
          sql<string>`count(*)`.as('count'),
          sql<ReadonlyArray<string>>`(
            array_agg(${sql.ref(`a.${RECORD_ID_COLUMN}`)} ORDER BY ${startColumn})
          )[1:10]`.as('record_ids'),
        ])
        .where(
          sql<SqlBool>`
            (${startColumn}::timestamptz AT TIME ZONE ${timeZone})::date
              <= (${range.endDate}::timestamptz AT TIME ZONE ${timeZone})::date
            AND (
              COALESCE(${endColumn}::timestamptz, ${startColumn}::timestamptz)
                AT TIME ZONE ${timeZone}
            )::date >= (${range.startDate}::timestamptz AT TIME ZONE ${timeZone})::date
            AND (${startColumn}::timestamptz AT TIME ZONE ${timeZone})::date
              <= ${sql.ref('dates.date')}
            AND (
              COALESCE(${endColumn}::timestamptz, ${startColumn}::timestamptz)
                AT TIME ZONE ${timeZone}
            )::date >= ${sql.ref('dates.date')}
          `
        )
        .groupBy(sql.ref('dates.date'))
        .orderBy(sql.ref('dates.date'), 'asc');
      if (searchWherePlan.value.condition !== null) {
        query = query.where(searchWherePlan.value.condition);
      }

      const compiled = query.compile();
      this.recordSqlDiagnostic(context, 'record_calendar_daily_collection', compiled);
      const rows = await dynamicDb.executeQuery<{
        date: string;
        count: string;
        record_ids: ReadonlyArray<string>;
      }>(compiled);
      const entries: TableRecordCalendarDailyCollectionEntry[] = [];
      for (const row of rows.rows) {
        const recordIdsResult = row.record_ids.map((recordId) => RecordId.create(recordId));
        const firstError = recordIdsResult.find((result) => result.isErr());
        if (firstError?.isErr()) return err(firstError.error);
        entries.push({
          date: row.date,
          count: Number(row.count),
          recordIds: recordIdsResult.map((result) => result._unsafeUnwrap()),
        });
      }
      return ok(entries);
    } catch (error) {
      return err(buildUnexpectedQueryError('Failed to query calendar daily collection', error));
    } finally {
      span?.end();
    }
  }

  async count(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordCountOptions
  ): Promise<Result<number, DomainError>> {
    const findOptions = options as ITableRecordQueryOptions | undefined;
    const span = context.tracer?.startSpan(
      'teable.repository.record.count',
      createRepositoryFindTraceAttributes(table, findOptions, 'repository.record_count')
    );

    try {
      return await safeTry<number, DomainError>(
        async function* (this: PostgresTableRecordQueryRepository) {
          const readQuerySource = this.getRecordReadQuerySource(findOptions);
          const dbTableName = yield* table.dbTableName();
          const tableName = yield* dbTableName.value();
          const sourceTableName = readQuerySource?.tableName ?? tableName;
          const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
          const whereClause = spec
            ? buildRecordWhereClause(spec, { tableAlias: TABLE_ALIAS })
            : ok(null);
          if (whereClause.isErr()) {
            return err(whereClause.error);
          }
          const fieldMaskSqlMap = yield* buildFieldMaskSqlMap(options?.fieldMasks, TABLE_ALIAS);
          const searchWherePlan = buildRecordSearchWherePlan(table, options?.search, {
            tableAlias: TABLE_ALIAS,
            searchAccessPath: options?.searchAccessPath,
            fieldMaskSqlMap,
          });
          if (searchWherePlan.isErr()) {
            return err(searchWherePlan.error);
          }
          const searchAccessPath = createRecordSearchAccessPathResolution(
            findOptions,
            searchWherePlan.value.usedAccessPath
          );
          const countCompiled = this.withRecordReadQuerySource(
            dynamicDb
              .selectFrom(`${sourceTableName} as ${TABLE_ALIAS}`)
              .select(sql<string>`count(*)`.as('count'))
              .$if(whereClause.value !== null, (qb) =>
                qb.where(whereClause.value as Expression<SqlBool>)
              )
              .$if(searchWherePlan.value.condition !== null, (qb) =>
                qb.where(searchWherePlan.value.condition as Expression<SqlBool>)
              )
              .compile(),
            readQuerySource
          );
          this.recordSqlDiagnostic(context, 'record_count', countCompiled);
          const countDbSpan = context.tracer?.startSpan(
            'teable.table.query.db.count',
            createRepositoryFindTraceAttributes(
              table,
              findOptions,
              'repository.record_count',
              searchAccessPath
            )
          );
          const countResult = await (
            countDbSpan && context.tracer
              ? context.tracer.withSpan(countDbSpan, () =>
                  dynamicDb.executeQuery<{ count: string }>(countCompiled)
                )
              : dynamicDb.executeQuery<{ count: string }>(countCompiled)
          ).finally(() => countDbSpan?.end());
          return ok(parseInt(countResult.rows[0]?.count ?? '0', 10));
        }.bind(this)
      );
    } catch (error) {
      return err(buildUnexpectedQueryError('Failed to count table records', error));
    } finally {
      span?.end();
    }
  }

  async find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    // Start tracing span for record query
    const span = context.tracer?.startSpan(
      'teable.repository.record.find',
      createRepositoryFindTraceAttributes(table, options, 'repository.record_find')
    );

    const executeFind = async (): Promise<Result<ITableRecordQueryResult, DomainError>> => {
      return await safeTry<ITableRecordQueryResult, DomainError>(
        async function* (this: PostgresTableRecordQueryRepository) {
          const readQuerySource = this.getRecordReadQuerySource(options);
          // Create query builder via manager (it handles prepare)
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: resolveQueryMode(table, options?.mode),
            sourceTableName: readQuerySource?.tableName,
          });
          const fieldMaskSqlMap = yield* buildFieldMaskSqlMap(options?.fieldMasks, TABLE_ALIAS);
          queryBuilder.fieldMaskSql?.(fieldMaskSqlMap);

          if (options?.projectionFieldIds !== undefined) {
            queryBuilder.select(options.projectionFieldIds);
          }
          // Ids-only reads keep filter/search/order semantics but select just
          // the record id column; incompatible extras (search matches, group
          // metadata, order columns) are skipped below.
          if (options?.idsOnly) {
            queryBuilder.idsOnly?.();
          }
          if (options?.valuesOnly) {
            queryBuilder.valuesOnly?.();
          }

          const dbTableName = yield* table.dbTableName();
          const tableName = yield* dbTableName.value();
          const sourceTableName = readQuerySource?.tableName ?? tableName;
          const [schemaName, tableNameOnly] = tableName.split('.');
          const dynamicDb = this.db as unknown as Kysely<DynamicDB>;

          const orderBy = options?.orderBy;
          const explicitRecordIdsOrder = options?.recordIdsOrder;
          if (!explicitRecordIdsOrder?.length) {
            if (orderBy && orderBy.length > 0) {
              await this.applyQueryOrderBy(
                queryBuilder,
                orderBy,
                dynamicDb,
                schemaName,
                tableNameOnly
              );
            } else if (!options?.valuesOnly) {
              // Default ordering by auto_number
              queryBuilder.orderBy('__auto_number', 'asc');
            }
          }

          // Apply pagination if provided. Cursor pages must not use OFFSET.
          const cursorSeekPlan = yield* await this.resolveCursorSeekPlan(
            table,
            orderBy,
            dynamicDb,
            schemaName,
            tableNameOnly
          );
          if (options?.cursor) {
            if (cursorSeekPlan === null) {
              return err(
                domainError.validation({
                  message: CURSOR_ORDER_BY_ERROR,
                })
              );
            }
            const parsedCursor = parseCursorToken(options.cursor);
            if (parsedCursor == null) {
              return err(
                domainError.validation({
                  message: 'Invalid list records cursor',
                })
              );
            }
            if (options.pagination) {
              queryBuilder.limit(options.pagination.limit().toNumber());
            }
            if (cursorSeekPlan === 'auto-number') {
              queryBuilder.whereExpression(
                sql`${sql.ref(`${TABLE_ALIAS}.__auto_number`)} > ${parsedCursor}` as Expression<SqlBool>
              );
            } else {
              const seekTableName = sourceTableName.includes('.')
                ? sourceTableName
                : `${schemaName}.${tableNameOnly}`;
              const [seekSchema, seekTable] = seekTableName.split('.');
              queryBuilder.whereExpression(
                buildBookmarkSeekExists(
                  sql`${sql.id(seekSchema!)}.${sql.id(seekTable!)}`,
                  parsedCursor,
                  cursorSeekPlan
                )
              );
            }
          } else if (options?.pagination) {
            queryBuilder.limit(options.pagination.limit().toNumber());
            queryBuilder.offset(options.pagination.offset().toNumber());
          }

          // Apply filter spec if provided
          if (spec) {
            queryBuilder.where(spec);
          }

          const whereClause = spec
            ? buildRecordWhereClause(spec, { tableAlias: TABLE_ALIAS })
            : ok(null);
          if (whereClause.isErr()) {
            return err(whereClause.error);
          }
          const searchWhereSpan = context.tracer?.startSpan(
            'teable.table.query.build_search_where',
            createRepositoryFindTraceAttributes(table, options, 'repository.record_find')
          );
          const searchWherePlan = buildRecordSearchWherePlan(table, options?.search, {
            tableAlias: TABLE_ALIAS,
            searchAccessPath: options?.searchAccessPath,
            fieldMaskSqlMap,
          });
          if (searchWherePlan.isErr()) {
            searchWhereSpan?.end();
            return err(searchWherePlan.error);
          }
          if (searchWherePlan.value.condition !== null) {
            queryBuilder.whereExpression(searchWherePlan.value.condition);
          }
          const searchAccessPath = createRecordSearchAccessPathResolution(
            options,
            searchWherePlan.value.usedAccessPath
          );
          const searchFieldMatches =
            options?.includeSearchFieldMatches && !options.idsOnly
              ? yield* buildRecordSearchFieldMatches(
                  table,
                  options.searchFieldMatchesSearch ?? options.search,
                  {
                    tableAlias: TABLE_ALIAS,
                    fieldMaskSqlMap,
                  }
                )
              : [];
          const actualSearchAttributes = createRepositoryFindTraceAttributes(
            table,
            options,
            'repository.record_find',
            searchAccessPath
          );
          searchWhereSpan?.setAttributes(actualSearchAttributes);
          searchWhereSpan?.end();
          span?.setAttributes(actualSearchAttributes);

          // Query order columns if requested
          let orderColumns: string[] = [];
          if (options?.includeOrders && !options.idsOnly) {
            // Query for order columns
            const orderColumnsResult = await sql<{ column_name: string }>`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = ${schemaName}
              AND table_name = ${tableNameOnly}
              AND column_name LIKE '__row_%'
            `.execute(dynamicDb);

            orderColumns = orderColumnsResult.rows.map((r) => r.column_name);
          }

          // Build the query
          let builtQuery = yield* queryBuilder.build();
          if (explicitRecordIdsOrder?.length) {
            const orderedRecordIds = explicitRecordIdsOrder.map((recordId) => recordId.toString());
            builtQuery = builtQuery.orderBy(
              sql`array_position(${orderedRecordIds}::text[], ${sql.ref(`${TABLE_ALIAS}.${RECORD_ID_COLUMN}`)})`
            );
          }

          // Add order columns to the query if requested
          if (orderColumns.length > 0) {
            for (const col of orderColumns) {
              builtQuery = builtQuery.select(sql.ref(`${TABLE_ALIAS}.${col}`).as(col));
            }
          }

          const compiled = this.withRecordReadQuerySource(builtQuery.compile(), readQuerySource);
          this.logger.debug(`find:mode:${queryBuilder.mode}:sql\n${compiled.sql}`, {
            parameters: compiled.parameters,
          });
          this.recordSqlDiagnostic(context, 'record_find', compiled);

          // Collect field column mappings (respect projection when provided)
          const fieldColumns = options?.idsOnly
            ? []
            : yield* new FieldOutputColumnVisitor().collect(table, options?.projectionFieldIds);
          const groupFieldColumns = options?.groupBy?.length
            ? yield* new FieldOutputColumnVisitor().collect(
                table,
                options.groupBy.map((item) => item.fieldId)
              )
            : [];
          const groupFields: Array<
            FieldOrderBy & {
              column: string;
              valueExpression: RawBuilder<unknown>;
              orderByClauses: ReadonlyArray<StoredFieldOrderByClause>;
            }
          > = [];
          for (const item of options?.groupBy ?? []) {
            const column = groupFieldColumns.find((candidate) =>
              candidate.fieldId.equals(item.fieldId)
            )?.columnAlias;
            if (!column) {
              return err(
                domainError.notFound({
                  message: `Group field column not found: ${item.fieldId.toString()}`,
                })
              );
            }
            const field = yield* table.getField((candidate) => candidate.id().equals(item.fieldId));
            const { expression: rawValueExpression } = yield* buildGroupFieldValueExpression(
              field,
              column
            );
            const maskSql = fieldMaskSqlMap?.get(item.fieldId.toString());
            const valueExpression = maskSql
              ? maskValueExpression(maskSql, rawValueExpression)
              : rawValueExpression;
            // Refer to the selected group alias in ORDER BY. Repeating a
            // parameterized CASE expression allocates different $n bindings;
            // PostgreSQL then no longer recognizes it as the GROUP BY key.
            const orderByClauses = yield* buildStoredFieldOrderByClauses(
              field,
              column,
              item.direction,
              TABLE_ALIAS,
              { columnExpression: sql.ref(`${GROUP_RESULT_ALIAS}.${item.fieldId.toString()}`) }
            );
            groupFields.push({ ...item, column, valueExpression, orderByClauses });
          }

          try {
            // Group queries return the full scoped row count through a window
            // aggregate, so only ungrouped reads need a standalone count query.
            const shouldQueryTotal = groupFields.length === 0 && options?.includeTotal !== false;
            const recordsDbSpan = context.tracer?.startSpan(
              'teable.table.query.db.records',
              createRepositoryFindTraceAttributes(
                table,
                options,
                'repository.record_find',
                searchAccessPath
              )
            );
            const rowsPromise = (
              recordsDbSpan && context.tracer
                ? context.tracer.withSpan(recordsDbSpan, () =>
                    dynamicDb.executeQuery<Record<string, unknown>>(compiled)
                  )
                : dynamicDb.executeQuery<Record<string, unknown>>(compiled)
            )
              .then((result) => result.rows)
              .finally(() => recordsDbSpan?.end());
            const countCompiled = shouldQueryTotal
              ? this.withRecordReadQuerySource(
                  dynamicDb
                    .selectFrom(`${sourceTableName} as ${TABLE_ALIAS}`)
                    .select(sql<string>`count(*)`.as('count'))
                    .$if(whereClause.value !== null, (qb) =>
                      qb.where(whereClause.value as Expression<SqlBool>)
                    )
                    .$if(searchWherePlan.value.condition !== null, (qb) =>
                      qb.where(searchWherePlan.value.condition as Expression<SqlBool>)
                    )
                    .compile(),
                  readQuerySource
                )
              : undefined;
            if (countCompiled) {
              this.recordSqlDiagnostic(context, 'record_count', countCompiled);
            }
            const countDbSpan = countCompiled
              ? context.tracer?.startSpan(
                  'teable.table.query.db.count',
                  createRepositoryFindTraceAttributes(
                    table,
                    options,
                    'repository.record_count',
                    searchAccessPath
                  )
                )
              : undefined;
            const countPromise = countCompiled
              ? (countDbSpan && context.tracer
                  ? context.tracer.withSpan(countDbSpan, () =>
                      dynamicDb.executeQuery<{ count: string }>(countCompiled)
                    )
                  : dynamicDb.executeQuery<{ count: string }>(countCompiled)
                )
                  .then((result) => result.rows[0] ?? { count: '0' })
                  .finally(() => countDbSpan?.end())
              : Promise.resolve<{ count: string }>({ count: '0' });

            let groupCompiled: CompiledQuery<Record<string, unknown>> | undefined;
            if (groupFields.length) {
              const groupedRows = dynamicDb
                .selectFrom(`${sourceTableName} as ${TABLE_ALIAS}`)
                .select(
                  groupFields.map((item) =>
                    sql`${item.valueExpression}`.as(item.fieldId.toString())
                  )
                )
                .select(sql<string>`count(*)`.as('__count'))
                .select(sql<string>`sum(count(*)) over ()`.as('__total'))
                .$if(whereClause.value !== null, (qb) =>
                  qb.where(whereClause.value as Expression<SqlBool>)
                )
                .$if(searchWherePlan.value.condition !== null, (qb) =>
                  qb.where(searchWherePlan.value.condition as Expression<SqlBool>)
                )
                // GROUP BY SELECT ordinals so parameterized mask CASE
                // expressions are compiled once in the inner select list.
                .groupBy(groupFields.map((_, index) => sql.raw(String(index + 1))));
              let groupQuery = dynamicDb.selectFrom(groupedRows.as(GROUP_RESULT_ALIAS)).selectAll();

              for (const item of groupFields) {
                for (const clause of item.orderByClauses) {
                  groupQuery = applyStoredFieldOrderByClause(groupQuery, clause);
                }
              }
              if (options?.groupLimit) {
                groupQuery = groupQuery.limit(options.groupLimit);
              }
              groupCompiled = this.withRecordReadQuerySource(groupQuery.compile(), readQuerySource);
              this.recordSqlDiagnostic(context, 'record_group', groupCompiled);
            }
            const groupsPromise = groupCompiled
              ? dynamicDb.executeQuery<Record<string, unknown>>(groupCompiled).then((result) => ({
                  groups: result.rows.map((row) => {
                    const fields: Record<string, unknown> = {};
                    for (const item of groupFields) {
                      fields[item.fieldId.toString()] = row[item.fieldId.toString()];
                    }
                    return {
                      fields,
                      count: Number(row.__count),
                    };
                  }),
                  total: Number(result.rows[0]?.__total ?? 0),
                }))
              : Promise.resolve(undefined);

            const [rows, countResult, groupResult] = await Promise.all([
              rowsPromise,
              countPromise,
              groupsPromise,
            ]);

            const records = mapRowsToReadModels(fieldColumns, rows, orderColumns);
            const groups = groupResult?.groups;
            const total = groupResult
              ? groupResult.total
              : shouldQueryTotal
                ? parseInt(countResult.count, 10)
                : records.length;
            const pageRecordIds = options?.includeSearchFieldMatches
              ? rows.map((row) => String(row[RECORD_ID_COLUMN]))
              : [];
            const shouldLoadMatchFlags =
              options?.includeSearchFieldMatches &&
              searchFieldMatches.length > 0 &&
              rows.length > 0;
            const matchFlagsDbSpan = shouldLoadMatchFlags
              ? context.tracer?.startSpan('teable.table.query.db.search_match', {
                  ...actualSearchAttributes,
                })
              : undefined;
            const matchFlagsPromise = shouldLoadMatchFlags
              ? (matchFlagsDbSpan && context.tracer
                  ? context.tracer.withSpan(matchFlagsDbSpan, () =>
                      this.loadSearchFieldMatchFlags(
                        context,
                        options,
                        sourceTableName,
                        pageRecordIds,
                        searchFieldMatches
                      )
                    )
                  : this.loadSearchFieldMatchFlags(
                      context,
                      options,
                      sourceTableName,
                      pageRecordIds,
                      searchFieldMatches
                    )
                ).finally(() => matchFlagsDbSpan?.end())
              : Promise.resolve(ok<ReadonlyArray<Record<string, unknown>>, DomainError>([]));
            const [viewIndexByRecordId, searchMatchRows] = await Promise.all([
              options?.includeSearchFieldMatches && options.searchIndexMode === 'view'
                ? this.loadViewIndexes(context, table, spec, options, pageRecordIds)
                : Promise.resolve(ok(undefined)),
              matchFlagsPromise,
            ]);
            if (viewIndexByRecordId.isErr()) return err(viewIndexByRecordId.error);
            if (searchMatchRows.isErr()) return err(searchMatchRows.error);
            const matchFlagsByRecordId = new Map(
              searchMatchRows.value.map((row) => [String(row[RECORD_ID_COLUMN]), row] as const)
            );
            const searchMatches = options?.includeSearchFieldMatches
              ? yield* this.mapSearchMatches(
                  rows,
                  searchFieldMatches,
                  options.pagination?.offset().toNumber() ?? 0,
                  options.searchIndexMode ?? 'matched',
                  viewIndexByRecordId.value,
                  matchFlagsByRecordId
                )
              : undefined;

            const pageLimit = options?.pagination?.limit().toNumber();
            const nextCursor =
              pageLimit != null && records.length === pageLimit && cursorSeekPlan !== null
                ? getLastAutoNumberCursor(records)
                : undefined;
            return ok({
              records,
              total,
              ...(groups ? { groups } : {}),
              ...(searchAccessPath ? { searchAccessPath } : {}),
              ...(searchMatches ? { searchMatches } : {}),
              ...(nextCursor ? { nextCursor } : {}),
            });
          } catch (error) {
            span?.recordError(describeError(error));
            return err(buildUnexpectedQueryError('Failed to load table records', error));
          }
        }.bind(this)
      );
    };

    try {
      // Use withSpan to set span as active context so pg queries become children
      if (span && context.tracer) {
        return await context.tracer.withSpan(span, executeFind);
      }
      return await executeFind();
    } finally {
      span?.end();
    }
  }

  private mapSearchMatches(
    rows: ReadonlyArray<Record<string, unknown>>,
    fieldMatches: ReadonlyArray<RecordSearchFieldMatch>,
    offset: number,
    mode: 'matched' | 'view',
    viewIndexByRecordId?: ReadonlyMap<string, number>,
    matchFlagsByRecordId?: ReadonlyMap<string, Record<string, unknown>>
  ): Result<ReadonlyArray<ITableRecordSearchMatch>, DomainError> {
    return safeTry(function* () {
      const result: ITableRecordSearchMatch[] = [];
      for (const [rowOffset, row] of rows.entries()) {
        const rawRecordId = String(row[RECORD_ID_COLUMN]);
        const recordId = yield* RecordId.create(rawRecordId);
        const index =
          mode === 'view' ? viewIndexByRecordId?.get(rawRecordId) : offset + rowOffset + 1;
        if (index == null) {
          return err(
            domainError.notFound({
              code: 'record.index_not_found',
              message: `Record index not found: ${rawRecordId}`,
            })
          );
        }

        const flagRow = matchFlagsByRecordId?.get(rawRecordId);
        if (!flagRow) continue;
        for (const [fieldOffset, match] of fieldMatches.entries()) {
          if (flagRow[`__search_match_${fieldOffset}`] !== true) continue;
          result.push({
            index,
            fieldId: yield* FieldId.create(match.field.id().toString()),
            recordId,
          });
        }
      }
      return ok(result);
    });
  }

  private async loadSearchFieldMatchFlags(
    context: IExecutionContext,
    options: ITableRecordQueryOptions | undefined,
    sourceTableName: string,
    recordIds: ReadonlyArray<string>,
    fieldMatches: ReadonlyArray<RecordSearchFieldMatch>
  ): Promise<Result<ReadonlyArray<Record<string, unknown>>, DomainError>> {
    if (!recordIds.length || fieldMatches.length === 0) return ok([]);

    try {
      const readQuerySource = this.getRecordReadQuerySource(options);
      const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
      let query = dynamicDb
        .selectFrom(`${sourceTableName} as ${TABLE_ALIAS}`)
        .select(sql.ref(`${TABLE_ALIAS}.${RECORD_ID_COLUMN}`).as(RECORD_ID_COLUMN));
      for (const [index, match] of fieldMatches.entries()) {
        query = query.select(
          sql<boolean>`CASE WHEN ${match.condition} THEN true ELSE false END`.as(
            `__search_match_${index}`
          )
        );
      }
      // One array bind parameter keeps the plan shape stable across page sizes
      // (an IN list re-plans per distinct member count).
      const compiled = this.withRecordReadQuerySource(
        query
          .where(
            sql<SqlBool>`${sql.ref(`${TABLE_ALIAS}.${RECORD_ID_COLUMN}`)} = ANY(${[...recordIds]}::text[])`
          )
          .compile(),
        readQuerySource
      );
      this.recordSqlDiagnostic(context, 'record_search_field_matches', compiled);
      const rows = await dynamicDb.executeQuery<Record<string, unknown>>(compiled);
      return ok(rows.rows);
    } catch (error) {
      return err(buildUnexpectedQueryError('Failed to load search field matches', error));
    }
  }

  private async loadViewIndexes(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryOptions,
    recordIds: ReadonlyArray<string>
  ): Promise<Result<ReadonlyMap<string, number>, DomainError>> {
    if (!recordIds.length) return ok(new Map());

    return safeTry(
      async function* (this: PostgresTableRecordQueryRepository) {
        const readQuerySource = this.getRecordReadQuerySource(options);
        const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
          // Row numbers are storage order. Link tables otherwise resolve to
          // computed mode, which has no idsOnly and would evaluate every
          // lookup/link for all ~160k rows (T7058).
          mode: 'stored',
          sourceTableName: readQuerySource?.tableName,
        });
        queryBuilder.idsOnly?.();
        const explicitRecordIdsOrder = options.recordIdsOrder;
        if (!explicitRecordIdsOrder?.length) {
          if (options.orderBy?.length) {
            const dbTableName = yield* table.dbTableName();
            const fullTableName = yield* dbTableName.value();
            const [schemaName, tableName] = fullTableName.split('.');
            const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
            await this.applyQueryOrderBy(
              queryBuilder,
              options.orderBy,
              dynamicDb,
              schemaName,
              tableName
            );
          } else {
            queryBuilder.orderBy('__auto_number', 'asc');
          }
        }
        if (spec) queryBuilder.where(spec);

        let viewRows = yield* queryBuilder.build();
        if (explicitRecordIdsOrder?.length) {
          const orderedIds = explicitRecordIdsOrder.map((recordId) => recordId.toString());
          viewRows = viewRows.orderBy(
            sql`array_position(${orderedIds}::text[], ${sql.ref(`${TABLE_ALIAS}.${RECORD_ID_COLUMN}`)})`
          );
        }

        const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
        const indexedRows = dynamicDb
          .selectFrom(viewRows.as('view_rows'))
          .select(sql.ref(`view_rows.${RECORD_ID_COLUMN}`).as(RECORD_ID_COLUMN))
          .select(sql<number>`row_number() over ()`.as('__row_index'))
          .as('indexed_rows');
        const compiled = this.withRecordReadQuerySource(
          dynamicDb
            .selectFrom(indexedRows)
            .select([
              sql.ref(`indexed_rows.${RECORD_ID_COLUMN}`).as(RECORD_ID_COLUMN),
              sql.ref('indexed_rows.__row_index').as('__row_index'),
            ])
            .where(sql.ref(`indexed_rows.${RECORD_ID_COLUMN}`), 'in', recordIds)
            .compile(),
          readQuerySource
        );
        this.recordSqlDiagnostic(context, 'record_search_view_index', compiled);
        const rows = await dynamicDb.executeQuery<{
          __id: string;
          __row_index: string | number;
        }>(compiled);
        return ok(
          new Map(rows.rows.map((row) => [String(row[RECORD_ID_COLUMN]), Number(row.__row_index)]))
        );
      }.bind(this)
    );
  }

  async findOne(
    context: IExecutionContext,
    table: Table,
    recordId: RecordId,
    options?: Pick<ITableRecordQueryOptions, 'mode' | 'includeOrders' | 'recordReadQuerySource'>
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    const span = context.tracer?.startSpan('teable.repository.record.findOne');

    const executeFindOne = async (): Promise<Result<TableRecordReadModel, DomainError>> => {
      return await safeTry<TableRecordReadModel, DomainError>(
        async function* (this: PostgresTableRecordQueryRepository) {
          const readQuerySource = this.getRecordReadQuerySource(options);
          // Create query builder via manager
          const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
            mode: resolveQueryMode(table, options?.mode),
            sourceTableName: readQuerySource?.tableName,
          });

          // Filter by record ID via specification
          const recordSpec = RecordByIdSpec.create(recordId);
          queryBuilder.where(recordSpec);

          // Limit to 1
          queryBuilder.limit(1);

          let orderColumns: string[] = [];
          if (options?.includeOrders) {
            const dbTableName = yield* table.dbTableName();
            const tableName = yield* dbTableName.value();
            const [schemaName, tableNameOnly] = tableName.split('.');
            const dynamicDb = this.db as unknown as Kysely<DynamicDB>;
            const orderColumnsResult = await sql<{ column_name: string }>`
              SELECT column_name
              FROM information_schema.columns
              WHERE table_schema = ${schemaName}
              AND table_name = ${tableNameOnly}
              AND column_name LIKE '__row_%'
            `.execute(dynamicDb);

            orderColumns = orderColumnsResult.rows.map((r) => r.column_name);
          }

          // Build the query
          let builtQuery = yield* queryBuilder.build();

          if (orderColumns.length > 0) {
            for (const col of orderColumns) {
              builtQuery = builtQuery.select(sql.ref(`${TABLE_ALIAS}.${col}`).as(col));
            }
          }

          const compiled = this.withRecordReadQuerySource(builtQuery.compile(), readQuerySource);
          this.logger.debug(`findOne:mode:${queryBuilder.mode}:sql\n${compiled.sql}`, {
            parameters: compiled.parameters,
          });

          // Collect field column mappings
          const fieldColumns = yield* new FieldOutputColumnVisitor().collect(table);

          try {
            const rows = (await (this.db as unknown as Kysely<DynamicDB>).executeQuery(compiled))
              .rows;

            if (rows.length === 0) {
              return err(
                domainError.notFound({ code: 'record.not_found', message: 'Record not found' })
              );
            }

            const records = mapRowsToReadModels(fieldColumns, rows, orderColumns);
            return ok(records[0]);
          } catch (error) {
            span?.recordError(describeError(error));
            return err(buildUnexpectedQueryError('Failed to load record', error));
          }
        }.bind(this)
      );
    };

    try {
      // Use withSpan to set span as active context so pg queries become children
      if (span && context.tracer) {
        return await context.tracer.withSpan(span, executeFindOne);
      }
      return await executeFindOne();
    } finally {
      span?.end();
    }
  }

  async *findStream(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const DEFAULT_BATCH_SIZE = 500;
    const batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    let yieldedCount = 0;
    let lastBatchCount: number | undefined;
    let lastCursor: string | undefined;
    const paginationStrategy =
      options?.paginationStrategy ?? this.resolvePaginationStrategy(options?.pagination);

    while (true) {
      const nextPage = paginationStrategy.next({
        pagination: options?.pagination,
        batchSize,
        yieldedCount,
        lastBatchCount,
        lastCursor,
      });
      if (!nextPage) {
        break;
      }
      const result =
        nextPage.type === 'offset'
          ? await this.findByOffsetPage(
              context,
              table,
              spec,
              options,
              nextPage.limit,
              nextPage.offset
            )
          : await this.findByCursorPage(
              context,
              table,
              spec,
              options,
              nextPage.limit,
              nextPage.cursor
            );

      if (result.isErr()) {
        yield err(result.error);
        return;
      }

      const records = result.value;
      lastBatchCount = records.length;
      if (records.length === 0) {
        // No more records
        break;
      }

      // Yield each record individually
      for (const record of records) {
        yield ok(record);
        yieldedCount++;
      }

      if (nextPage.type === 'cursor') {
        const nextCursor = getLastAutoNumberCursor(records);
        if (!nextCursor) {
          this.logger.warn(
            'findStream: cursor pagination cannot advance because last record has no autoNumber'
          );
          break;
        }
        lastCursor = nextCursor;
      }

      // If we got fewer records than requested, we've reached the end
      if (records.length < nextPage.limit) {
        break;
      }
    }
  }

  private async findByOffsetPage(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryStreamOptions | undefined,
    limit: number,
    offset: number
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    const pageLimitResult = PageLimit.create(limit);
    if (pageLimitResult.isErr()) {
      return err(pageLimitResult.error);
    }
    const pageOffsetResult = PageOffset.create(offset);
    if (pageOffsetResult.isErr()) {
      return err(pageOffsetResult.error);
    }

    const pagination = OffsetPagination.create(pageLimitResult.value, pageOffsetResult.value);
    const result = await this.find(context, table, spec, {
      mode: options?.mode,
      pagination,
      orderBy: options?.orderBy,
      includeOrders: options?.includeOrders,
      includeTotal: false,
      projectionFieldIds: options?.projectionFieldIds,
      search: options?.search,
      searchAccessPath: options?.searchAccessPath,
      recordReadQuerySource: options?.recordReadQuerySource,
    });

    if (result.isErr()) {
      return err(result.error);
    }

    return ok(result.value.records);
  }

  private async findByCursorPage(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryStreamOptions | undefined,
    limit: number,
    cursor: string | undefined
  ): Promise<Result<ReadonlyArray<TableRecordReadModel>, DomainError>> {
    return await safeTry<ReadonlyArray<TableRecordReadModel>, DomainError>(
      async function* (this: PostgresTableRecordQueryRepository) {
        const queryBuilder = yield* await this.queryBuilderManager.createBuilder(context, table, {
          mode: resolveQueryMode(table, options?.mode),
          sourceTableName: this.getRecordReadQuerySource(options)?.tableName,
        });

        if (!isAutoNumberOnlyCursorOrderBy(options?.orderBy)) {
          return err(
            domainError.validation({
              message: CURSOR_ORDER_BY_ERROR,
            })
          );
        }

        if (options?.projectionFieldIds !== undefined) {
          queryBuilder.select(options.projectionFieldIds);
        }

        queryBuilder.orderBy('__auto_number', 'asc');
        queryBuilder.limit(limit);

        if (spec) {
          queryBuilder.where(spec);
        }

        const searchWhereClause = buildRecordSearchWhereClause(table, options?.search, {
          tableAlias: TABLE_ALIAS,
          searchAccessPath: options?.searchAccessPath,
        });
        if (searchWhereClause.isErr()) {
          return err(searchWhereClause.error);
        }
        if (searchWhereClause.value !== null) {
          queryBuilder.whereExpression(searchWhereClause.value);
        }

        const parsedCursor = parseCursorToken(cursor);
        if (cursor != null && parsedCursor == null) {
          this.logger.warn('findStream: invalid cursor token, fallback to stream start', {
            cursor,
          });
        }
        if (parsedCursor != null) {
          queryBuilder.whereExpression(
            sql`${sql.ref(`${TABLE_ALIAS}.__auto_number`)} > ${parsedCursor}` as Expression<SqlBool>
          );
        }

        const builtQuery = yield* queryBuilder.build();

        const compiled = this.withRecordReadQuerySource(
          builtQuery.compile(),
          this.getRecordReadQuerySource(options)
        );
        this.logger.debug(`findStream:mode:${queryBuilder.mode}:cursor:sql\n${compiled.sql}`, {
          parameters: compiled.parameters,
        });
        this.recordSqlDiagnostic(context, 'record_stream_cursor', compiled);

        const fieldColumns = yield* new FieldOutputColumnVisitor().collect(
          table,
          options?.projectionFieldIds
        );

        try {
          const rows = (await (this.db as unknown as Kysely<DynamicDB>).executeQuery(compiled))
            .rows;
          const records = mapRowsToReadModels(fieldColumns, rows, []);
          return ok(records);
        } catch (error) {
          return err(buildUnexpectedQueryError('Failed to load table records by cursor', error));
        }
      }.bind(this)
    );
  }

  private resolvePaginationStrategy(
    pagination: ITableRecordStreamPagination | undefined
  ): ITableRecordStreamPaginationStrategy {
    return (
      this.streamPaginationStrategies.find((strategy) => strategy.accepts(pagination)) ??
      this.defaultStreamPaginationStrategy
    );
  }

  /**
   * `null` cannot seek. `'auto-number'` uses `__auto_number > n`.
   * Otherwise bookmark the last row and compare the same stored order keys.
   */
  private async resolveCursorSeekPlan(
    table: Table,
    orderBy: ReadonlyArray<TableRecordOrderBy> | undefined,
    dynamicDb: Kysely<DynamicDB>,
    schemaName: string,
    tableNameOnly: string
  ): Promise<Result<'auto-number' | CursorSeekKey[] | null, DomainError>> {
    if (isAutoNumberOnlyCursorOrderBy(orderBy)) {
      return ok('auto-number');
    }
    if (!orderByHasAutoNumberAsc(orderBy) || !orderBy?.length) {
      return ok(null);
    }

    const keys: CursorSeekKey[] = [];
    for (const sort of orderBy) {
      if (isFieldOrderBy(sort)) {
        const fieldResult = table.getField((field) => field.id().equals(sort.fieldId));
        if (fieldResult.isErr()) {
          return err(fieldResult.error);
        }
        const field = fieldResult.value;
        if (!isRawColumnCursorField(field)) {
          return ok(null);
        }
        const columnResult = field.dbFieldName().andThen((name) => name.value());
        if (columnResult.isErr()) {
          return err(columnResult.error);
        }
        const column = columnResult.value;
        keys.push({
          left: sql.ref(`${TABLE_ALIAS}.${column}`),
          right: sql.ref(`__seek.${column}`),
          direction: sort.direction,
          matchV1Nulls: true,
        });
        continue;
      }
      if (!isSystemColumnOrderBy(sort)) {
        return ok(null);
      }
      if (sort.column === '__auto_number') {
        if (sort.direction !== 'asc') {
          return ok(null);
        }
        keys.push({
          left: sql.ref(`${TABLE_ALIAS}.__auto_number`),
          right: sql.ref(`__seek.__auto_number`),
          direction: 'asc',
          matchV1Nulls: false,
        });
        continue;
      }
      if (!sort.column.startsWith('__row_')) {
        return ok(null);
      }
      const columnExists = await this.getOrderColumnExists(
        dynamicDb,
        schemaName,
        tableNameOnly,
        sort.column
      );
      if (!columnExists) {
        continue;
      }
      keys.push({
        left: sql.ref(`${TABLE_ALIAS}.${sort.column}`),
        right: sql.ref(`__seek.${sort.column}`),
        direction: sort.direction,
        matchV1Nulls: true,
      });
    }

    if (keys.length === 0) {
      return ok(null);
    }
    const onlyAutoNumber = keys.length === 1 && keys[0]?.matchV1Nulls === false;
    if (onlyAutoNumber) {
      return ok('auto-number');
    }
    return ok(keys);
  }

  /**
   * Apply list/view order keys. Missing `__row_*` columns fall back to
   * `__auto_number` only when that tie-breaker is not already in the list —
   * `mergeOrderBy` always appends it, and a second copy blocked btree scans.
   */
  private async applyQueryOrderBy(
    queryBuilder: ITableRecordQueryBuilder,
    orderBy: ReadonlyArray<TableRecordOrderBy>,
    dynamicDb: Kysely<DynamicDB>,
    schemaName: string,
    tableNameOnly: string
  ): Promise<void> {
    const hasLaterAutoNumber = (fromIndex: number) =>
      orderBy
        .slice(fromIndex + 1)
        .some((item) => isSystemColumnOrderBy(item) && item.column === '__auto_number');

    for (let index = 0; index < orderBy.length; index += 1) {
      const sort = orderBy[index];
      if (isFieldOrderBy(sort)) {
        queryBuilder.orderBy(sort.fieldId, sort.direction, {
          groupIdentityCollation: sort.groupIdentityCollation,
        });
        continue;
      }
      if (!isSystemColumnOrderBy(sort)) {
        continue;
      }
      const column = sort.column;
      if (column.startsWith('__row_')) {
        const columnExists = await this.getOrderColumnExists(
          dynamicDb,
          schemaName,
          tableNameOnly,
          column
        );
        if (columnExists) {
          queryBuilder.orderBy(column as '__auto_number', sort.direction);
        } else if (!hasLaterAutoNumber(index)) {
          queryBuilder.orderBy('__auto_number', 'asc');
        }
        continue;
      }
      queryBuilder.orderBy(column as '__auto_number', sort.direction);
    }
  }

  private async getOrderColumnExists(
    db: Kysely<DynamicDB>,
    schemaName: string,
    tableName: string,
    columnName: string
  ): Promise<boolean> {
    const now = Date.now();
    const cacheKey = `${schemaName}.${tableName}.${columnName}`;
    const cached = this.orderColumnExistsCache.get(cacheKey);
    if (cached && now - cached.cachedAt <= ORDER_COLUMN_CACHE_TTL_MS) {
      return cached.exists;
    }

    const columnCheckResult = await sql<{ exists: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = ${schemaName}
        AND table_name = ${tableName}
        AND column_name = ${columnName}
      ) as exists
    `.execute(db);

    const exists = Boolean(columnCheckResult.rows[0]?.exists);
    if (exists) {
      this.orderColumnExistsCache.set(cacheKey, {
        exists,
        cachedAt: now,
      });
    }
    return exists;
  }

  private getRecordReadQuerySource(
    options: { readonly recordReadQuerySource?: IRecordReadQuerySource } | undefined
  ): IRecordReadQuerySource | undefined {
    const source = options?.recordReadQuerySource;
    if (!source) {
      return undefined;
    }
    if (
      typeof source.tableName !== 'string' ||
      typeof source.cteName !== 'string' ||
      typeof source.cteSql !== 'string'
    ) {
      return undefined;
    }
    return source;
  }

  private recordSqlDiagnostic(
    context: IExecutionContext,
    source: string,
    compiled: CompiledQuery<unknown>
  ): void {
    const collector = (context as IExecutionContextWithTableQuerySqlDiagnostics)[
      TABLE_QUERY_SQL_DIAGNOSTICS_CONTEXT_KEY
    ];
    if (!collector?.record) {
      return;
    }
    try {
      collector.record({
        source,
        sql: compiled.sql,
        parameters: compiled.parameters,
      });
    } catch {
      // Best-effort diagnostics must never affect user-facing queries.
    }
  }

  private withRecordReadQuerySource<O>(
    compiled: CompiledQuery<O>,
    source?: IRecordReadQuerySource
  ): CompiledQuery<O> {
    if (!source) {
      return compiled;
    }
    const cteName = source.cteName.trim();
    if (!/^[A-Z_]\w*$/i.test(cteName)) {
      this.logger.warn('Skip invalid record read CTE name', {
        cteName,
      });
      return compiled;
    }
    const escapedName = cteName.replace(/"/g, '""');
    const sqlWithCte = `with "${escapedName}" as (${source.cteSql}) ${compiled.sql}`;
    return CompiledQuery.raw(sqlWithCte, Array.from(compiled.parameters)) as CompiledQuery<O>;
  }
}

const mapRowsToReadModels = (
  fieldColumns: ReadonlyArray<FieldOutputColumn>,
  rows: ReadonlyArray<Record<string, unknown>>,
  orderColumns: string[] = []
): ReadonlyArray<TableRecordReadModel> => {
  return rows.map((row) => {
    const rawId = row[RECORD_ID_COLUMN];
    const id = typeof rawId === 'string' ? rawId : String(rawId);

    const rawVersion = row[RECORD_VERSION_COLUMN];
    const version = typeof rawVersion === 'number' ? rawVersion : Number(rawVersion) || 0;

    // Extract system columns for undo/redo support
    const rawAutoNumber = row['__auto_number'];
    const autoNumber =
      typeof rawAutoNumber === 'number'
        ? rawAutoNumber
        : rawAutoNumber != null
          ? Number(rawAutoNumber)
          : undefined;

    const rawCreatedTime = row['__created_time'];
    const createdTime =
      rawCreatedTime instanceof Date
        ? rawCreatedTime.toISOString()
        : typeof rawCreatedTime === 'string'
          ? rawCreatedTime
          : undefined;

    const rawCreatedBy = row['__created_by'];
    const createdBy = typeof rawCreatedBy === 'string' ? rawCreatedBy : undefined;

    const rawLastModifiedTime = row['__last_modified_time'];
    const lastModifiedTime =
      rawLastModifiedTime instanceof Date
        ? rawLastModifiedTime.toISOString()
        : typeof rawLastModifiedTime === 'string'
          ? rawLastModifiedTime
          : undefined;

    const rawLastModifiedBy = row['__last_modified_by'];
    const lastModifiedBy = typeof rawLastModifiedBy === 'string' ? rawLastModifiedBy : undefined;

    // Extract order values if order columns were requested
    let orders: Record<string, number> | undefined;
    if (orderColumns.length > 0) {
      orders = {};
      for (const colName of orderColumns) {
        const orderValue = row[colName];
        const parsedOrder =
          typeof orderValue === 'number'
            ? orderValue
            : orderValue != null
              ? Number(orderValue)
              : undefined;
        if (parsedOrder != null && Number.isFinite(parsedOrder)) {
          // Extract viewId from column name (format: __row_{viewId})
          const viewId = colName.replace('__row_', '');
          orders[viewId] = parsedOrder;
        }
      }
      if (Object.keys(orders).length === 0) {
        orders = undefined;
      }
    }

    const fields: Record<string, unknown> = {};
    for (const column of fieldColumns) {
      const value = row[column.columnAlias];
      fields[column.fieldId.toString()] =
        column.valueKind === 'user' ? normalizeStoredUserAvatarUrls(value) : value;
    }
    return {
      id,
      fields,
      version,
      autoNumber,
      createdTime,
      createdBy,
      lastModifiedTime,
      lastModifiedBy,
      orders,
    };
  });
};

const normalizeStoredGroupValue = (field: Field, value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    field.type().equals(FieldType.user()) ||
    field.type().equals(FieldType.createdBy()) ||
    field.type().equals(FieldType.lastModifiedBy())
  ) {
    return normalizeStoredUserAvatarUrls(value);
  }
  return value;
};

const normalizeStoredUserAvatarUrls = (value: unknown): unknown => {
  if (typeof value === 'string') {
    if (!value.includes(LEGACY_AVATAR_PREFIX)) {
      return value;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      const normalized = normalizeStoredUserAvatarUrls(parsed);
      return normalized === parsed ? value : normalized;
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeStoredUserAvatarUrls(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const item = value as Record<string, unknown>;
  const id = item.id;
  if (typeof id !== 'string' || id.length === 0) {
    return value;
  }

  const avatarUrl = item.avatarUrl;
  if (typeof avatarUrl === 'string' && !avatarUrl.startsWith(LEGACY_AVATAR_PREFIX)) {
    return value;
  }

  return {
    ...item,
    avatarUrl: buildUserAvatarUrl(id),
  };
};

const describeError = (error: unknown): string => {
  if (isDomainError(error)) return error.message;
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name;
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    return json ?? String(error);
  } catch {
    return String(error);
  }
};

const extractDatabaseErrorDetails = (
  error: unknown
): Readonly<Record<string, unknown>> | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as Record<string, unknown>;
  const details: Record<string, unknown> = {};

  if (typeof candidate.code === 'string') {
    details.pgCode = candidate.code;
  }
  if (typeof candidate.column === 'string') {
    details.column = candidate.column;
  }
  if (typeof candidate.table === 'string') {
    details.table = candidate.table;
  }
  if (typeof candidate.schema === 'string') {
    details.schema = candidate.schema;
  }
  if (typeof candidate.constraint === 'string') {
    details.constraint = candidate.constraint;
  }

  return Object.keys(details).length > 0 ? details : undefined;
};

const buildUnexpectedQueryError = (prefix: string, error: unknown): DomainError => {
  const details = extractDatabaseErrorDetails(error);
  const pgCode = details?.pgCode;

  return domainError.unexpected({
    ...(pgCode === '42703' ? { code: 'db.undefined_column' } : {}),
    ...(details ? { details } : {}),
    message: `${prefix}: ${describeError(error)}`,
  });
};

const resolveQueryMode = (
  table: Table,
  mode: TableRecordQueryMode | undefined
): TableRecordQueryMode => {
  if (mode) return mode;
  const needsComputedLinks = table
    .getFields()
    .some((field) => field.type().equals(FieldType.link()));
  if (needsComputedLinks) return 'computed';
  const hasConditionalFields = table
    .getFields()
    .some(
      (field) =>
        field.type().equals(FieldType.conditionalRollup()) ||
        field.type().equals(FieldType.conditionalLookup())
    );
  return hasConditionalFields ? 'computed' : 'stored';
};
