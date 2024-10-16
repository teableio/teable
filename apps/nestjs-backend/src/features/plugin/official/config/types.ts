import type { PluginPosition } from '@teable/openapi';

export type IOfficialPluginConfig = {
  id: string;
  name: string;
  description?: string;
  detailDesc?: string;
  helpUrl: string;
  positions: PluginPosition[];
  i18n?: {
    zh: {
      name: string;
      helpUrl: string;
      description: string;
      detailDesc: string;
    };
  };
  logoPath: string;
  pluginUserId?: string;
  avatarPath?: string;
};
