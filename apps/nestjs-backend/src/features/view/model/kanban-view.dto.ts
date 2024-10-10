import type { IShareViewMeta } from '@teable/core';
import { KanbanViewCore } from '@teable/core';

export class KanbanViewDto extends KanbanViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
