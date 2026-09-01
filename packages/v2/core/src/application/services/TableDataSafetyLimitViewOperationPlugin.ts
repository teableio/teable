import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import {
  ensureWithinTableDataSafetyLimit,
  tableDataSafetyLimitErrors,
  measureJsonBytes,
  resolveTableDataSafetyLimits,
  type ResolvedTableDataSafetyLimitConfig,
} from '../../domain/shared/TableDataSafetyLimits';
import {
  ViewOperationKind,
  type IViewOperationPlugin,
  type ViewOperationPayloadViewConfig,
  type ViewOperationPluginContext,
} from '../../ports/ViewOperationPlugin';
import {
  createDefaultTableDataSafetyLimitComposer,
  type TableDataSafetyLimitComposer,
} from './TableDataSafetyLimitComposer';

type PreparedTableDataSafetyViewLimitState = {
  readonly limits: ResolvedTableDataSafetyLimitConfig;
};

type FilterSetLike = {
  readonly filterSet?: ReadonlyArray<FilterNode>;
  readonly items?: ReadonlyArray<FilterNode>;
};

type FilterNode = FilterSetLike | Readonly<Record<string, unknown>>;
type FilterMeasureResult = { itemCount: number; depth: number };

const filterChildren = (value: unknown): ReadonlyArray<FilterNode> | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const group = value as FilterSetLike;
  if (Array.isArray(group.filterSet)) return group.filterSet;
  if (Array.isArray(group.items)) return group.items;
  return undefined;
};

const measureFilter = (filter: unknown): FilterMeasureResult => {
  if (filter == null) return { itemCount: 0, depth: 0 };

  const visit = (node: unknown, depth: number): FilterMeasureResult => {
    const children = filterChildren(node);
    if (!children) return { itemCount: 1, depth };

    return children.reduce<FilterMeasureResult>(
      (acc, child) => {
        const childResult = visit(child, depth + 1);
        return {
          itemCount: acc.itemCount + childResult.itemCount,
          depth: Math.max(acc.depth, childResult.depth),
        };
      },
      { itemCount: 0, depth }
    );
  };

  return visit(filter, 1);
};

const sortItemCount = (sort: unknown): number => {
  if (sort == null) return 0;
  if (Array.isArray(sort)) return sort.length;
  if (typeof sort !== 'object') return 0;
  const sortObjs = (sort as { sortObjs?: unknown }).sortObjs;
  return Array.isArray(sortObjs) ? sortObjs.length : 0;
};

const groupItemCount = (group: unknown): number => (Array.isArray(group) ? group.length : 0);

export const ensureTableDataSafetyViewOperationLimits = (
  context: ViewOperationPluginContext,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  if (context.kind === ViewOperationKind.create || context.kind === ViewOperationKind.duplicate) {
    const addedViewCount = context.payload.addedViewCount ?? 1;
    const viewsPerTableResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewsPerTableMax,
      context.payload.currentViewCount + addedViewCount,
      limits.tableSchema.maxViewsPerTable,
      {
        target: 'table.views',
        tableId: context.payload.tableId,
        currentViewCount: context.payload.currentViewCount,
        addedViewCount,
      }
    );
    if (viewsPerTableResult.isErr()) return viewsPerTableResult;

    return ensureTableDataSafetyViewConfigLimits(context.payload.view, limits);
  }

  return ensureTableDataSafetyViewConfigLimits(context.payload.patch, limits);
};

export const ensureTableDataSafetyViewConfigLimits = (
  view: ViewOperationPayloadViewConfig,
  limits: ResolvedTableDataSafetyLimitConfig
): Result<void, DomainError> => {
  if (view.name != null) {
    const nameResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.nameMaxLength,
      view.name.length,
      limits.displayText.maxNameLength,
      { target: 'view.name' }
    );
    if (nameResult.isErr()) return nameResult;
  }

  if (view.description != null) {
    const descriptionResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.descriptionMaxLength,
      view.description.length,
      limits.displayText.maxDescriptionLength,
      { target: 'view.description' }
    );
    if (descriptionResult.isErr()) return descriptionResult;
  }

  if (view.filter !== undefined) {
    const { itemCount, depth } = measureFilter(view.filter);
    const filterItemsResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewFilterItemsMax,
      itemCount,
      limits.viewConfig.maxFilterItems,
      { target: 'view.filter' }
    );
    if (filterItemsResult.isErr()) return filterItemsResult;

    const filterDepthResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewFilterDepthMax,
      depth,
      limits.viewConfig.maxFilterDepth,
      { target: 'view.filter' }
    );
    if (filterDepthResult.isErr()) return filterDepthResult;
  }

  if (view.sort !== undefined) {
    const sortResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewSortItemsMax,
      sortItemCount(view.sort),
      limits.viewConfig.maxSortItems,
      { target: 'view.sort' }
    );
    if (sortResult.isErr()) return sortResult;
  }

  if (view.group !== undefined) {
    const groupResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewGroupItemsMax,
      groupItemCount(view.group),
      limits.viewConfig.maxGroupItems,
      { target: 'view.group' }
    );
    if (groupResult.isErr()) return groupResult;
  }

  if (view.options !== undefined) {
    const optionsResult = ensureWithinTableDataSafetyLimit(
      tableDataSafetyLimitErrors.viewOptionsMaxBytes,
      measureJsonBytes(view.options),
      limits.viewConfig.maxOptionsBytes,
      { target: 'view.options' }
    );
    if (optionsResult.isErr()) return optionsResult;
  }

  return ok(undefined);
};

export class TableDataSafetyLimitViewOperationPlugin
  implements IViewOperationPlugin<PreparedTableDataSafetyViewLimitState>
{
  readonly name = 'table-data-safety-view-operation-limit';
  readonly enforce = 'post' as const;

  constructor(
    private readonly limitComposer: TableDataSafetyLimitComposer = createDefaultTableDataSafetyLimitComposer()
  ) {}

  supports(_operation: ViewOperationKind): boolean {
    return true;
  }

  async prepare(
    context: ViewOperationPluginContext
  ): Promise<Result<PreparedTableDataSafetyViewLimitState, DomainError>> {
    const configResult = await this.limitComposer.compose(context.executionContext);
    if (configResult.isErr()) return err(configResult.error);
    return ok({ limits: resolveTableDataSafetyLimits(configResult.value) });
  }

  guard(
    context: ViewOperationPluginContext,
    preparedState: PreparedTableDataSafetyViewLimitState | undefined
  ): Result<void, DomainError> {
    return ensureTableDataSafetyViewOperationLimits(
      context,
      preparedState?.limits ?? resolveTableDataSafetyLimits()
    );
  }
}
