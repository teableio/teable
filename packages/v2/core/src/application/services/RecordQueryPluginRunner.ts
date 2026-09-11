import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { composeAndSpecsOrUndefined } from '../../domain/shared/specification/composeAndSpecs';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import * as LoggerPort from '../../ports/Logger';
import type {
  IRecordQueryPlugin,
  RecordQueryFieldMask,
  RecordQueryPluginContext,
  RecordQueryPluginEnforce,
  RecordQueryPluginRunnerOptions,
  RecordQueryPluginScope,
} from '../../ports/RecordQueryPlugin';
import { v2CoreTokens } from '../../ports/tokens';
import {
  createPluginTraceContext,
  createTeableSpanAttributes,
  TeableSpanAttributes,
  type ISpan,
  type SpanAttributes,
} from '../../ports/Tracer';

type PreparedPluginEntry = {
  readonly plugin: IRecordQueryPlugin<unknown>;
  readonly preparedState: unknown;
  readonly scope?: RecordQueryPluginScope;
};

type RecordQueryPluginContextSanitizer = (
  context: RecordQueryPluginContext
) => Result<RecordQueryPluginContext, DomainError>;

type RecordQueryPluginPhase = 'supports' | 'prepare' | 'scope' | 'guard';

const enforceOrder = (enforce?: RecordQueryPluginEnforce): number => {
  if (enforce === 'pre') return 0;
  if (enforce === 'post') return 2;
  return 1;
};

const createEnforceGroups = <T>(
  items: ReadonlyArray<T>,
  getEnforce: (item: T) => RecordQueryPluginEnforce | undefined
): T[][] => {
  const groups: [T[], T[], T[]] = [[], [], []];

  for (const item of items) {
    groups[enforceOrder(getEnforce(item))].push(item);
  }

  return groups.filter((group) => group.length > 0);
};

const getTableId = (table: RecordQueryPluginContext['table']): string | undefined => {
  try {
    return table.id().toString();
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

const createRecordQueryPluginTraceAttributes = (
  context: RecordQueryPluginContext,
  pluginName: string,
  phase: RecordQueryPluginPhase
): SpanAttributes => {
  const tableId = getTableId(context.table);
  return createTeableSpanAttributes('plugin', 'recordQueryPlugin.execution', {
    [TeableSpanAttributes.PLUGIN]: pluginName,
    [TeableSpanAttributes.PLUGIN_TYPE]: 'record_query',
    [TeableSpanAttributes.OPERATION_KIND]: context.kind,
    [TeableSpanAttributes.OPERATION]: `recordQueryPlugin.${phase}`,
    [TeableSpanAttributes.PLUGIN_PHASE]: phase,
    ...(tableId ? { [TeableSpanAttributes.TABLE_ID]: tableId } : {}),
  });
};

const withRecordQueryPluginTraceContext = (
  context: RecordQueryPluginContext,
  pluginName: string,
  phase: Exclude<RecordQueryPluginPhase, 'supports'>,
  activeSpan?: ISpan
): RecordQueryPluginContext => {
  return {
    ...context,
    trace: createPluginTraceContext({
      tracer: context.executionContext.tracer,
      activeSpan,
      attributes: createRecordQueryPluginTraceAttributes(context, pluginName, phase),
      spanNamePrefix: `teable.recordQueryPlugin.${pluginName}`,
      operationPrefix: `recordQueryPlugin.${phase}`,
    }),
  };
};

const withRecordQueryPluginSpan = async <T>(
  context: RecordQueryPluginContext,
  pluginName: string,
  phase: Exclude<RecordQueryPluginPhase, 'supports'>,
  callback: (context: RecordQueryPluginContext) => Promise<T>
): Promise<T> => {
  const tracer = context.executionContext.tracer;
  const span = tracer?.startSpan(
    `teable.recordQueryPlugin.${phase}`,
    createRecordQueryPluginTraceAttributes(context, pluginName, phase)
  );
  const pluginContext = withRecordQueryPluginTraceContext(context, pluginName, phase, span);

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

const withRecordQueryPluginExecutionSpan = async <T>(
  context: RecordQueryPluginContext,
  pluginName: string,
  callback: () => Promise<T>
): Promise<T> => {
  const tracer = context.executionContext.tracer;
  const span = tracer?.startSpan(
    'teable.recordQueryPlugin.execution',
    createTeableSpanAttributes('plugin', 'recordQueryPlugin.execution', {
      ...createRecordQueryPluginTraceAttributes(context, pluginName, 'prepare'),
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

const unionDefinedSets = (
  sets: ReadonlyArray<ReadonlySet<string> | undefined>
): ReadonlySet<string> | undefined => {
  const definedSets = sets.filter((set): set is ReadonlySet<string> => set != null);
  if (!definedSets.length) {
    return undefined;
  }
  const merged = new Set<string>();
  for (const set of definedSets) {
    for (const value of set) {
      merged.add(value);
    }
  }
  return merged;
};

/**
 * Merge field masks by fieldId. When multiple plugins mask the same field,
 * visibleWhen is AND-ed (stricter visibility).
 */
const mergeFieldMasks = (
  maskLists: ReadonlyArray<ReadonlyArray<RecordQueryFieldMask> | undefined>
): ReadonlyArray<RecordQueryFieldMask> | undefined => {
  const byFieldId = new Map<
    string,
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor>[]
  >();

  for (const masks of maskLists) {
    if (!masks?.length) {
      continue;
    }
    for (const mask of masks) {
      const existing = byFieldId.get(mask.fieldId) ?? [];
      existing.push(mask.visibleWhen);
      byFieldId.set(mask.fieldId, existing);
    }
  }

  if (!byFieldId.size) {
    return undefined;
  }

  const merged: RecordQueryFieldMask[] = [];
  for (const [fieldId, specs] of byFieldId) {
    const visibleWhen = composeAndSpecsOrUndefined(specs);
    if (!visibleWhen) {
      continue;
    }
    merged.push({ fieldId, visibleWhen });
  }

  return merged.length ? merged : undefined;
};

export class RecordQueryPluginExecution {
  constructor(
    private readonly context: RecordQueryPluginContext,
    private readonly preparedPlugins: ReadonlyArray<PreparedPluginEntry>,
    private readonly sanitizeContext: RecordQueryPluginContextSanitizer
  ) {}

  async guard(): Promise<Result<void, DomainError>> {
    for (const group of createEnforceGroups(
      this.preparedPlugins,
      (entry) => entry.plugin.enforce
    )) {
      const results = await Promise.all(
        group.map((entry) => this.invokeGuard(this.context, entry))
      );

      for (const result of results) {
        if (result.isErr()) {
          return err(result.error);
        }
      }
    }

    return ok(undefined);
  }

  getScope(): Result<RecordQueryPluginScope | undefined, DomainError> {
    // Monotonic merge: resolve skip/force inside each plugin first, then
    // AND recordSpecs and INTERSECT field allow-lists. A UX plugin that
    // skipRecordSpecs or forceReadable must not erase another plugin's
    // tenant isolation or deny-all allow-list.
    const perPluginRecordSpecs: Array<
      ISpecification<TableRecord, ITableRecordConditionSpecVisitor>
    > = [];
    const perPluginReadable: Array<ReadonlySet<string> | undefined> = [];
    const perPluginMasks: Array<ReadonlyArray<RecordQueryFieldMask> | undefined> = [];
    const perPluginForce: Array<ReadonlySet<string> | undefined> = [];
    let anySkipRecordSpec = false;
    let hasRestrictingScope = false;
    let allRestrictingScopesLegacyCompatible = true;

    for (const entry of this.preparedPlugins) {
      const scope = entry.scope;
      if (!scope) {
        continue;
      }

      const restrictsAccess = Boolean(
        scope.recordSpec ||
          scope.skipRecordSpec ||
          scope.readableFieldIds != null ||
          scope.fieldMasks?.length
      );
      if (restrictsAccess) {
        hasRestrictingScope = true;
        allRestrictingScopesLegacyCompatible &&= scope.legacyPermissionQueryCompatible === true;
      }

      // skipRecordSpec only drops THIS plugin's row filter contribution.
      if (scope.skipRecordSpec) {
        anySkipRecordSpec = true;
      } else if (scope.recordSpec) {
        perPluginRecordSpecs.push(scope.recordSpec);
      }

      // forceReadable is applied only within this plugin's allow-list before
      // cross-plugin intersection — it cannot re-open fields another plugin denied.
      let localReadable = scope.readableFieldIds;
      if (localReadable != null && scope.forceReadableFieldIds?.size) {
        localReadable = new Set([...localReadable, ...scope.forceReadableFieldIds]);
      }
      perPluginReadable.push(localReadable);
      perPluginForce.push(scope.forceReadableFieldIds);
      perPluginMasks.push(scope.fieldMasks);
    }

    const recordSpec = composeAndSpecsOrUndefined(perPluginRecordSpecs);
    const readableFieldIds = intersectDefinedSets(perPluginReadable);
    // Exported for observability / single-plugin keepPrimary consumers only.
    // Not re-unioned into readableFieldIds after intersection.
    const forceReadableFieldIds = unionDefinedSets(perPluginForce);
    // All contributing plugins skipped their row filter AND no remaining specs.
    const skipRecordSpec = anySkipRecordSpec && recordSpec == null;
    const legacyPermissionQueryCompatible =
      hasRestrictingScope && allRestrictingScopesLegacyCompatible;
    // Masks are query-access contracts, not response-projection entries.
    // A field may be absent from readableFieldIds yet carry an always-false
    // mask so filters/sorts/groups/searches see its CTE-equivalent NULL value
    // without exposing the raw cell (T6997).
    const fieldMasks = mergeFieldMasks(perPluginMasks);

    if (!recordSpec && !skipRecordSpec && readableFieldIds == null && !fieldMasks?.length) {
      return ok(undefined);
    }

    return ok({
      ...(recordSpec ? { recordSpec } : {}),
      ...(skipRecordSpec ? { skipRecordSpec: true } : {}),
      ...(readableFieldIds != null ? { readableFieldIds } : {}),
      ...(forceReadableFieldIds ? { forceReadableFieldIds } : {}),
      ...(fieldMasks?.length ? { fieldMasks } : {}),
      ...(legacyPermissionQueryCompatible ? { legacyPermissionQueryCompatible: true } : {}),
    });
  }

  getRecordSpec(): Result<
    ISpecification<TableRecord, ITableRecordConditionSpecVisitor> | undefined,
    DomainError
  > {
    return this.getScope().map((scope) => scope?.recordSpec);
  }

  getReadableFieldIds(): Result<ReadonlySet<string> | undefined, DomainError> {
    return this.getScope().map((scope) => scope?.readableFieldIds);
  }

  getPreparedStateFor(plugin: IRecordQueryPlugin<unknown>): unknown {
    return this.preparedPlugins.find((entry) => entry.plugin === plugin)?.preparedState;
  }

  private async invokeGuard(
    context: RecordQueryPluginContext,
    entry: PreparedPluginEntry
  ): Promise<Result<void, DomainError>> {
    const plugin = entry.plugin;
    if (!plugin.guard) {
      return ok(undefined);
    }

    const pluginContextResult = this.sanitizeContext(context);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    try {
      const result = await withRecordQueryPluginExecutionSpan(
        pluginContextResult.value,
        plugin.name,
        async () =>
          withRecordQueryPluginSpan(
            pluginContextResult.value,
            plugin.name,
            'guard',
            async (pluginContext) => plugin.guard!.call(plugin, pluginContext, entry.preparedState)
          )
      );
      if (result.isErr()) {
        return err(result.error);
      }
      return ok(undefined);
    } catch (error) {
      return err(
        domainError.fromUnknown(error, {
          code: 'record_query_plugin.guard_failed',
          details: {
            operation: context.kind,
            plugin: plugin.name,
          },
        })
      );
    }
  }
}

@injectable()
export class RecordQueryPluginRunner {
  constructor(
    @inject(v2CoreTokens.recordQueryPlugins)
    private readonly plugins: IRecordQueryPlugin[],
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger
  ) {}

  async prepare(
    context: RecordQueryPluginContext,
    options?: {
      previousExecution?: RecordQueryPluginExecution;
      runnerOptions?: RecordQueryPluginRunnerOptions;
    }
  ): Promise<Result<RecordQueryPluginExecution, DomainError>> {
    const preparedPlugins: PreparedPluginEntry[] = [];
    const matchedPluginsResult = this.resolvePlugins(context, options?.runnerOptions);
    if (matchedPluginsResult.isErr()) {
      return err(matchedPluginsResult.error);
    }
    const matchedPlugins = matchedPluginsResult.value;
    // Query plugins receive ITableReadModel and must not mutate the aggregate.
    // Cloning via toDTO/toDomain doubled getRecords CPU (T7092).
    const sanitizeContext: RecordQueryPluginContextSanitizer = (context) => ok(context);

    for (const group of createEnforceGroups(matchedPlugins, (plugin) => plugin.enforce)) {
      const results = await Promise.all(
        group.map((plugin) =>
          this.preparePlugin(
            plugin,
            context,
            sanitizeContext,
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

    this.logger.debug('Record query plugins prepared', {
      operation: context.kind,
      pluginCount: preparedPlugins.length,
    });

    return ok(new RecordQueryPluginExecution(context, preparedPlugins, sanitizeContext));
  }

  private async preparePlugin(
    plugin: IRecordQueryPlugin,
    context: RecordQueryPluginContext,
    sanitizeContext: RecordQueryPluginContextSanitizer,
    previousPreparedState?: unknown
  ): Promise<Result<PreparedPluginEntry, DomainError>> {
    const pluginContextResult = sanitizeContext(context);
    if (pluginContextResult.isErr()) {
      return err(pluginContextResult.error);
    }

    const pluginContext = pluginContextResult.value;
    let preparedState: unknown = undefined;

    if (plugin.prepare) {
      try {
        const result = await withRecordQueryPluginExecutionSpan(
          pluginContext,
          plugin.name,
          async () =>
            withRecordQueryPluginSpan(
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
            code: 'record_query_plugin.prepare_failed',
            details: {
              operation: context.kind,
              plugin: plugin.name,
            },
          })
        );
      }
    }

    let scope: RecordQueryPluginScope | undefined;
    if (plugin.scope) {
      try {
        const result = await withRecordQueryPluginExecutionSpan(
          pluginContext,
          plugin.name,
          async () =>
            withRecordQueryPluginSpan(pluginContext, plugin.name, 'scope', async (scopeContext) =>
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
            code: 'record_query_plugin.scope_failed',
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
    context: RecordQueryPluginContext,
    options?: RecordQueryPluginRunnerOptions
  ): Result<ReadonlyArray<IRecordQueryPlugin>, DomainError> {
    const matchedPlugins: IRecordQueryPlugin[] = [];

    for (const plugin of this.plugins) {
      if (options?.skipPluginNames?.has(plugin.name)) {
        continue;
      }

      try {
        if (plugin.supports(context.kind)) {
          matchedPlugins.push(plugin);
        }
      } catch (error) {
        return err(
          domainError.fromUnknown(error, {
            code: 'record_query_plugin.supports_failed',
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
}
