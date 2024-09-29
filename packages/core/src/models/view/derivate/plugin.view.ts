import { z } from '../../../zod';
import type { IPluginColumnMeta } from '../column-meta.schema';
import type { ViewType } from '../constant';
import { ViewCore } from '../view';

export const pluginViewOptionSchema = z
  .object({
    pluginId: z.string().openapi({ description: 'The plugin id' }),
    pluginInstallId: z.string().openapi({ description: 'The plugin install id' }),
    pluginLogo: z.string().openapi({ description: 'The plugin logo' }),
  })
  .strict();

export type IPluginViewOptions = z.infer<typeof pluginViewOptionSchema>;

export class PluginViewCore extends ViewCore {
  type!: ViewType.Plugin;

  options!: IPluginViewOptions;

  columnMeta!: IPluginColumnMeta;
}
