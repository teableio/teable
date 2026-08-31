import {
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableRecordAggregationQueryRepository,
  type ITableRecordCalendarQueryRepository,
  type ITableRecordCollaboratorQueryRepository,
  type ITableRecordConditionSpecVisitor,
  type ITableRecordCountOptions,
  type ITableRecordCountQueryRepository,
  type ITableRecordQueryOptions,
  type ITableRecordQueryRepository,
  type ITableRecordQueryResult,
  type ITableRecordQueryStreamOptions,
  type ISpecification,
  type Table,
  type TableRecord,
  type TableRecordReadModel,
} from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import type { Result } from 'neverthrow';

import {
  TableQueryObservationWindow,
  TableQueryShape,
  type TableQueryAggregationShape,
  type TableQueryExecutionShape,
  type TableQueryKind,
  type TableQueryOrderFieldShape,
  type TableQuerySqlDiagnostic,
} from './domain';
import type { TableQueryObservationPublisher } from './ports';
import {
  attachTableQuerySqlDiagnosticsCollector,
  defaultTableQuerySqlDiagnosticsConfig,
  type TableQuerySqlDiagnosticsConfig,
} from './sqlDiagnostics';
import { v2TableOpsTokens } from './tokens';

const observedRepositoryMarker = Symbol('v2.tableOps.observedTableRecordQueryRepository');

type ObservableTableRecordQueryRepository = ITableRecordQueryRepository &
  ITableRecordCountQueryRepository &
  ITableRecordAggregationQueryRepository &
  ITableRecordCalendarQueryRepository &
  ITableRecordCollaboratorQueryRepository;

type ObservationShapeExtras = {
  readonly queryKind?: TableQueryKind;
  readonly aggregationShape?: TableQueryAggregationShape;
};

export class ObservedTableRecordQueryRepository implements ObservableTableRecordQueryRepository {
  readonly [observedRepositoryMarker] = true;

  constructor(
    private readonly inner: ObservableTableRecordQueryRepository,
    private readonly observationPublisher: TableQueryObservationPublisher,
    private readonly sqlDiagnosticsConfig: TableQuerySqlDiagnosticsConfig = defaultTableQuerySqlDiagnosticsConfig
  ) {}

  async find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    return this.observeResult(
      context,
      table,
      spec,
      options,
      () => this.inner.find(context, table, spec, options),
      (value) => value.records.length
    );
  }

  findOne(...args: Parameters<ITableRecordQueryRepository['findOne']>) {
    return this.inner.findOne(...args);
  }

  async count(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordCountOptions
  ): Promise<Result<number, DomainError>> {
    return this.observeResult(
      context,
      table,
      spec,
      options,
      () => this.inner.count(context, table, spec, options),
      (value) => value,
      {
        queryKind: options?.search ? 'search' : 'rowCount',
      }
    );
  }

  async aggregate(
    ...args: Parameters<ITableRecordAggregationQueryRepository['aggregate']>
  ): ReturnType<ITableRecordAggregationQueryRepository['aggregate']> {
    const [context, table, aggregation, spec, options] = args;
    return this.observeResult(
      context,
      table,
      spec,
      options?.search ? { search: options.search } : undefined,
      () => this.inner.aggregate(...args),
      (value) => value.length,
      {
        queryKind: 'aggregation',
        aggregationShape: {
          groupFieldCount: aggregation.groupBy.length,
          metricCount: aggregation.fields.length,
          hasFilter: spec != null,
        },
      }
    );
  }

  calendarDailyCollection(
    ...args: Parameters<ITableRecordCalendarQueryRepository['calendarDailyCollection']>
  ) {
    return this.inner.calendarDailyCollection(...args);
  }

  findDistinctUserIds(
    ...args: Parameters<ITableRecordCollaboratorQueryRepository['findDistinctUserIds']>
  ) {
    return this.inner.findDistinctUserIds(...args);
  }

  async *findStream(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryStreamOptions
  ): AsyncIterable<Result<TableRecordReadModel, DomainError>> {
    const startedAt = Date.now();
    const sqlDiagnostics = attachTableQuerySqlDiagnosticsCollector(
      context,
      this.sqlDiagnosticsConfig
    );
    let count = 0;
    let failed = false;
    try {
      for await (const row of this.inner.findStream(context, table, spec, options)) {
        if (row.isErr()) failed = true;
        else count += 1;
        yield row;
      }
    } finally {
      try {
        this.recordObservation(
          context,
          table,
          spec,
          options,
          {
            durationMs: Date.now() - startedAt,
            timedOut: false,
            errorKind: failed ? 'unknown' : undefined,
            resultCountBucket: bucketResultCount(count),
          },
          sqlDiagnostics.collector.snapshot()
        );
      } finally {
        sqlDiagnostics.restore();
      }
    }
  }

  private async observeResult<T>(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryOptions | ITableRecordQueryStreamOptions | undefined,
    run: () => Promise<Result<T, DomainError>>,
    count: (value: T) => number,
    extras?: ObservationShapeExtras
  ): Promise<Result<T, DomainError>> {
    const startedAt = Date.now();
    const sqlDiagnostics = attachTableQuerySqlDiagnosticsCollector(
      context,
      this.sqlDiagnosticsConfig
    );
    try {
      const result = await run();
      this.recordObservation(
        context,
        table,
        spec,
        options,
        {
          durationMs: Date.now() - startedAt,
          timedOut: false,
          errorKind: result.isErr() ? 'unknown' : undefined,
          resultCountBucket: result.isOk() ? bucketResultCount(count(result.value)) : undefined,
        },
        sqlDiagnostics.collector.snapshot(),
        extras
      );
      return result;
    } finally {
      sqlDiagnostics.restore();
    }
  }

  private recordObservation(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryOptions | ITableRecordQueryStreamOptions | undefined,
    executionShape: TableQueryExecutionShape,
    sqlDiagnostics: ReadonlyArray<TableQuerySqlDiagnostic>,
    extras?: ObservationShapeExtras
  ): void {
    const shape = buildRecordQueryShape(table, spec, options, executionShape, extras);
    if (shape.isErr()) return;
    const observation = TableQueryObservationWindow.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      windowStart: floorDate(new Date(), 300_000),
      windowSizeSeconds: 300,
      shape: shape.value,
      requestCount: 1,
      slowCount: executionShape.durationMs >= 3000 ? 1 : 0,
      timeoutCount: executionShape.timedOut ? 1 : 0,
      dbErrorCount: executionShape.errorKind === 'db_error' ? 1 : 0,
      totalDurationMs: executionShape.durationMs,
      maxDurationMs: executionShape.durationMs,
      totalDbDurationMs: executionShape.dbDurationMs,
      maxDbDurationMs: executionShape.dbDurationMs,
      sqlDiagnostics,
    });
    if (observation.isErr()) return;
    try {
      this.observationPublisher.publish(context, observation.value);
    } catch {
      // Query observations are best-effort and must not affect product requests.
    }
  }
}

export const decorateV2TableRecordQueryRepositoryWithTableOps = (
  container: DependencyContainer
): void => {
  if (!container.isRegistered(v2CoreTokens.tableRecordQueryRepository)) return;
  if (!container.isRegistered(v2TableOpsTokens.observationPublisher)) return;
  const current = container.resolve<ObservableTableRecordQueryRepository>(
    v2CoreTokens.tableRecordQueryRepository
  );
  if ((current as Partial<ObservedTableRecordQueryRepository>)[observedRepositoryMarker]) return;
  const publisher = container.resolve<TableQueryObservationPublisher>(
    v2TableOpsTokens.observationPublisher
  );
  const sqlDiagnosticsConfig = container.isRegistered(v2TableOpsTokens.sqlDiagnosticsConfig)
    ? container.resolve<TableQuerySqlDiagnosticsConfig>(v2TableOpsTokens.sqlDiagnosticsConfig)
    : defaultTableQuerySqlDiagnosticsConfig;
  container.registerInstance(
    v2CoreTokens.tableRecordQueryRepository,
    new ObservedTableRecordQueryRepository(current, publisher, sqlDiagnosticsConfig)
  );
};

const buildRecordQueryShape = (
  table: Table,
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
  options: ITableRecordQueryOptions | ITableRecordQueryStreamOptions | undefined,
  executionShape: TableQueryExecutionShape,
  extras?: ObservationShapeExtras
): Result<TableQueryShape, DomainError> => {
  const search = options?.search;
  const orderBy = options?.orderBy ?? [];
  const queryKind: TableQueryKind = extras?.queryKind
    ? extras.queryKind
    : search
      ? 'search'
      : spec
        ? 'filter'
        : orderBy.some((item) => 'fieldId' in item)
          ? 'sort'
          : 'recordList';
  const searchFieldsResult = search?.search.resolveFields(table, {
    visibleFieldIds: search.visibleFieldIds,
  });
  const searchedFieldIds = searchFieldsResult?.isOk()
    ? searchFieldsResult.value.map((field) => field.id().toString()).sort()
    : undefined;
  const searchFieldCount = searchedFieldIds?.length;
  const searchAccessPath = options?.searchAccessPath;
  const searchesAllFields = search?.search.searchesAllFields() ?? false;

  return TableQueryShape.create({
    queryKind,
    whereShape: spec
      ? {
          conditionCount: 1,
          andDepth: 1,
          orDepth: 0,
          fields: [],
        }
      : undefined,
    searchShape: search
      ? {
          fieldCount: searchFieldCount ?? table.getFields().length,
          allFields: searchesAllFields,
          ...(!searchesAllFields && searchedFieldIds ? { searchedFieldIds } : {}),
          valueLengthBucket: bucketSearchLength(search.search.value.length),
          searchMode:
            searchAccessPath?.kind === 'generated_tsvector'
              ? 'full_text'
              : searchAccessPath?.kind === 'generated_text'
                ? 'substring'
                : 'ilike',
          searchScope: searchesAllFields ? 'all_fields' : 'selected_fields',
          ...(searchAccessPath?.kind === 'generated_tsvector'
            ? {
                languageConfig: searchAccessPath.languageConfig,
                coveredFieldIds: searchAccessPath.coveredFieldIds
                  .map((fieldId) => fieldId.toString())
                  .sort(),
              }
            : {}),
        }
      : undefined,
    orderShape: orderBy.length
      ? {
          fields: orderBy.map<TableQueryOrderFieldShape>((item) =>
            'fieldId' in item
              ? {
                  fieldId: item.fieldId.toString(),
                  direction: item.direction,
                  source: 'sort',
                }
              : {
                  systemColumn: item.column,
                  direction: item.direction,
                  source:
                    item.column.startsWith('__row_') || item.column === '__auto_number'
                      ? 'tieBreaker'
                      : 'sort',
                }
          ),
        }
      : undefined,
    aggregationShape: extras?.aggregationShape,
    executionShape,
  });
};

const floorDate = (date: Date, windowMs: number): Date =>
  new Date(Math.floor(date.getTime() / windowMs) * windowMs);

const bucketSearchLength = (length: number) => {
  if (length <= 0) return 'none';
  if (length <= 8) return 'short';
  if (length <= 64) return 'medium';
  return 'long';
};

const bucketResultCount = (count: number): 'none' | 'small' | 'medium' | 'large' => {
  if (count === 0) return 'none';
  if (count <= 100) return 'small';
  if (count <= 1000) return 'medium';
  return 'large';
};
