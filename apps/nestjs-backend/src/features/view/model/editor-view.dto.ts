import type { IShareViewMeta } from '@teable/core';
import { EditorViewCore } from '@teable/core';

export class EditorViewDto extends EditorViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
