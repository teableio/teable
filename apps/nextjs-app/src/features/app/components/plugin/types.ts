import type { PluginPosition } from '@teable/openapi';

export interface IPluginParamsBase {
  pluginId: string;
  pluginUrl: string | undefined;
  positionId: string;
}

export interface IDashboardPluginParams extends IPluginParamsBase {
  baseId: string;
  positionType: PluginPosition.Dashboard;
  pluginInstallId: string;
}

export type IViewPluginParams = IPluginParamsBase & {
  positionType: PluginPosition.View;
  pluginInstallId: string;
} & (
    | {
        shareId: string;
      }
    | {
        baseId: string;
        tableId: string;
        viewId: string;
      }
  );

export interface IFloatPluginParams extends IPluginParamsBase {
  positionType: PluginPosition.Float;
  baseId: string;
}

export type IPluginParams = IDashboardPluginParams | IViewPluginParams | IFloatPluginParams;
