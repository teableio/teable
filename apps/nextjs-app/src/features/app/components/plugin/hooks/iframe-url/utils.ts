/* eslint-disable sonarjs/no-identical-functions */
import type {
  IContextMenuPluginParams,
  IDashboardPluginParams,
  IPluginParamsBase,
  IPanelPluginParams,
  IViewPluginParams,
} from '../../types';

const getBaseIframeUrl = (url: string, params: IPluginParamsBase & { positionType: string }) => {
  const { positionId, pluginId, pluginInstallId, positionType } = params;
  const urlObj = new URL(url);
  urlObj.searchParams.set('positionType', positionType);
  urlObj.searchParams.set('positionId', positionId);
  urlObj.searchParams.set('pluginId', pluginId);
  urlObj.searchParams.set('pluginInstallId', pluginInstallId);
  return urlObj.toString();
};

export const getViewIframeUrl = (url: string, params: IViewPluginParams) => {
  const urlObj = new URL(getBaseIframeUrl(url, params));
  if ('shareId' in params) {
    urlObj.searchParams.set('shareId', params.shareId);
  } else {
    urlObj.searchParams.set('baseId', params.baseId);
    urlObj.searchParams.set('tableId', params.tableId);
    urlObj.searchParams.set('viewId', params.viewId);
  }
  return urlObj.toString();
};

export const getDashboardIframeUrl = (url: string, params: IDashboardPluginParams) => {
  const { baseId } = params;
  const urlObj = new URL(getBaseIframeUrl(url, params));
  urlObj.searchParams.set('baseId', baseId);
  return urlObj.toString();
};

export const getContextMenuIframeUrl = (url: string, params: IContextMenuPluginParams) => {
  const { baseId, tableId } = params;
  const urlObj = new URL(getBaseIframeUrl(url, params));
  urlObj.searchParams.set('baseId', baseId);
  urlObj.searchParams.set('tableId', tableId);
  return urlObj.toString();
};

export const getPanelIframeUrl = (url: string, params: IPanelPluginParams) => {
  const { baseId, tableId } = params;
  const urlObj = new URL(getBaseIframeUrl(url, params));
  urlObj.searchParams.set('baseId', baseId);
  urlObj.searchParams.set('tableId', tableId);
  return urlObj.toString();
};
