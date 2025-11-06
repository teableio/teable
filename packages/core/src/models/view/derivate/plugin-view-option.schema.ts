import { z } from '../../../zod';

export const pluginViewOptionSchema = z
  .object({
    pluginId: z.string().meta({ description: 'The plugin id' }),
    pluginInstallId: z.string().meta({ description: 'The plugin install id' }),
    pluginLogo: z.string().meta({ description: 'The plugin logo' }),
  })
  .strict();

export type IPluginViewOptions = z.infer<typeof pluginViewOptionSchema>;
