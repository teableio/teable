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

import {
  assertDataQueryAccess,
  dataQueryAccessForSource,
  type DataQueryAccessPlan,
} from './assertDataQueryAccess';
import type { BoundDataQueryPlan } from './BoundDataQueryPlan';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import type { DataQueryDefinition } from './DataQueryDefinition';
import { sortDataQueryFieldUsages } from './DataQueryFieldUsage';
import { dataQuerySchemaSignature } from './DataQuerySchemaSignature';
import type { DataQueryRelationPlan, DataQueryResult, IDataQueryExecutor } from './ports';
import type {
  DataQueryCandidate,
  DataQueryValidationResult,
  DataQueryValidationUsage,
} from './queryExecutionProtocol';

export interface DataQueryExecutionInput {
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface DataQueryValidationOptions {
  readonly includeUsage?: boolean;
  readonly includeSchemaSignature?: boolean;
  readonly candidate?: DataQueryCandidate;
  readonly candidateProof?: string;
}

/** Projects only stable logical identifiers from an already-authorized bound plan. */
const validationUsageFromPlan = (plan: BoundDataQueryPlan): DataQueryValidationUsage => {
  const tableIds = new Map<string, string>([
    [plan.root.alias, plan.root.tableId],
    ...plan.sources.map((source) => [source.alias, source.tableId] as const),
  ]);
  return plan.usage
    .map((entry) => ({
      source: entry.source,
      tableId: tableIds.get(entry.source)!,
      fieldId: entry.fieldId,
      usages: sortDataQueryFieldUsages(entry.usages),
    }))
    .sort((left, right) => {
      if (left.source !== right.source) return left.source < right.source ? -1 : 1;
      if (left.fieldId === right.fieldId) return 0;
      return left.fieldId < right.fieldId ? -1 : 1;
    });
};

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

/** Loads the root and every declared target table without requiring compatible output types. */
const loadDataQueryRelation = async (
  context: IExecutionContext,
  tableRepository: Pick<ITableRepository, 'findOne'>,
  definition: DataQueryDefinition
): Promise<
  Result<
    {
      rootTable: Table;
      targetTables: ReadonlyMap<string, Table>;
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
    return ok({ rootTable, targetTables, attributes });
  });
};

/** Execution and explain still require the complete, strict relation contract. */
export const prepareDataQueryRelation = async (
  context: IExecutionContext,
  tableRepository: Pick<ITableRepository, 'findOne'>,
  definition: DataQueryDefinition
) =>
  safeTry(async function* () {
    const loaded = yield* await loadDataQueryRelation(context, tableRepository, definition);
    const binding = yield* await traceDataQueryStage(
      context,
      'schema.compatibility.relations',
      loaded.attributes,
      async () =>
        DataQueryRelationBinding.prepare(definition, loaded.rootTable, loaded.targetTables, {
          deferOperatorRejection: true,
        })
    );
    return ok({ ...loaded, binding });
  });

/** Prepares one table's row/field scope and fails closed when a required field is unreadable. */
export const authorizeDataQueryDependencies = async (
  context: IExecutionContext,
  queryPlugins: RecordQueryPluginRunner,
  table: ITableReadModel,
  plan: DataQueryAccessPlan,
  pagination?: { readonly limit: number; readonly offset: number }
): Promise<Result<RecordQueryPluginScope, DomainError>> => {
  const execution = await queryPlugins.prepare({
    kind: 'list',
    executionContext: context,
    table,
    payload: {
      ignoreViewQuery: true,
      projectionFieldIds: plan.usage.map((usage) => usage.fieldId),
      ...pagination,
    },
  });
  if (execution.isErr()) return err(execution.error);
  const guard = await execution.value.guard();
  if (guard.isErr()) return err(guard.error);
  const scope = execution.value.getScope();
  if (scope.isErr()) return err(scope.error);
  const resolvedScope = scope.value ?? {};
  return assertDataQueryAccess(plan, resolvedScope).map(() => resolvedScope);
};

/** Hosts own descriptor admission; returned models are detached and only used for binding. */
export type PrepareDataQueryCandidate = (
  context: IExecutionContext,
  candidate: DataQueryCandidate,
  proof?: string
) => Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>>;

/**
 * Reuses table semantics without introducing host or SQL concepts into core.
 * Bindings are transient contracts for live schema validation and authorization.
 */
export class DataQueryService {
  constructor(
    private readonly tableRepository: Pick<ITableRepository, 'findOne'>,
    private readonly queryPlugins: RecordQueryPluginRunner,
    private readonly executor: IDataQueryExecutor,
    private readonly prepareCandidate?: PrepareDataQueryCandidate
  ) {}

  private async load(context: IExecutionContext, definition: DataQueryDefinition) {
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
        return ok({ table, attributes });
      }.bind(this)
    );
  }

  private async prepare(context: IExecutionContext, definition: DataQueryDefinition) {
    return safeTry(
      async function* (this: DataQueryService) {
        const loaded = yield* await this.load(context, definition);
        const binding = yield* await traceDataQueryStage(
          context,
          'schema.compatibility',
          loaded.attributes,
          async () =>
            DataQueryBinding.prepare(definition, loaded.table, {
              deferOperatorRejection: true,
            })
        );
        return ok({ ...loaded, binding });
      }.bind(this)
    );
  }

  async validate(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    options: DataQueryValidationOptions = {}
  ): Promise<Result<DataQueryValidationResult, DomainError>> {
    try {
      if (hasDataQueryRelations(definition)) {
        return await this.validateRelation(context, definition, options);
      }
      return await safeTry(
        async function* (this: DataQueryService) {
          const { table, attributes } = yield* await this.load(context, definition);
          const current = yield* await traceDataQueryStage(
            context,
            'schema.compatibility',
            attributes,
            async () =>
              DataQueryBinding.prepareAuthorization(definition, table, {
                deferOperatorRejection: true,
              })
          );
          yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            authorizeDataQueryDependencies(context, this.queryPlugins, table, current.plan)
          );
          const candidates = yield* await this.candidateTables(context, options);
          const candidateTable = candidates.get(table.id().toString()) ?? table;
          const binding = options.candidate
            ? yield* DataQueryBinding.prepare(definition, candidateTable, {
                deferOperatorRejection: true,
              })
            : yield* current.bind();
          if (options.candidate) {
            yield* await this.authorize(context, table, binding);
          }
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const useSignature = options.includeSchemaSignature === true;
          const includeUsage = options.includeUsage === true;
          if (!useSignature && !includeUsage) return ok({ outputs: binding.outputs });
          const schemaSignature = useSignature
            ? yield* await dataQuerySchemaSignature(
                binding.plan,
                new Map([['root', candidateTable]]),
                binding.outputs
              )
            : undefined;
          return ok({
            outputs: binding.outputs,
            ...(includeUsage ? { usage: validationUsageFromPlan(binding.plan) } : {}),
            ...(schemaSignature !== undefined ? { schemaSignature } : {}),
          });
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
          const result = yield* await this.executor.execute(context, table, query, scope, binding);
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
    definition: DataQueryDefinition,
    options: DataQueryValidationOptions
  ): Promise<Result<DataQueryValidationResult, DomainError>> {
    try {
      return await safeTry(
        async function* (this: DataQueryService) {
          const { rootTable, targetTables, attributes } = yield* await loadDataQueryRelation(
            context,
            this.tableRepository,
            definition
          );
          const current = yield* await traceDataQueryStage(
            context,
            'schema.compatibility.relations',
            attributes,
            async () =>
              DataQueryRelationBinding.prepareAuthorization(definition, rootTable, targetTables, {
                deferOperatorRejection: true,
              })
          );
          yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            authorizeDataQueryDependencies(
              context,
              this.queryPlugins,
              rootTable,
              dataQueryAccessForSource(current.plan, 'root')
            )
          );
          for (const source of current.sources) {
            yield* await traceDataQueryStage(
              context,
              'authorize.relation',
              { ...attributes, 'teable.data_query.relation': source.alias },
              () =>
                authorizeDataQueryDependencies(
                  context,
                  this.queryPlugins,
                  source.table,
                  dataQueryAccessForSource(current.plan, source.alias)
                )
            );
          }
          const candidates = yield* await this.candidateTables(context, options);
          const candidateRoot = candidates.get(rootTable.id().toString()) ?? rootTable;
          const candidateTargets = new Map<string, ITableReadModel>();
          for (const [alias, table] of targetTables) {
            candidateTargets.set(alias, candidates.get(table.id().toString()) ?? table);
          }
          const binding = options.candidate
            ? yield* DataQueryRelationBinding.prepare(definition, candidateRoot, candidateTargets, {
                deferOperatorRejection: true,
              })
            : yield* current.bind();
          if (options.candidate) {
            yield* await authorizeDataQueryDependencies(
              context,
              this.queryPlugins,
              rootTable,
              dataQueryAccessForSource(binding.plan, 'root')
            );
            for (const source of binding.sources) {
              yield* await authorizeDataQueryDependencies(
                context,
                this.queryPlugins,
                targetTables.get(source.alias)!,
                dataQueryAccessForSource(binding.plan, source.alias)
              );
            }
          }
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const useSignature = options.includeSchemaSignature === true;
          const includeUsage = options.includeUsage === true;
          if (!useSignature && !includeUsage) return ok({ outputs: binding.outputs });
          const schemaSignature = useSignature
            ? yield* await dataQuerySchemaSignature(
                binding.plan,
                new Map([['root', candidateRoot], ...candidateTargets]),
                binding.outputs
              )
            : undefined;
          return ok({
            outputs: binding.outputs,
            ...(includeUsage ? { usage: validationUsageFromPlan(binding.plan) } : {}),
            ...(schemaSignature !== undefined ? { schemaSignature } : {}),
          });
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
              dataQueryAccessForSource(binding.plan, 'root'),
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
                  dataQueryAccessForSource(binding.plan, source.alias)
                )
            );
            scopes.set(source.alias, scope);
          }
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const plan: DataQueryRelationPlan = {
            query,
            rootTable,
            rootScope,
            sources: binding.sources.map((source) => ({
              alias: source.alias,
              table: targetTables.get(source.alias)!,
              linkFieldId: source.linkFieldId,
              scope: scopes.get(source.alias)!,
            })),
            plan: binding.plan,
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

  private async candidateTables(
    context: IExecutionContext,
    options: DataQueryValidationOptions
  ): Promise<Result<ReadonlyMap<string, ITableReadModel>, DomainError>> {
    if (!options.candidate) return ok(new Map());
    if (!this.prepareCandidate) {
      return err(
        domainError.forbidden({
          code: 'data_query.candidate_forbidden',
          message: 'Candidate validation requires authorized preparation',
        })
      );
    }
    return this.prepareCandidate(context, options.candidate, options.candidateProof);
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
      binding.plan,
      pagination
    );
  }
}
