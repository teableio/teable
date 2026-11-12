import {
  domainError,
  getFormulaSourceBudget,
  TableByIdSpec,
  TableId,
  type DomainError,
  type IExecutionContext,
  type ITableRepository,
  type RecordQueryPluginRunner,
  type RecordQueryPluginScope,
  type Table,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { assertDataQueryAccess, dataQueryAccessForSource } from './assertDataQueryAccess';
import { DataQueryBinding, DataQueryRelationBinding } from './DataQueryBinding';
import type { DataQueryDefinition } from './DataQueryDefinition';
import type { DataQueryExplainResult } from './DataQueryExplain';
import {
  authorizeDataQueryDependencies,
  authorizeDataQueryExpressionDependencies,
  hasDataQueryRelations,
  loadDataQueryRelation,
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
    scope: RecordQueryPluginScope,
    binding?: DataQueryBinding
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
          const expressionQuery =
            snapshot.version === 3 ? yield* definition.bind(input.parameters ?? {}) : undefined;
          const tableId = yield* TableId.create(snapshot.tableId);
          if (hasDataQueryRelations(definition)) {
            return this.explainRelations(context, definition, input, expressionQuery);
          }
          return this.explainRoot(context, definition, tableId, input, expressionQuery);
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

  private async explainRoot(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    tableId: TableId,
    input: DataQueryExplainInput,
    expressionQuery: BoundDataQuery | undefined
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    return safeTry(
      async function* (this: DataQueryExplainService) {
        const attributes = {
          'teable.table_id': tableId.toString(),
          'teable.data_query.kind': definition.snapshot().kind,
        };
        const table = yield* await traceDataQueryStage(context, 'schema.load', attributes, () =>
          this.tableRepository.findOne(context, TableByIdSpec.create(tableId))
        );
        const authorizedScopes = yield* await authorizeDataQueryExpressionDependencies(
          context,
          this.queryPlugins,
          definition,
          table,
          undefined,
          expressionQuery
            ? { limit: expressionQuery.limit, offset: expressionQuery.offset }
            : undefined
        );
        const binding = yield* await traceDataQueryStage(
          context,
          'schema.compatibility',
          attributes,
          async () =>
            DataQueryBinding.prepare(definition, table, {
              deferOperatorRejection: true,
              formulaSourceBudget: getFormulaSourceBudget(context),
            })
        );
        const query = expressionQuery ?? (yield* definition.bind(input.parameters ?? {}));
        let scope: RecordQueryPluginScope;
        if (authorizedScopes) {
          scope = authorizedScopes.get('root')!;
          yield* assertDataQueryAccess(binding.plan, scope);
        } else {
          scope = yield* await traceDataQueryStage(context, 'authorize', attributes, () =>
            authorizeDataQueryDependencies(context, this.queryPlugins, table, binding.plan, {
              limit: query.limit,
              offset: query.offset,
            })
          );
        }
        if (binding.deferredFilterError) return err(binding.deferredFilterError);
        return ok(yield* await this.explainer.explain(context, table, query, scope, binding));
      }.bind(this)
    );
  }

  private async explainRelations(
    context: IExecutionContext,
    definition: DataQueryDefinition,
    input: DataQueryExplainInput,
    expressionQuery: BoundDataQuery | undefined
  ): Promise<Result<DataQueryExplainResult, DomainError>> {
    return safeTry(
      async function* (this: DataQueryExplainService) {
        const explainRelation = this.explainer.explainRelation?.bind(this.explainer);
        if (!explainRelation) {
          return err(
            domainError.validation({
              code: 'data_query.join_unsupported',
              message: 'The configured explainer does not support relation queries',
            })
          );
        }
        const loaded = yield* await loadDataQueryRelation(
          context,
          this.tableRepository,
          definition
        );
        const authorizedScopes = yield* await authorizeDataQueryExpressionDependencies(
          context,
          this.queryPlugins,
          definition,
          loaded.rootTable,
          loaded.targetTables,
          expressionQuery
            ? { limit: expressionQuery.limit, offset: expressionQuery.offset }
            : undefined
        );
        const binding = yield* await traceDataQueryStage(
          context,
          'schema.compatibility.relations',
          loaded.attributes,
          async () =>
            DataQueryRelationBinding.prepare(definition, loaded.rootTable, loaded.targetTables, {
              deferOperatorRejection: true,
              formulaSourceBudget: getFormulaSourceBudget(context),
            })
        );
        const query = expressionQuery ?? (yield* definition.bind(input.parameters ?? {}));
        let rootScope: RecordQueryPluginScope;
        if (authorizedScopes) {
          rootScope = authorizedScopes.get('root')!;
          yield* assertDataQueryAccess(dataQueryAccessForSource(binding.plan, 'root'), rootScope);
        } else {
          rootScope = yield* await traceDataQueryStage(
            context,
            'authorize',
            loaded.attributes,
            () =>
              authorizeDataQueryDependencies(
                context,
                this.queryPlugins,
                loaded.rootTable,
                dataQueryAccessForSource(binding.plan, 'root'),
                { limit: query.limit, offset: query.offset }
              )
          );
        }
        const scopes = new Map<string, RecordQueryPluginScope>();
        for (const source of binding.sources) {
          let scope: RecordQueryPluginScope;
          if (authorizedScopes) {
            scope = authorizedScopes.get(source.alias)!;
            yield* assertDataQueryAccess(
              dataQueryAccessForSource(binding.plan, source.alias),
              scope
            );
          } else {
            scope = yield* await traceDataQueryStage(
              context,
              'authorize.relation',
              { ...loaded.attributes, 'teable.data_query.relation': source.alias },
              () =>
                authorizeDataQueryDependencies(
                  context,
                  this.queryPlugins,
                  source.table,
                  dataQueryAccessForSource(binding.plan, source.alias)
                )
            );
          }
          scopes.set(source.alias, scope);
        }
        if (binding.deferredFilterError) return err(binding.deferredFilterError);
        const plan: DataQueryRelationPlan = {
          query,
          rootTable: loaded.rootTable,
          rootScope,
          sources: binding.sources.map((source) => ({
            alias: source.alias,
            table: loaded.targetTables.get(source.alias)!,
            linkFieldId: source.linkFieldId,
            scope: scopes.get(source.alias)!,
          })),
          plan: binding.plan,
        };
        return ok(yield* await explainRelation(context, plan));
      }.bind(this)
    );
  }
}
