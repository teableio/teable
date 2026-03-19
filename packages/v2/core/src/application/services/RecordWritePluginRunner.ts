import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as LoggerPort from '../../ports/Logger';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import type {
  IRecordWritePlugin,
  RecordWritePluginContext,
  RecordWritePluginEnforce,
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
};

type RecordWritePluginContextSanitizer = (
  context: RecordWritePluginContext
) => Result<RecordWritePluginContext, DomainError>;

type RecordWritePluginPhase = 'supports' | 'prepare' | 'guard' | 'beforePersist' | 'afterCommit';

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
  const tableId = getTableId(context.table);

  return createTeableSpanAttributes('plugin', `recordWritePlugin.${phase}`, {
    [TeableSpanAttributes.PLUGIN]: pluginName,
    [TeableSpanAttributes.PLUGIN_TYPE]: 'record_write',
    [TeableSpanAttributes.PLUGIN_PHASE]: phase,
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

            const result = await withRecordWritePluginSpan(
              pluginContextResult.value,
              entry.plugin.name,
              'afterCommit',
              async (pluginContext) =>
                entry.plugin.afterCommit!.call(entry.plugin, pluginContext, entry.preparedState)
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
      const result = await withRecordWritePluginSpan(
        pluginContextResult.value,
        plugin.name,
        phase,
        async (pluginContext) => hook.call(plugin, pluginContext, entry.preparedState)
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
    context: RecordWritePluginContext
  ): Promise<Result<RecordWritePluginExecution, DomainError>> {
    const preparedPlugins: PreparedPluginEntry[] = [];
    const matchedPluginsResult = this.resolvePlugins(context);
    if (matchedPluginsResult.isErr()) {
      return err(matchedPluginsResult.error);
    }
    const matchedPlugins = matchedPluginsResult.value;

    for (const group of createEnforceGroups(matchedPlugins, (plugin) => plugin.enforce)) {
      const results = await Promise.all(group.map((plugin) => this.preparePlugin(plugin, context)));

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
    context: RecordWritePluginContext
  ): Promise<Result<PreparedPluginEntry, DomainError>> {
    if (!plugin.prepare) {
      return ok({ plugin, preparedState: undefined });
    }

    const pluginContextResult = sanitizeRecordWritePluginContext(context, this.tableMapper);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    try {
      const result = await withRecordWritePluginSpan(
        pluginContextResult.value,
        plugin.name,
        'prepare',
        async (pluginContext) => plugin.prepare!.call(plugin, pluginContext)
      );
      if (result.isErr()) {
        return err(result.error);
      }

      return ok({ plugin, preparedState: result.value });
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
