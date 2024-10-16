import type { PluginPosition } from '@teable/openapi';

export interface IPageParams {
  lang: string;
  baseId: string;
  pluginInstallId: string;
  positionId: string;
  positionType: PluginPosition;
  pluginId: string;
  theme: string;
  tableId?: string;
  shareId?: string;
}
