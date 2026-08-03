import type { IGalleryColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IViewVo } from '../view.schema';
import type { IGalleryViewOptions } from './gallery-view-option.schema';

export interface IGalleryView extends IViewVo {
  type: ViewType.Gallery;
  options: IGalleryViewOptions;
}

export class GalleryViewCore extends ViewCore {
  type!: ViewType.Gallery;

  options!: IGalleryViewOptions;

  columnMeta!: IGalleryColumnMeta;
}
