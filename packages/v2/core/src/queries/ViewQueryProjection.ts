import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import type { View } from '../domain/table/views/View';
import {
  getDefaultViewColumnOrderByFieldId,
  type ViewColumnMetaEntry,
  type ViewColumnMetaValue,
} from '../domain/table/views/ViewColumnMeta';
import type { ViewShareMetaValue } from '../domain/table/views/ViewProperties';
import type {
  ViewQueryGroupItem,
  ViewQuerySortItem,
} from '../domain/table/views/ViewQueryDefaults';

export type ViewQueryResultView = {
  id: string;
  version?: number;
  name: string;
  type: 'grid' | 'kanban' | 'gallery' | 'calendar' | 'form' | 'plugin';
  description?: string;
  order?: number;
  options?: unknown;
  filter?: unknown;
  sort?: {
    sortObjs: ReadonlyArray<ViewQuerySortItem>;
    manualSort?: boolean;
  };
  group?: ReadonlyArray<ViewQueryGroupItem>;
  isLocked?: boolean;
  shareId?: string;
  enableShare?: boolean;
  shareMeta?: ViewShareMetaValue;
  createdBy: string;
  lastModifiedBy?: string;
  createdTime: string;
  lastModifiedTime?: string;
  columnMeta: ViewColumnMetaValue;
};

const projectColumnMetaEntry = (
  viewType: ViewQueryResultView['type'],
  entry: ViewColumnMetaEntry,
  order: number
): ViewColumnMetaEntry => {
  const base = { order };

  if (viewType === 'grid') {
    return {
      ...base,
      ...(entry.width !== undefined ? { width: entry.width } : {}),
      ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
      ...(entry.statisticFunc !== undefined ? { statisticFunc: entry.statisticFunc } : {}),
    };
  }

  if (viewType === 'plugin') {
    return {
      ...base,
      ...(entry.hidden !== undefined ? { hidden: entry.hidden } : {}),
    };
  }

  if (viewType === 'form') {
    return {
      ...base,
      ...(entry.visible !== undefined ? { visible: entry.visible } : {}),
      ...(entry.required !== undefined ? { required: entry.required } : {}),
    };
  }

  return {
    ...base,
    ...(entry.visible !== undefined ? { visible: entry.visible } : {}),
  };
};

export type ProjectViewForQueryOptions = {
  /**
   * `complete` (default) drops columnMeta keys that are not on the Table.
   * `partial` keeps stored keys when the Table was loaded without every Field.
   */
  fieldSet?: 'complete' | 'partial';
};

export const projectViewForQuery = (
  table: Table,
  view: View,
  options: ProjectViewForQueryOptions = {}
): Result<ViewQueryResultView, DomainError> =>
  safeTry<ViewQueryResultView, DomainError>(function* () {
    const columnMeta = yield* view.columnMeta();
    const queryDefaults = yield* view.queryDefaults();
    const auditMetadata = yield* view.auditMetadata();
    const fields = table.getFields();
    const defaultOrderByFieldId = getDefaultViewColumnOrderByFieldId(
      fields,
      table.primaryFieldId()
    );
    const rawColumnMeta = columnMeta.toDto();
    const viewType = view.type().toString();
    const keepStoredColumnMeta = options.fieldSet === 'partial';
    const sanitizedColumnMeta = Object.fromEntries(
      Object.entries(rawColumnMeta)
        .filter(([fieldId]) => keepStoredColumnMeta || defaultOrderByFieldId.has(fieldId))
        .map(([fieldId, entry]) => {
          const order =
            typeof entry.order === 'number' && Number.isFinite(entry.order)
              ? entry.order
              : defaultOrderByFieldId.get(fieldId) ?? 0;
          return [fieldId, projectColumnMetaEntry(viewType, entry, order)];
        })
    );
    const sourceFilter = queryDefaults.sourceFilter();
    const sortObjs = queryDefaults.sort();
    const manualSort = queryDefaults.manualSort();
    const group = queryDefaults.group();
    const metadata = auditMetadata.toDto();
    const order = view.order();
    const version = view.version();

    return ok({
      id: view.id().toString(),
      ...(version.isOk() ? { version: version.value.toNumber() } : {}),
      name: view.name().toString(),
      type: viewType,
      ...(order.isOk() ? { order: order.value.toNumber() } : {}),
      ...(view.description() ? { description: view.description() } : {}),
      ...(view.options() !== undefined ? { options: view.options() } : {}),
      ...(sourceFilter != null ? { filter: sourceFilter } : {}),
      ...(sortObjs !== undefined || manualSort !== undefined
        ? {
            sort: {
              sortObjs: sortObjs ?? [],
              ...(manualSort !== undefined ? { manualSort } : {}),
            },
          }
        : {}),
      ...(group?.length ? { group } : {}),
      ...(view.isLocked() ? { isLocked: true } : {}),
      ...(view.shareId() ? { shareId: view.shareId() } : {}),
      ...(view.enableShare() ? { enableShare: true } : {}),
      ...(view.shareMeta() ? { shareMeta: view.shareMeta() } : {}),
      ...metadata,
      columnMeta: sanitizedColumnMeta,
    });
  });
