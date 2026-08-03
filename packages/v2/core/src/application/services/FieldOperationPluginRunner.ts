import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { Field } from '../../domain/table/fields/Field';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type {
  FieldOperationPluginContext,
  FieldOperationPluginEnforce,
  IFieldOperationPlugin,
} from '../../ports/FieldOperationPlugin';
import * as LoggerPort from '../../ports/Logger';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import { v2CoreTokens } from '../../ports/tokens';
import {
  createPluginTraceContext,
  createTeableSpanAttributes,
  TeableSpanAttributes,
  type ISpan,
  type SpanAttributes,
} from '../../ports/Tracer';

type PreparedPluginEntry = {
  readonly plugin: IFieldOperationPlugin<unknown>;
  readonly preparedState: unknown;
};

type FieldOperationPluginContextSanitizer = (
  context: FieldOperationPluginContext
) => Result<FieldOperationPluginContext, DomainError>;

type FieldOperationPluginPhase = 'supports' | 'prepare' | 'guard' | 'beforePersist' | 'afterCommit';

const enforceOrder = (enforce?: FieldOperationPluginEnforce): number => {
  if (enforce === 'pre') return 0;
  if (enforce === 'post') return 2;
  return 1;
};

const withTransactionBoundContext = (
  context: FieldOperationPluginContext,
  executionContext: IExecutionContext
): FieldOperationPluginContext => {
  return {
    ...context,
    executionContext,
    isTransactionBound: true,
  } as FieldOperationPluginContext;
};

const createEnforceGroups = <T>(
  items: ReadonlyArray<T>,
  getEnforce: (item: T) => FieldOperationPluginEnforce | undefined
): T[][] => {
  const groups: [T[], T[], T[]] = [[], [], []];

  for (const item of items) {
    groups[enforceOrder(getEnforce(item))].push(item);
  }

  return groups.filter((group) => group.length > 0);
};

const cloneTableOnce = (
  table: FieldOperationPluginContext['table'],
  tableMapper: TableMapperPort.ITableMapper,
  cache: WeakMap<FieldOperationPluginContext['table'], FieldOperationPluginContext['table']>
): Result<FieldOperationPluginContext['table'], DomainError> => {
  const cached = cache.get(table);
  if (cached) {
    return ok(cached);
  }

  return table.clone(tableMapper).map((clonedTable) => {
    cache.set(table, clonedTable);
    return clonedTable;
  });
};

const cloneDetachedField = (
  field: Field,
  hostTable: FieldOperationPluginContext['table'],
  tableMapper: TableMapperPort.ITableMapper
): Result<Field, DomainError> => {
  return TableAggregate.rehydrate({
    id: hostTable.id(),
    baseId: hostTable.baseId(),
    name: hostTable.name(),
    fields: [field],
    views: [],
    primaryFieldId: field.id(),
  })
    .andThen((table) => table.clone(tableMapper))
    .andThen((table) => table.getField((candidate) => candidate.id().equals(field.id())));
};

const detachField = (
  field: Field,
  hostTable: FieldOperationPluginContext['table'],
  candidateTables: ReadonlyArray<FieldOperationPluginContext['table']>,
  tableMapper: TableMapperPort.ITableMapper
): Result<Field, DomainError> => {
  for (const candidateTable of candidateTables) {
    const fieldResult = candidateTable.getField((candidate) => candidate.id().equals(field.id()));
    if (fieldResult.isOk()) {
      return ok(fieldResult.value);
    }
  }

  return cloneDetachedField(field, hostTable, tableMapper);
};

const sanitizeFieldOperationPluginContext = (
  context: FieldOperationPluginContext,
  tableMapper: TableMapperPort.ITableMapper
): Result<FieldOperationPluginContext, DomainError> => {
  const cache = new WeakMap<
    FieldOperationPluginContext['table'],
    FieldOperationPluginContext['table']
  >();
  const tableResult = cloneTableOnce(context.table, tableMapper, cache);
  if (tableResult.isErr()) {
    return err(tableResult.error);
  }
  const sourceTableResult = cloneTableOnce(context.target.sourceTable, tableMapper, cache);
  if (sourceTableResult.isErr()) {
    return err(sourceTableResult.error);
  }

  const detachedForeignTables: FieldOperationPluginContext['table'][] = [];
  for (const foreignTable of context.payload.foreignTables) {
    const foreignTableResult = cloneTableOnce(foreignTable, tableMapper, cache);
    if (foreignTableResult.isErr()) {
      return err(foreignTableResult.error);
    }
    detachedForeignTables.push(foreignTableResult.value);
  }

  const table = tableResult.value;
  const sourceTable = sourceTableResult.value;
  const sanitizeCurrentTableField = (field: Field) =>
    detachField(field, context.table, [table, sourceTable, ...detachedForeignTables], tableMapper);
  const sanitizeSourceTableField = (field: Field) =>
    detachField(
      field,
      context.target.sourceTable,
      [sourceTable, table, ...detachedForeignTables],
      tableMapper
    );

  const baseContext = {
    ...context,
    table,
    target: {
      ...context.target,
      sourceTable,
    },
  };

  switch (context.kind) {
    case 'create': {
      const candidateFieldResult = context.payload.candidateField
        ? sanitizeCurrentTableField(context.payload.candidateField)
        : ok(undefined);
      if (candidateFieldResult.isErr()) {
        return err(candidateFieldResult.error);
      }

      const createdFieldResult =
        context.result && 'createdField' in context.result
          ? sanitizeCurrentTableField(context.result.createdField)
          : ok(undefined);
      if (createdFieldResult.isErr()) {
        return err(createdFieldResult.error);
      }

      return ok({
        ...baseContext,
        payload: {
          ...context.payload,
          foreignTables: detachedForeignTables,
          candidateField: candidateFieldResult.value,
        },
        result:
          createdFieldResult.value == null
            ? undefined
            : {
                createdField: createdFieldResult.value,
              },
      } as FieldOperationPluginContext);
    }
    case 'update': {
      const previousFieldResult = sanitizeSourceTableField(context.payload.previousField);
      if (previousFieldResult.isErr()) {
        return err(previousFieldResult.error);
      }

      const updatedFieldResult =
        context.result && 'updatedField' in context.result
          ? sanitizeCurrentTableField(context.result.updatedField)
          : ok(undefined);
      if (updatedFieldResult.isErr()) {
        return err(updatedFieldResult.error);
      }

      return ok({
        ...baseContext,
        payload: {
          ...context.payload,
          previousField: previousFieldResult.value,
          foreignTables: detachedForeignTables,
        },
        result:
          updatedFieldResult.value == null
            ? undefined
            : {
                updatedField: updatedFieldResult.value,
              },
      } as FieldOperationPluginContext);
    }
    case 'delete': {
      const targetFieldResult = sanitizeSourceTableField(context.payload.targetField);
      if (targetFieldResult.isErr()) {
        return err(targetFieldResult.error);
      }

      const deletedFieldResult =
        context.result && 'deletedField' in context.result
          ? sanitizeSourceTableField(context.result.deletedField)
          : ok(undefined);
      if (deletedFieldResult.isErr()) {
        return err(deletedFieldResult.error);
      }

      return ok({
        ...baseContext,
        payload: {
          ...context.payload,
          targetField: targetFieldResult.value,
          foreignTables: detachedForeignTables,
        },
        result:
          deletedFieldResult.value == null
            ? undefined
            : {
                deletedField: deletedFieldResult.value,
              },
      } as FieldOperationPluginContext);
    }
    case 'duplicate': {
      const sourceFieldResult = sanitizeSourceTableField(context.payload.sourceField);
      if (sourceFieldResult.isErr()) {
        return err(sourceFieldResult.error);
      }

      const duplicatedSourceFieldResult =
        context.result && 'sourceField' in context.result
          ? sanitizeSourceTableField(context.result.sourceField)
          : ok(undefined);
      if (duplicatedSourceFieldResult.isErr()) {
        return err(duplicatedSourceFieldResult.error);
      }

      const duplicatedFieldResult =
        context.result && 'duplicatedField' in context.result
          ? sanitizeCurrentTableField(context.result.duplicatedField)
          : ok(undefined);
      if (duplicatedFieldResult.isErr()) {
        return err(duplicatedFieldResult.error);
      }

      return ok({
        ...baseContext,
        payload: {
          ...context.payload,
          sourceField: sourceFieldResult.value,
          foreignTables: detachedForeignTables,
        },
        result:
          duplicatedFieldResult.value == null || duplicatedSourceFieldResult.value == null
            ? undefined
            : {
                sourceField: duplicatedSourceFieldResult.value,
                duplicatedField: duplicatedFieldResult.value,
              },
      } as FieldOperationPluginContext);
    }
  }
};

const getTableId = (table: FieldOperationPluginContext['table']): string | undefined => {
  try {
    return table.id().toString();
  } catch {
    return undefined;
  }
};

const getFieldId = (context: FieldOperationPluginContext): string | undefined => {
  if ('fieldId' in context.payload && context.payload.fieldId) {
    return context.payload.fieldId.toString();
  }

  if (context.result) {
    if ('createdField' in context.result) {
      return context.result.createdField.id().toString();
    }

    if ('updatedField' in context.result) {
      return context.result.updatedField.id().toString();
    }

    if ('deletedField' in context.result) {
      return context.result.deletedField.id().toString();
    }

    if ('duplicatedField' in context.result) {
      return context.result.duplicatedField.id().toString();
    }
  }

  return undefined;
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

const createFieldOperationPluginTraceAttributes = (
  context: FieldOperationPluginContext,
  pluginName: string,
  phase: FieldOperationPluginPhase
): SpanAttributes => {
  const tableId = getTableId(context.table);
  const fieldId = getFieldId(context);

  return createTeableSpanAttributes('plugin', `fieldOperationPlugin.${phase}`, {
    [TeableSpanAttributes.PLUGIN]: pluginName,
    [TeableSpanAttributes.PLUGIN_TYPE]: 'field_operation',
    [TeableSpanAttributes.PLUGIN_PHASE]: phase,
    [TeableSpanAttributes.OPERATION_KIND]: context.kind,
    [TeableSpanAttributes.TARGET_KIND]: context.target.kind,
    [TeableSpanAttributes.IS_TRANSACTION_BOUND]: context.isTransactionBound,
    ...(tableId ? { [TeableSpanAttributes.TABLE_ID]: tableId } : {}),
    ...(fieldId ? { [TeableSpanAttributes.FIELD_ID]: fieldId } : {}),
  });
};

const withFieldOperationPluginTraceContext = (
  context: FieldOperationPluginContext,
  pluginName: string,
  phase: Exclude<FieldOperationPluginPhase, 'supports'>,
  activeSpan?: ISpan
): FieldOperationPluginContext => {
  return {
    ...context,
    trace: createPluginTraceContext({
      tracer: context.executionContext.tracer,
      activeSpan,
      attributes: createFieldOperationPluginTraceAttributes(context, pluginName, phase),
      spanNamePrefix: `teable.fieldOperationPlugin.${pluginName}`,
      operationPrefix: `fieldOperationPlugin.${phase}`,
    }),
  };
};

const withFieldOperationPluginSpan = async <T>(
  context: FieldOperationPluginContext,
  pluginName: string,
  phase: Exclude<FieldOperationPluginPhase, 'supports'>,
  callback: (context: FieldOperationPluginContext) => Promise<T>
): Promise<T> => {
  const tracer = context.executionContext.tracer;
  const span = tracer?.startSpan(
    `teable.fieldOperationPlugin.${phase}`,
    createFieldOperationPluginTraceAttributes(context, pluginName, phase)
  );
  const pluginContext = withFieldOperationPluginTraceContext(context, pluginName, phase, span);

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

export class FieldOperationPluginExecution {
  constructor(
    private readonly logger: LoggerPort.ILogger,
    private readonly context: FieldOperationPluginContext,
    private readonly preparedPlugins: ReadonlyArray<PreparedPluginEntry>,
    private readonly sanitizeContext: FieldOperationPluginContextSanitizer
  ) {}

  async guard(): Promise<Result<void, DomainError>> {
    return this.runPhase('guard', this.context);
  }

  async beforePersist(
    executionContext: IExecutionContext,
    contextOverride?: FieldOperationPluginContext
  ): Promise<Result<void, DomainError>> {
    return this.runPhase(
      'beforePersist',
      withTransactionBoundContext(contextOverride ?? this.context, executionContext)
    );
  }

  async afterCommit(contextOverride?: FieldOperationPluginContext): Promise<void> {
    const context = contextOverride ?? this.context;

    for (const group of createEnforceGroups(
      this.preparedPlugins,
      (entry) => entry.plugin.enforce
    )) {
      const tasks = group
        .filter((entry) => entry.plugin.afterCommit)
        .map(async (entry) => {
          try {
            const pluginContextResult = this.sanitizeContext(context);
            if (pluginContextResult.isErr()) {
              this.logAfterCommitError(entry.plugin.name, context, pluginContextResult.error);
              return;
            }

            const result = await withFieldOperationPluginSpan(
              pluginContextResult.value,
              entry.plugin.name,
              'afterCommit',
              async (pluginContext) =>
                entry.plugin.afterCommit!.call(entry.plugin, pluginContext, entry.preparedState)
            );
            if (result.isErr()) {
              this.logAfterCommitError(entry.plugin.name, context, result.error);
            }
          } catch (error) {
            this.logAfterCommitError(
              entry.plugin.name,
              context,
              domainError.fromUnknown(error, {
                code: 'field_operation_plugin.after_commit_failed',
                details: {
                  operation: context.kind,
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
    context: FieldOperationPluginContext
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
    context: FieldOperationPluginContext,
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
      const result = await withFieldOperationPluginSpan(
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
          code: `field_operation_plugin.${phase}_failed`,
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }

  private logAfterCommitError(
    pluginName: string,
    context: FieldOperationPluginContext,
    error: DomainError
  ): void {
    this.logger.error('Field operation plugin afterCommit failed', {
      operation: context.kind,
      plugin: pluginName,
      error,
    });
  }
}

@injectable()
export class FieldOperationPluginRunner {
  constructor(
    @inject(v2CoreTokens.fieldOperationPlugins)
    private readonly plugins: IFieldOperationPlugin[],
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper
  ) {}

  async prepare(
    context: FieldOperationPluginContext
  ): Promise<Result<FieldOperationPluginExecution, DomainError>> {
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
      new FieldOperationPluginExecution(this.logger, context, preparedPlugins, (pluginContext) =>
        sanitizeFieldOperationPluginContext(pluginContext, this.tableMapper)
      )
    );
  }

  private async preparePlugin(
    plugin: IFieldOperationPlugin,
    context: FieldOperationPluginContext
  ): Promise<Result<PreparedPluginEntry, DomainError>> {
    if (!plugin.prepare) {
      return ok({ plugin, preparedState: undefined });
    }

    const pluginContextResult = sanitizeFieldOperationPluginContext(context, this.tableMapper);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    try {
      const result = await withFieldOperationPluginSpan(
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
          code: 'field_operation_plugin.prepare_failed',
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }

  private resolvePlugins(
    context: FieldOperationPluginContext
  ): Result<ReadonlyArray<IFieldOperationPlugin>, DomainError> {
    const matchedPlugins: IFieldOperationPlugin[] = [];

    for (const plugin of this.plugins) {
      try {
        if (this.supportsWithSpan(plugin, context)) {
          matchedPlugins.push(plugin);
        }
      } catch (error) {
        return err(
          domainError.fromUnknown(error, {
            code: 'field_operation_plugin.supports_failed',
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

  private supportsWithSpan(
    plugin: IFieldOperationPlugin,
    context: FieldOperationPluginContext
  ): boolean {
    const tracer = context.executionContext.tracer;
    const span = tracer?.startSpan(
      'teable.fieldOperationPlugin.supports',
      createFieldOperationPluginTraceAttributes(context, plugin.name, 'supports')
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
