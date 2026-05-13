import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { NoopLogger } from '../../ports/defaults/NoopLogger';
import * as LoggerPort from '../../ports/Logger';
import {
  type ITableOperationPlugin,
  type TableOperationPluginContext,
  type TableOperationPluginEnforce,
} from '../../ports/TableOperationPlugin';
import { v2CoreTokens } from '../../ports/tokens';

type PreparedPluginEntry = {
  readonly plugin: ITableOperationPlugin<unknown>;
  readonly preparedState: unknown;
};

const enforceOrder = (enforce?: TableOperationPluginEnforce): number => {
  if (enforce === 'pre') return 0;
  if (enforce === 'post') return 2;
  return 1;
};

const createEnforceGroups = <T>(
  items: ReadonlyArray<T>,
  getEnforce: (item: T) => TableOperationPluginEnforce | undefined
): T[][] => {
  const groups: [T[], T[], T[]] = [[], [], []];

  for (const item of items) {
    groups[enforceOrder(getEnforce(item))].push(item);
  }

  return groups.filter((group) => group.length > 0);
};

const withTransactionBoundContext = (
  context: TableOperationPluginContext,
  executionContext: IExecutionContext
): TableOperationPluginContext => {
  return {
    ...context,
    executionContext,
    isTransactionBound: true,
  } as TableOperationPluginContext;
};

export class TableOperationPluginExecution {
  constructor(
    private readonly logger: LoggerPort.ILogger,
    private readonly context: TableOperationPluginContext,
    private readonly preparedPlugins: ReadonlyArray<PreparedPluginEntry>
  ) {}

  async guard(executionContext?: IExecutionContext): Promise<Result<void, DomainError>> {
    const context = executionContext
      ? withTransactionBoundContext(this.context, executionContext)
      : this.context;

    for (const group of createEnforceGroups(
      this.preparedPlugins,
      (entry) => entry.plugin.enforce
    )) {
      const results = await Promise.all(group.map((entry) => this.invokeGuard(context, entry)));

      for (const result of results) {
        if (result.isErr()) {
          return err(result.error);
        }
      }
    }

    return ok(undefined);
  }

  private async invokeGuard(
    context: TableOperationPluginContext,
    entry: PreparedPluginEntry
  ): Promise<Result<void, DomainError>> {
    const plugin = entry.plugin;
    if (!plugin.guard) {
      return ok(undefined);
    }

    try {
      const result = await plugin.guard.call(plugin, context, entry.preparedState);
      if (result.isErr()) return err(result.error);
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.fromUnknown(error, {
          code: 'table_operation_plugin.guard_failed',
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }

  logSkippedAfterError(pluginName: string, error: DomainError): void {
    this.logger.error('Table operation plugin failed', {
      operation: this.context.kind,
      plugin: pluginName,
      error,
    });
  }
}

@injectable()
export class TableOperationPluginRunner {
  constructor(
    @inject(v2CoreTokens.tableOperationPlugins)
    private readonly plugins?: ITableOperationPlugin[],
    @inject(v2CoreTokens.logger)
    private readonly logger?: LoggerPort.ILogger
  ) {}

  async prepare(
    context: TableOperationPluginContext
  ): Promise<Result<TableOperationPluginExecution, DomainError>> {
    const matchedPlugins = (this.plugins ?? []).filter((plugin) => plugin.supports(context.kind));
    const preparedPlugins: PreparedPluginEntry[] = [];

    for (const group of createEnforceGroups(matchedPlugins, (plugin) => plugin.enforce)) {
      const results = await Promise.all(group.map((plugin) => this.preparePlugin(plugin, context)));

      for (const result of results) {
        if (result.isErr()) return err(result.error);
        preparedPlugins.push(result.value);
      }
    }

    return ok(
      new TableOperationPluginExecution(this.logger ?? new NoopLogger(), context, preparedPlugins)
    );
  }

  private async preparePlugin(
    plugin: ITableOperationPlugin,
    context: TableOperationPluginContext
  ): Promise<Result<PreparedPluginEntry, DomainError>> {
    if (!plugin.prepare) {
      return ok({ plugin, preparedState: undefined });
    }

    try {
      const result = await plugin.prepare.call(plugin, context);
      if (result.isErr()) return err(result.error);
      return ok({ plugin, preparedState: result.value });
    } catch (error) {
      return err(
        domainError.fromUnknown(error, {
          code: 'table_operation_plugin.prepare_failed',
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }
}
