import {
  domainError,
  type DomainError,
  type SpanAttributes,
  type IExecutionContext,
  type ITableRepository,
  type ITableReadModel,
  type RecordQueryPluginScope,
  type RecordQueryPluginRunner,
  TableByIdSpec,
  TableId,
} from '@teable/v2-core';
import { err, ok, safeTry, type Result } from 'neverthrow';

import { assertDataQueryAccess } from './assertDataQueryAccess';
import { DataQueryBinding } from './DataQueryBinding';
import type { DataQueryDefinition } from './DataQueryDefinition';
import type { DataQueryResult, IDataQueryExecutor } from './ports';
import type { DataQueryOutput } from './types';

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

  private async authorize(
    context: IExecutionContext,
    table: ITableReadModel,
    binding: DataQueryBinding,
    pagination?: { readonly limit: number; readonly offset: number }
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
