import type { IShareViewMeta } from '@teable/core';
import { PluginViewCore } from '@teable/core';

export class PluginViewDto extends PluginViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
