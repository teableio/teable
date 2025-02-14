import type { IDashboardPluginParams, IFloatPluginParams, IViewPluginParams } from '../../types';

export const getViewIframeUrl = (url: string, params: IViewPluginParams) => {
  const { positionId, pluginId, pluginInstallId, positionType } = params;
  const urlObj = new URL(url);
  urlObj.searchParams.set('positionType', positionType);
  urlObj.searchParams.set('positionId', positionId);
  urlObj.searchParams.set('pluginId', pluginId);
  urlObj.searchParams.set('pluginInstallId', pluginInstallId);
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
  const { baseId, positionId, pluginId, pluginInstallId, positionType } = params;
  const urlObj = new URL(url);
  urlObj.searchParams.set('positionType', positionType);
  urlObj.searchParams.set('baseId', baseId);
  urlObj.searchParams.set('positionId', positionId);
  urlObj.searchParams.set('pluginId', pluginId);
  urlObj.searchParams.set('pluginInstallId', pluginInstallId);
  return urlObj.toString();
};

export const getFloatIframeUrl = (url: string, params: IFloatPluginParams) => {
  const { baseId, positionId, pluginId, positionType } = params;
  const urlObj = new URL(url);
  urlObj.searchParams.set('positionType', positionType);
  urlObj.searchParams.set('baseId', baseId);
  urlObj.searchParams.set('positionId', positionId);
  urlObj.searchParams.set('pluginId', pluginId);
  return urlObj.toString();
};
