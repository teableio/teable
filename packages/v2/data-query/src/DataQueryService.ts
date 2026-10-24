import {
  domainError,
  type DomainError,
  type SpanAttributes,
  type IExecutionContext,
  type ITableRepository,
  type ITableReadModel,
  type RecordQueryPluginScope,
  type RecordQueryPluginRunner,
  type Table,
  TableByIdSpec,
  TableId,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { assertDataQueryAccess } from './assertDataQueryAccess';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import type { DataQueryDefinition } from './DataQueryDefinition';
import type { DataQueryRelationPlan, DataQueryResult, IDataQueryExecutor } from './ports';
import type { DataQueryFieldDependency, DataQueryOutput } from './types';

export interface DataQueryExecutionInput {
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/** Query-boundary tracing: only structural attributes and fixed failure labels leave this layer. */
export const traceDataQueryStage = async <T>(
  context: IExecutionContext,
  operation: string,
  attributes: SpanAttributes,
  callback: () => PromiseLike<Result<T, DomainError>>
): Promise<Result<T, DomainError>> => {
  const tracer = context.tracer;
  if (!tracer) return callback();
  const span = tracer.startSpan(`teable.dataQuery.${operation}`, {
    'teable.version': 'v2',
    'teable.component': 'service',
    'teable.operation': operation,
    ...attributes,
  });
  const outcome = await tracer.withSpan(span, async () => {
    try {
      const result = await callback();
      span.setAttribute('teable.data_query.outcome', result.isErr() ? 'error' : 'success');
      if (result.isErr()) span.recordError('Data query stage failed');
      return result;
    } catch (thrown) {
      span.setAttribute('teable.data_query.outcome', 'error');
      span.recordError('Data query stage failed');
      // Keep raw diagnostics out of tracer exception capture; callers retain error classification.
      return { thrown };
    } finally {
      span.end();
    }
  });
  if ('thrown' in outcome) throw outcome.thrown;
  return outcome;
};
export const hasDataQueryRelations = (definition: DataQueryDefinition): boolean => {
  const snapshot = definition.snapshot();
  if (snapshot.version !== 2) return false;
  if (Object.keys(snapshot.relations ?? {}).length > 0) return true;
  if (snapshot.kind === 'records') {
    return snapshot.select.some(
      (projection) => 'source' in projection && projection.source !== undefined
    );
  }
  return (snapshot.groupBy ?? []).some((group) => 'source' in group && group.source !== undefined);
};

/** Loads the root and every declared target table, then validates the relation contract. */
export const prepareDataQueryRelation = async (
  context: IExecutionContext,
  tableRepository: Pick<ITableRepository, 'findOne'>,
  definition: DataQueryDefinition
): Promise<
  Result<
    {
      rootTable: Table;
      targetTables: ReadonlyMap<string, Table>;
      binding: DataQueryRelationBinding;
      attributes: SpanAttributes;
    },
    DomainError
  >
> => {
  return safeTry(async function* () {
    const snapshot = definition.snapshot();
    if (snapshot.version !== 2) {
      return err(
        domainError.validation({
          code: 'data_query.join_version',
          message: 'Relation queries require a version 2 definition',
        })
      );
    }
    const tableId = yield* TableId.create(snapshot.tableId);
    const attributes = {
      'teable.table_id': tableId.toString(),
      'teable.data_query.kind': snapshot.kind,
    };
    const rootTable = yield* await traceDataQueryStage(context, 'schema.load', attributes, () =>
      tableRepository.findOne(context, TableByIdSpec.create(tableId))
    );
    const targetTables = new Map<string, Table>();
    for (const [alias, relation] of Object.entries(snapshot.relations ?? {})) {
      const targetId = yield* TableId.create(relation.tableId);
      const target = yield* await traceDataQueryStage(
        context,
        'schema.load.relation',
        {
          ...attributes,
          'teable.data_query.relation': alias,
          'teable.table_id': targetId.toString(),
        },
        () => tableRepository.findOne(context, TableByIdSpec.create(targetId))
      );
      targetTables.set(alias, target);
    }
    const binding = yield* await traceDataQueryStage(
      context,
      'schema.compatibility.relations',
      attributes,
      async () =>
        DataQueryRelationBinding.prepare(definition, rootTable, targetTables, {
          deferOperatorRejection: true,
        })
    );
    return ok({ rootTable, targetTables, binding, attributes });
  });
};

/** Prepares one table's row/field scope and fails closed when a required field is unreadable. */
export const authorizeDataQueryDependencies = async (
  context: IExecutionContext,
  queryPlugins: RecordQueryPluginRunner,
  table: ITableReadModel,
  dependencies: ReadonlyArray<DataQueryFieldDependency>,
  pagination?: { readonly limit: number; readonly offset: number }
): Promise<Result<RecordQueryPluginScope, DomainError>> => {
  const execution = await queryPlugins.prepare({
    kind: 'list',
    executionContext: context,
    table,
    payload: {
      ignoreViewQuery: true,
      projectionFieldIds: dependencies.map((dependency) => dependency.fieldId),
      ...pagination,
    },
  });
  if (execution.isErr()) return err(execution.error);
  const guard = await execution.value.guard();
  if (guard.isErr()) return err(guard.error);
  const scope = execution.value.getScope();
  if (scope.isErr()) return err(scope.error);
  const resolvedScope = scope.value ?? {};
  return assertDataQueryAccess({ dependencies }, resolvedScope).map(() => resolvedScope);
};

/**
 * Reuses table semantics without introducing host or SQL concepts into core.
 * Bindings are transient contracts for live schema validation and authorization.
 */
export class DataQueryService {
  constructor(
    private readonly tableRepository: Pick<ITableRepository, 'findOne'>,
    private readonly queryPlugins: RecordQueryPluginRunner,
    private readonly executor: IDataQueryExecutor
  ) {}

  private async prepare(context: IExecutionContext, definition: DataQueryDefinition) {
    return safeTry(
      async function* (this: DataQueryService) {
        const snapshot = definition.snapshot();
        const tableId = yield* TableId.create(snapshot.tableId);
        const attributes = {
          'teable.table_id': tableId.toString(),
          'teable.data_query.kind': snapshot.kind,
        };
        const table = yield* await traceDataQueryStage(context, 'schema.load', attributes, () =>
          this.tableRepository.findOne(context, TableByIdSpec.create(tableId))
        );
        const binding = yield* await traceDataQueryStage(
          context,
          'schema.compatibility',
          attributes,
          async () => DataQueryBinding.prepare(definition, table, { deferOperatorRejection: true })
        );
        return ok({ table, binding, attributes });
      }.bind(this)
    );
  }

  async validate(
    context: IExecutionContext,
    definition: DataQueryDefinition
  ): Promise<Result<{ outputs: ReadonlyArray<DataQueryOutput> }, DomainError>> {
    try {
      if (hasDataQueryRelations(definition)) {
        return await this.validateRelation(context, definition);
      }
      return await safeTry(
        async function* (this: DataQueryService) {
          const { table, binding, attributes } = yield* await this.prepare(context, definition);
          yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            this.authorize(context, table, binding)
          );
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          return ok({ outputs: binding.outputs });
        }.bind(this)
      );
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.validation_failed',
          message: 'Unable to validate the data query',
          cause,
        })
      );
    }
  }

  async execute(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    input: DataQueryExecutionInput = {}
  ): Promise<Result<DataQueryResult, DomainError>> {
    try {
      if (hasDataQueryRelations(definition)) {
        return await this.executeRelation(context, definition, input);
      }
      return await safeTry(
        async function* (this: DataQueryService) {
          const { table, binding, attributes } = yield* await this.prepare(context, definition);
          const query = yield* definition.bind(input.parameters ?? {});
          const scope = yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            this.authorize(context, table, binding, query)
          );
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const result = yield* await this.executor.execute(context, table, query, scope);
          return ok(result);
        }.bind(this)
      );
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to execute the data query',
          cause: error,
        })
      );
    }
  }

  private async validateRelation(
    context: IExecutionContext,
    definition: DataQueryDefinition
  ): Promise<Result<{ outputs: ReadonlyArray<DataQueryOutput> }, DomainError>> {
    try {
      return await safeTry(
        async function* (this: DataQueryService) {
          const { rootTable, binding, attributes } = yield* await prepareDataQueryRelation(
            context,
            this.tableRepository,
            definition
          );
          yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            authorizeDataQueryDependencies(
              context,
              this.queryPlugins,
              rootTable,
              binding.rootDependencies
            )
          );
          for (const source of binding.sources) {
            yield* await traceDataQueryStage(
              context,
              'authorize.relation',
              { ...attributes, 'teable.data_query.relation': source.alias },
              () =>
                authorizeDataQueryDependencies(
                  context,
                  this.queryPlugins,
                  source.table,
                  source.dependencies
                )
            );
          }
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          return ok({ outputs: binding.outputs });
        }.bind(this)
      );
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.validation_failed',
          message: 'Unable to validate the data query',
          cause,
        })
      );
    }
  }

  private async executeRelation(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    input: DataQueryExecutionInput
  ): Promise<Result<DataQueryResult, DomainError>> {
    try {
      const executor = this.executor.executeRelation?.bind(this.executor);
      if (!executor) {
        return err(
          domainError.validation({
            code: 'data_query.join_unsupported',
            message: 'The configured executor does not support relation queries',
          })
        );
      }
      return await safeTry(
        async function* (this: DataQueryService) {
          const { rootTable, targetTables, binding, attributes } =
            yield* await prepareDataQueryRelation(context, this.tableRepository, definition);
          const query = yield* definition.bind(input.parameters ?? {});
          const rootScope = yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            authorizeDataQueryDependencies(
              context,
              this.queryPlugins,
              rootTable,
              binding.rootDependencies,
              { limit: query.limit, offset: query.offset }
            )
          );
          const scopes = new Map<string, RecordQueryPluginScope>();
          for (const source of binding.sources) {
            const scope = yield* await traceDataQueryStage(
              context,
              'authorize.relation',
              { ...attributes, 'teable.data_query.relation': source.alias },
              () =>
                authorizeDataQueryDependencies(
                  context,
                  this.queryPlugins,
                  source.table,
                  source.dependencies
                )
            );
            scopes.set(source.alias, scope);
          }
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const plan: DataQueryRelationPlan = {
            definition,
            query,
            rootTable,
            rootScope,
            rootDependencies: binding.rootDependencies,
            sources: binding.sources.map((source) => ({
              alias: source.alias,
              table: targetTables.get(source.alias)!,
              linkFieldId: source.linkFieldId,
              scope: scopes.get(source.alias)!,
              dependencies: source.dependencies,
            })),
          };
          const result = yield* await executor(context, plan);
          return ok(result);
        }.bind(this)
      );
    } catch (error) {
      return err(
        domainError.infrastructure({
          code: 'data_query.execution_failed',
          message: 'Unable to execute the data query',
          cause: error,
        })
      );
    }
  }

  private async authorize(
    context: IExecutionContext,
    table: ITableReadModel,
    binding: DataQueryBinding,
    pagination?: { readonly limit: number; readonly offset: number }
  ): Promise<Result<RecordQueryPluginScope, DomainError>> {
    return authorizeDataQueryDependencies(
      context,
      this.queryPlugins,
      table,
      binding.dependencies,
      pagination
    );
  }
}
