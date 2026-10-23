import {
  domainError,
  TableByIdSpec,
  TableId,
  type DomainError,
  type IExecutionContext,
  type ITableReadModel,
  type ITableRepository,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { assertDataQueryAccess } from './assertDataQueryAccess';
import { DataQueryBinding } from './DataQueryBinding';
import type { DataQueryDefinition } from './DataQueryDefinition';
import type { DataQueryExplainResult } from './DataQueryExplain';
import {
  authorizeDataQueryDependencies,
  hasDataQueryRelations,
  prepareDataQueryRelation,
  traceDataQueryStage,
} from './DataQueryService';
import type { DataQueryRelationPlan } from './ports';
import type { BoundDataQuery } from './types';

/**
 * A data source that can compile a bound definition without running it.
 * Separate from IDataQueryExecutor so existing execute-only adapters stay valid.
 */
export interface IDataQueryExplainer {
  explain(
    context: IExecutionContext,
    table: Table,
    query: BoundDataQuery,
    scope: RecordQueryPluginScope
  ): Promise<Result<DataQueryExplainResult, DomainError>>;
  /** Optional so execute-only adapters stay valid; relation explain fails closed without it. */
  explainRelation?(
    context: IExecutionContext,
    plan: DataQueryRelationPlan
  ): Promise<Result<DataQueryExplainResult, DomainError>>;
}

export interface DataQueryExplainInput {
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Explain reuses the execute admission/authorization semantics exactly. It is a
 * separate module so the execute service keeps a single non-diagnostic path.
 */
export class DataQueryExplainService {
  constructor(
    private readonly tableRepository: Pick<ITableRepository, 'findOne'>,
    private readonly queryPlugins: RecordQueryPluginRunner,
    private readonly explainer: IDataQueryExplainer
  ) {}

  async explain(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    input: DataQueryExplainInput = {}
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    try {
      return await safeTry(
        async function* (this: DataQueryExplainService) {
          const snapshot = definition.snapshot();
          const tableId = yield* TableId.create(snapshot.tableId);
          const attributes = {
            'teable.table_id': tableId.toString(),
            'teable.data_query.kind': snapshot.kind,
          };

          if (hasDataQueryRelations(definition)) {
            const explainRelation = this.explainer.explainRelation?.bind(this.explainer);
            if (!explainRelation) {
              return err(
                domainError.validation({
                  code: 'data_query.join_unsupported',
                  message: 'The configured explainer does not support relation queries',
                })
              );
            }
            const relation = yield* await prepareDataQueryRelation(
              context,
              this.tableRepository,
              definition
            );
            const query = yield* definition.bind(input.parameters ?? {});
            const rootScope = yield* await traceDataQueryStage(
              context,
              'authorize',
              relation.attributes,
              () =>
                authorizeDataQueryDependencies(
                  context,
                  this.queryPlugins,
                  relation.rootTable,
                  relation.binding.rootDependencies,
                  { limit: query.limit, offset: query.offset }
                )
            );
            const scopes = new Map<string, RecordQueryPluginScope>();
            for (const source of relation.binding.sources) {
              const scope = yield* await traceDataQueryStage(
                context,
                'authorize.relation',
                {
                  ...relation.attributes,
                  'teable.data_query.relation': source.alias,
                },
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
            if (relation.binding.deferredFilterError) {
              return err(relation.binding.deferredFilterError);
            }
            const plan: DataQueryRelationPlan = {
              definition,
              query,
              rootTable: relation.rootTable,
              rootScope,
              rootDependencies: relation.binding.rootDependencies,
              sources: relation.binding.sources.map((source) => ({
                alias: source.alias,
                table: relation.targetTables.get(source.alias)!,
                linkFieldId: source.linkFieldId,
                scope: scopes.get(source.alias)!,
                dependencies: source.dependencies,
              })),
            };
            return ok(yield* await explainRelation(context, plan));
          }
          const table = yield* await traceDataQueryStage(context, 'schema.load', attributes, () =>
            this.tableRepository.findOne(context, TableByIdSpec.create(tableId))
          );
          const binding = yield* await traceDataQueryStage(
            context,
            'schema.compatibility',
            attributes,
            async () =>
              DataQueryBinding.prepare(definition, table, { deferOperatorRejection: true })
          );
          const query = yield* definition.bind(input.parameters ?? {});
          const scope = yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            this.authorize(context, table, binding, query)
          );
          if (binding.deferredFilterError) return err(binding.deferredFilterError);
          const result = yield* await this.explainer.explain(context, table, query, scope);
          return ok(result);
        }.bind(this)
      );
    } catch (cause) {
      return err(
        domainError.infrastructure({
          code: 'data_query.explain_failed',
          message: 'Unable to explain the data query',
          cause,
        })
      );
    }
  }

  private async authorize(
    context: IExecutionContext,
    table: ITableReadModel,
    binding: DataQueryBinding,
    pagination: { readonly limit: number; readonly offset: number }
  ): Promise<Result<RecordQueryPluginScope, DomainError>> {
    const execution = await this.queryPlugins.prepare({
      kind: 'list',
      executionContext: context,
      table,
      payload: {
        ignoreViewQuery: true,
        projectionFieldIds: binding.dependencies.map((dependency) => dependency.fieldId),
        ...pagination,
      },
    });
    if (execution.isErr()) return err(execution.error);
    const guard = await execution.value.guard();
    if (guard.isErr()) return err(guard.error);
    const scope = execution.value.getScope();
    if (scope.isErr()) return err(scope.error);
    const resolvedScope = scope.value ?? {};
    return assertDataQueryAccess(binding, resolvedScope).map(() => resolvedScope);
  }
}
