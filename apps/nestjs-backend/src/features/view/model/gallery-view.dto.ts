import type { IShareViewMeta } from '@teable/core';
import { GalleryViewCore } from '@teable/core';

export class GalleryViewDto extends GalleryViewCore {
  defaultShareMeta: IShareViewMeta = {
    includeRecords: true,
  };
}
