import type { IPluginColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';
import type { IPluginViewOptions } from './plugin-view-option.schema';

export class PluginViewCore extends ViewCore {
  type!: ViewType.Plugin;

  options!: IPluginViewOptions;

  columnMeta!: IPluginColumnMeta;
}
