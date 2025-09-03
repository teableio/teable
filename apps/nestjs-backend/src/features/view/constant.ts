import { ViewType } from '@teable/core';
import type { IShareViewMeta } from '@teable/core';

export const ROW_ORDER_FIELD_PREFIX = '__row';

export const defaultShareMetaMap: Record<ViewType, IShareViewMeta | undefined> = {
  [ViewType.Form]: {
    submit: {
      allow: true,
    },
  },
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
