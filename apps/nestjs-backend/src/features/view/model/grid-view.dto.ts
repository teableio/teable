import type { IShareViewMeta } from '@teable/core';
import { GridViewCore } from '@teable/core';

export class GridViewDto extends GridViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
