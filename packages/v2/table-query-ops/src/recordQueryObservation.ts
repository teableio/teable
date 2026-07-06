import {
  v2CoreTokens,
  type DomainError,
  type IExecutionContext,
  type ITableRecordConditionSpecVisitor,
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
  type TableQueryExecutionShape,
  type TableQueryKind,
  type TableQueryOrderFieldShape,
  type TableQuerySqlDiagnostic,
} from './domain';
import type { TableQueryObservationSink } from './ports';
import {
  attachTableQuerySqlDiagnosticsCollector,
  defaultTableQuerySqlDiagnosticsConfig,
  type TableQuerySqlDiagnosticsConfig,
} from './sqlDiagnostics';
import { v2TableOpsTokens } from './tokens';

const observedRepositoryMarker = Symbol('v2.tableOps.observedTableRecordQueryRepository');

export class ObservedTableRecordQueryRepository implements ITableRecordQueryRepository {
  readonly [observedRepositoryMarker] = true;

  constructor(
    private readonly inner: ITableRecordQueryRepository,
    private readonly observationSink: TableQueryObservationSink,
    private readonly sqlDiagnosticsConfig: TableQuerySqlDiagnosticsConfig = defaultTableQuerySqlDiagnosticsConfig
  ) {}

  async find(
    context: IExecutionContext,
    table: Table,
    spec?: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    options?: ITableRecordQueryOptions
  ): Promise<Result<ITableRecordQueryResult, DomainError>> {
    const startedAt = Date.now();
    const sqlDiagnostics = attachTableQuerySqlDiagnosticsCollector(
      context,
      this.sqlDiagnosticsConfig
    );
    try {
      const result = await this.inner.find(context, table, spec, options);
      await this.recordObservation(
        context,
        table,
        spec,
        options,
        {
          durationMs: Date.now() - startedAt,
          timedOut: false,
          errorKind: result.isErr() ? 'unknown' : undefined,
          resultCountBucket: result.isOk()
            ? bucketResultCount(result.value.records.length)
            : undefined,
        },
        sqlDiagnostics.collector.snapshot()
      );
      return result;
    } finally {
      sqlDiagnostics.restore();
    }
  }

  findOne(...args: Parameters<ITableRecordQueryRepository['findOne']>) {
    return this.inner.findOne(...args);
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
        await this.recordObservation(
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

  private async recordObservation(
    context: IExecutionContext,
    table: Table,
    spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    options: ITableRecordQueryOptions | ITableRecordQueryStreamOptions | undefined,
    executionShape: TableQueryExecutionShape,
    sqlDiagnostics: ReadonlyArray<TableQuerySqlDiagnostic>
  ): Promise<void> {
    const shape = buildRecordQueryShape(table, spec, options, executionShape);
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
    await this.observationSink.record(context, observation.value);
  }
}

export const decorateV2TableRecordQueryRepositoryWithTableOps = (
  container: DependencyContainer
): void => {
  if (!container.isRegistered(v2CoreTokens.tableRecordQueryRepository)) return;
  if (!container.isRegistered(v2TableOpsTokens.observationSink)) return;
  const current = container.resolve<ITableRecordQueryRepository>(
    v2CoreTokens.tableRecordQueryRepository
  );
  if ((current as Partial<ObservedTableRecordQueryRepository>)[observedRepositoryMarker]) return;
  const sink = container.resolve<TableQueryObservationSink>(v2TableOpsTokens.observationSink);
  const sqlDiagnosticsConfig = container.isRegistered(v2TableOpsTokens.sqlDiagnosticsConfig)
    ? container.resolve<TableQuerySqlDiagnosticsConfig>(v2TableOpsTokens.sqlDiagnosticsConfig)
    : defaultTableQuerySqlDiagnosticsConfig;
  container.registerInstance(
    v2CoreTokens.tableRecordQueryRepository,
    new ObservedTableRecordQueryRepository(current, sink, sqlDiagnosticsConfig)
  );
};

const buildRecordQueryShape = (
  table: Table,
  spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
  options: ITableRecordQueryOptions | ITableRecordQueryStreamOptions | undefined,
  executionShape: TableQueryExecutionShape
): Result<TableQueryShape, DomainError> => {
  const search = options?.search;
  const orderBy = options?.orderBy ?? [];
  const queryKind: TableQueryKind = search
    ? 'search'
    : spec
      ? 'filter'
      : orderBy.some((item) => 'fieldId' in item)
        ? 'sort'
        : 'recordList';
  const searchFieldsResult = search?.search.resolveFields(table, {
    visibleFieldIds: search.visibleFieldIds,
  });
  const searchFieldCount = searchFieldsResult?.isOk() ? searchFieldsResult.value.length : undefined;

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
          allFields: search.search.searchesAllFields(),
          valueLengthBucket: bucketSearchLength(search.search.value.length),
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
