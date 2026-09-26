import { ViewType } from '@teable/core';
import type { IShareViewMeta } from '@teable/core';

export const ROW_ORDER_FIELD_PREFIX = '__row';

/** v2 backfills a view row-order column under this name before renaming it to `__row_<viewId>`. */
export const PENDING_ROW_ORDER_FIELD_PREFIX = '__pending_row_order_';

export const defaultShareMetaMap: Record<ViewType, IShareViewMeta | undefined> = {
  [ViewType.Form]: {},
  [ViewType.Kanban]: {
    includeRecords: true,
  },
  [ViewType.Grid]: {
    includeRecords: true,
  },
  [ViewType.Calendar]: {
    includeRecords: true,
  },
  [ViewType.Gallery]: {
    includeRecords: true,
  },
  [ViewType.Plugin]: undefined,
};
