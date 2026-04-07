import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as LoggerPort from '../../ports/Logger';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import type {
  IRecordWritePlugin,
  RecordWritePluginContext,
  RecordWritePluginEnforce,
  RecordWriteScopedFieldIdsResolver,
  RecordWritePluginScope,
} from '../../ports/RecordWritePlugin';
import { v2CoreTokens } from '../../ports/tokens';
import {
  createPluginTraceContext,
  createTeableSpanAttributes,
  TeableSpanAttributes,
  type ISpan,
  type SpanAttributes,
} from '../../ports/Tracer';

type PreparedPluginEntry = {
  readonly plugin: IRecordWritePlugin<unknown>;
  readonly preparedState: unknown;
  readonly scope?: RecordWritePluginScope;
};

type RecordWritePluginContextSanitizer = (
  context: RecordWritePluginContext
) => Result<RecordWritePluginContext, DomainError>;

type RecordWritePluginPhase =
  | 'supports'
  | 'prepare'
  | 'scope'
  | 'guard'
  | 'beforePersist'
  | 'afterCommit';

const enforceOrder = (enforce?: RecordWritePluginEnforce): number => {
  if (enforce === 'pre') return 0;
  if (enforce === 'post') return 2;
  return 1;
};

const withTransactionBoundContext = (
  context: RecordWritePluginContext,
  executionContext: IExecutionContext
): RecordWritePluginContext => {
  return {
    ...context,
    executionContext,
    isTransactionBound: true,
  } as RecordWritePluginContext;
};

const createEnforceGroups = <T>(
  items: ReadonlyArray<T>,
  getEnforce: (item: T) => RecordWritePluginEnforce | undefined
): T[][] => {
  const groups: [T[], T[], T[]] = [[], [], []];

  for (const item of items) {
    groups[enforceOrder(getEnforce(item))].push(item);
  }

  return groups.filter((group) => group.length > 0);
};

const sanitizeRecordWritePluginContext = (
  context: RecordWritePluginContext,
  tableMapper: TableMapperPort.ITableMapper
): Result<RecordWritePluginContext, DomainError> => {
  return context.table
    .clone(tableMapper)
    .map((table) => ({ ...context, table }) as RecordWritePluginContext);
};

const getTableId = (table: RecordWritePluginContext['table']): string | undefined => {
  try {
    const tableId = table.id();
    return tableId.toString();
  } catch {
    return undefined;
  }
};

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const createRecordWritePluginTraceAttributes = (
  context: RecordWritePluginContext,
  pluginName: string,
  phase: RecordWritePluginPhase
): SpanAttributes => {
  return {
    ...createRecordWritePluginBaseTraceAttributes(context, pluginName),
    [TeableSpanAttributes.OPERATION]: `recordWritePlugin.${phase}`,
    [TeableSpanAttributes.PLUGIN_PHASE]: phase,
  };
};

const createRecordWritePluginBaseTraceAttributes = (
  context: RecordWritePluginContext,
  pluginName: string
): SpanAttributes => {
  const tableId = getTableId(context.table);

  return createTeableSpanAttributes('plugin', 'recordWritePlugin.execution', {
    [TeableSpanAttributes.PLUGIN]: pluginName,
    [TeableSpanAttributes.PLUGIN_TYPE]: 'record_write',
    [TeableSpanAttributes.OPERATION_KIND]: context.kind,
    [TeableSpanAttributes.IS_TRANSACTION_BOUND]: context.isTransactionBound,
    ...(tableId ? { [TeableSpanAttributes.TABLE_ID]: tableId } : {}),
  });
};

const withRecordWritePluginTraceContext = (
  context: RecordWritePluginContext,
  pluginName: string,
  phase: Exclude<RecordWritePluginPhase, 'supports'>,
  activeSpan?: ISpan
): RecordWritePluginContext => {
  return {
    ...context,
    trace: createPluginTraceContext({
      tracer: context.executionContext.tracer,
      activeSpan,
      attributes: createRecordWritePluginTraceAttributes(context, pluginName, phase),
      spanNamePrefix: `teable.recordWritePlugin.${pluginName}`,
      operationPrefix: `recordWritePlugin.${phase}`,
    }),
  };
};

const intersectDefinedSets = (
  sets: ReadonlyArray<ReadonlySet<string> | undefined>
): ReadonlySet<string> | undefined => {
  const definedSets = sets.filter((set): set is ReadonlySet<string> => set != null);
  if (!definedSets.length) {
    return undefined;
  }

  const [firstSet, ...restSets] = definedSets;
  return new Set([...firstSet].filter((value) => restSets.every((set) => set.has(value))));
};

const composeUpdateFieldResolvers = (
  resolvers: ReadonlyArray<RecordWriteScopedFieldIdsResolver | undefined>,
  staticFieldIds: ReadonlySet<string> | undefined
): RecordWriteScopedFieldIdsResolver | undefined => {
  const definedResolvers = resolvers.filter(
    (resolver): resolver is RecordWriteScopedFieldIdsResolver => resolver != null
  );

  if (!definedResolvers.length && !staticFieldIds) {
    return undefined;
  }

  return (record) => {
    const dynamicFieldIds = intersectDefinedSets(
      definedResolvers.map((resolver) => resolver(record))
    );
    return intersectDefinedSets([staticFieldIds, dynamicFieldIds]);
  };
};

const withRecordWritePluginSpan = async <T>(
  context: RecordWritePluginContext,
  pluginName: string,
  phase: Exclude<RecordWritePluginPhase, 'supports'>,
  callback: (context: RecordWritePluginContext) => Promise<T>
): Promise<T> => {
  const tracer = context.executionContext.tracer;
  const span = tracer?.startSpan(
    `teable.recordWritePlugin.${phase}`,
    createRecordWritePluginTraceAttributes(context, pluginName, phase)
  );
  const pluginContext = withRecordWritePluginTraceContext(context, pluginName, phase, span);

  if (!span || !tracer) {
    return callback(pluginContext);
  }

  return tracer.withSpan(span, async () => {
    try {
      return await callback(pluginContext);
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  });
};

const withRecordWritePluginExecutionSpan = async <T>(
  context: RecordWritePluginContext,
  pluginName: string,
  callback: () => Promise<T>
): Promise<T> => {
  const tracer = context.executionContext.tracer;
  const span = tracer?.startSpan(
    'teable.recordWritePlugin.execution',
    createTeableSpanAttributes('plugin', 'recordWritePlugin.execution', {
      ...createRecordWritePluginBaseTraceAttributes(context, pluginName),
    })
  );

  if (!span || !tracer) {
    return callback();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await callback();
    } catch (error) {
      span.recordError(describeError(error));
      throw error;
    } finally {
      span.end();
    }
  });
};

export class RecordWritePluginExecution {
  constructor(
    private readonly logger: LoggerPort.ILogger,
    private readonly context: RecordWritePluginContext,
    private readonly preparedPlugins: ReadonlyArray<PreparedPluginEntry>,
    private readonly sanitizeContext: RecordWritePluginContextSanitizer
  ) {}

  async guard(): Promise<Result<void, DomainError>> {
    return this.runPhase('guard', this.context);
  }

  getScope(): Result<RecordWritePluginScope | undefined, DomainError> {
    const specs = this.preparedPlugins
      .map((entry) => entry.scope?.recordSpec)
      .filter(
        (spec): spec is ISpecification<TableRecord, ITableRecordConditionSpecVisitor> =>
          spec != null
      );

    const recordSpec = composeAndSpecsOrUndefined(specs);
    const updateFieldIds = intersectDefinedSets(
      this.preparedPlugins.map((entry) => entry.scope?.updateFieldIds)
    );
    const createFieldIds = intersectDefinedSets(
      this.preparedPlugins.map((entry) => entry.scope?.createFieldIds)
    );
    const resolveUpdateFieldIdsForRecord = composeUpdateFieldResolvers(
      this.preparedPlugins.map((entry) => entry.scope?.resolveUpdateFieldIdsForRecord),
      updateFieldIds
    );

    if (!recordSpec && !updateFieldIds && !createFieldIds && !resolveUpdateFieldIdsForRecord) {
      return ok(undefined);
    }

    return ok({
      ...(recordSpec ? { recordSpec } : {}),
      ...(updateFieldIds ? { updateFieldIds } : {}),
      ...(createFieldIds ? { createFieldIds } : {}),
      ...(resolveUpdateFieldIdsForRecord ? { resolveUpdateFieldIdsForRecord } : {}),
    });
  }

  getRecordSpec(): Result<
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    DomainError
  > {
    return this.getScope().map((scope) => scope?.recordSpec);
  }

  getUpdateFieldIdsForRecord(
    record: TableRecord
  ): Result<ReadonlySet<string> | undefined, DomainError> {
    return this.getScope().map((scope) => scope?.resolveUpdateFieldIdsForRecord?.(record));
  }

  async beforePersist(executionContext: IExecutionContext): Promise<Result<void, DomainError>> {
    return this.runPhase(
      'beforePersist',
      withTransactionBoundContext(this.context, executionContext)
    );
  }

  async afterCommit(): Promise<void> {
    for (const group of createEnforceGroups(
      this.preparedPlugins,
      (entry) => entry.plugin.enforce
    )) {
      const tasks = group
        .filter((entry) => entry.plugin.afterCommit)
        .map(async (entry) => {
          try {
            const pluginContextResult = this.sanitizeContext(this.context);
            if (pluginContextResult.isErr()) {
              this.logAfterCommitError(entry.plugin.name, pluginContextResult.error);
              return;
            }

            const result = await withRecordWritePluginExecutionSpan(
              pluginContextResult.value,
              entry.plugin.name,
              async () =>
                withRecordWritePluginSpan(
                  pluginContextResult.value,
                  entry.plugin.name,
                  'afterCommit',
                  async (pluginContext) =>
                    entry.plugin.afterCommit!.call(entry.plugin, pluginContext, entry.preparedState)
                )
            );
            if (result.isErr()) {
              this.logAfterCommitError(entry.plugin.name, result.error);
            }
          } catch (error) {
            this.logAfterCommitError(
              entry.plugin.name,
              domainError.fromUnknown(error, {
                code: 'record_write_plugin.after_commit_failed',
                details: {
                  operation: this.context.kind,
                },
              })
            );
          }
        });

      await Promise.allSettled(tasks);
    }
  }

  getPreparedStateFor(plugin: IRecordWritePlugin<unknown>): unknown {
    return this.preparedPlugins.find((entry) => entry.plugin === plugin)?.preparedState;
  }

  private async runPhase(
    phase: 'guard' | 'beforePersist',
    context: RecordWritePluginContext
  ): Promise<Result<void, DomainError>> {
    if (phase === 'beforePersist') {
      for (const entry of this.preparedPlugins) {
        const result = await this.invokePhaseHook(phase, context, entry);
        if (result.isErr()) {
          return err(result.error);
        }
      }

      return ok(undefined);
    }

    for (const group of createEnforceGroups(
      this.preparedPlugins,
      (entry) => entry.plugin.enforce
    )) {
      const results = await Promise.all(
        group.map((entry) => this.invokePhaseHook(phase, context, entry))
      );

      for (const result of results) {
        if (result.isErr()) {
          return err(result.error);
        }
      }
    }

    return ok(undefined);
  }

  private async invokePhaseHook(
    phase: 'guard' | 'beforePersist',
    context: RecordWritePluginContext,
    entry: PreparedPluginEntry
  ): Promise<Result<void, DomainError>> {
    const plugin = entry.plugin;
    const hook = phase === 'guard' ? plugin.guard : plugin.beforePersist;
    if (!hook) {
      return ok(undefined);
    }

    const pluginContextResult = this.sanitizeContext(context);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    try {
      const result = await withRecordWritePluginExecutionSpan(
        pluginContextResult.value,
        plugin.name,
        async () =>
          withRecordWritePluginSpan(
            pluginContextResult.value,
            plugin.name,
            phase,
            async (pluginContext) => hook.call(plugin, pluginContext, entry.preparedState)
          )
      );
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(undefined);
    } catch (error) {
      return err(
        domainError.fromUnknown(error, {
          code: `record_write_plugin.${phase}_failed`,
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }

  private logAfterCommitError(pluginName: string, error: DomainError): void {
    this.logger.error('Record write plugin afterCommit failed', {
      operation: this.context.kind,
      plugin: pluginName,
      error,
    });
  }
}

@injectable()
export class RecordWritePluginRunner {
  constructor(
    @inject(v2CoreTokens.recordWritePlugins)
    private readonly plugins: IRecordWritePlugin[],
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async prepare(
    context: RecordWritePluginContext,
    options?: {
      previousExecution?: RecordWritePluginExecution;
    }
  ): Promise<Result<RecordWritePluginExecution, DomainError>> {
    const preparedPlugins: PreparedPluginEntry[] = [];
    const matchedPluginsResult = this.resolvePlugins(context);
    if (matchedPluginsResult.isErr()) {
      return err(matchedPluginsResult.error);
    }
    const matchedPlugins = matchedPluginsResult.value;

    for (const group of createEnforceGroups(matchedPlugins, (plugin) => plugin.enforce)) {
      const results = await Promise.all(
        group.map((plugin) =>
          this.preparePlugin(
            plugin,
            context,
            options?.previousExecution?.getPreparedStateFor(plugin)
          )
        )
      );

      for (const result of results) {
        if (result.isErr()) {
          return err(result.error);
        }

        preparedPlugins.push(result.value);
      }
    }

    return ok(
      new RecordWritePluginExecution(this.logger, context, preparedPlugins, (pluginContext) =>
        sanitizeRecordWritePluginContext(pluginContext, this.tableMapper)
      )
    );
  }

  private async preparePlugin(
    plugin: IRecordWritePlugin,
    context: RecordWritePluginContext,
    previousPreparedState?: unknown
  ): Promise<Result<PreparedPluginEntry, DomainError>> {
    const pluginContextResult = sanitizeRecordWritePluginContext(context, this.tableMapper);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    const pluginContext = pluginContextResult.value;

    let preparedState: unknown = undefined;

    if (plugin.prepare) {
      try {
        const result = await withRecordWritePluginExecutionSpan(
          pluginContext,
          plugin.name,
          async () =>
            withRecordWritePluginSpan(
              pluginContext,
              plugin.name,
              'prepare',
              async (preparedContext) =>
                plugin.prepare!.call(plugin, preparedContext, previousPreparedState)
            )
        );
        if (result.isErr()) {
          return err(result.error);
        }

        preparedState = result.value;
      } catch (error) {
        return err(
          domainError.fromUnknown(error, {
            code: 'record_write_plugin.prepare_failed',
            details: {
              operation: context.kind,
              plugin: plugin.name,
            },
          })
        );
      }
    }

    let scope: RecordWritePluginScope | undefined;
    if (plugin.scope) {
      try {
        const result = await withRecordWritePluginExecutionSpan(
          pluginContext,
          plugin.name,
          async () =>
            withRecordWritePluginSpan(pluginContext, plugin.name, 'scope', async (scopeContext) =>
              plugin.scope!.call(plugin, scopeContext, preparedState)
            )
        );
        if (result.isErr()) {
          return err(result.error);
        }

        scope = result.value;
      } catch (error) {
        return err(
          domainError.fromUnknown(error, {
            code: 'record_write_plugin.scope_failed',
            details: {
              operation: context.kind,
              plugin: plugin.name,
            },
          })
        );
      }
    }

    return ok({ plugin, preparedState, scope });
  }

  private resolvePlugins(
    context: RecordWritePluginContext
  ): Result<ReadonlyArray<IRecordWritePlugin>, DomainError> {
    const matchedPlugins: IRecordWritePlugin[] = [];

    for (const plugin of this.plugins) {
      try {
        if (this.supportsWithSpan(plugin, context)) {
          matchedPlugins.push(plugin);
        }
      } catch (error) {
        return err(
          domainError.fromUnknown(error, {
            code: 'record_write_plugin.supports_failed',
            details: {
              operation: context.kind,
              plugin: plugin.name,
            },
          })
        );
      }
    }

    return ok(
      matchedPlugins.sort((left, right) => enforceOrder(left.enforce) - enforceOrder(right.enforce))
    );
  }

  private supportsWithSpan(plugin: IRecordWritePlugin, context: RecordWritePluginContext): boolean {
    const tracer = context.executionContext.tracer;
    const span = tracer?.startSpan(
      'teable.recordWritePlugin.supports',
      createRecordWritePluginTraceAttributes(context, plugin.name, 'supports')
    );

    try {
      return plugin.supports(context.kind);
    } catch (error) {
      span?.recordError(describeError(error));
      throw error;
    } finally {
      span?.end();
    }
  }
}
