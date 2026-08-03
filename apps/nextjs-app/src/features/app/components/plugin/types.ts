import type { PluginPosition } from '@teable/openapi';

export interface IPluginParamsBase {
  pluginId: string;
  pluginUrl: string | undefined;
  positionId: string;
  pluginInstallId: string;
}

export interface IDashboardPluginParams extends IPluginParamsBase {
  baseId: string;
  positionType: PluginPosition.Dashboard;
}

export type IViewPluginParams = IPluginParamsBase & {
  positionType: PluginPosition.View;
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

export type IContextMenuPluginParams = IPluginParamsBase & {
  baseId: string;
  tableId: string;
  positionType: PluginPosition.ContextMenu;
};

export type IPanelPluginParams = IPluginParamsBase & {
  baseId: string;
  tableId: string;
  positionType: PluginPosition.Panel;
};

export type IPluginParams =
  | IDashboardPluginParams
  | IViewPluginParams
  | IContextMenuPluginParams
  | IPanelPluginParams;

export enum RenderType {
  Iframe = 'iframe',
  Component = 'component',
}
