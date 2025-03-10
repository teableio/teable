import { useTheme } from '@teable/next-themes';
import { PluginPosition } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef } from 'react';
import type { IPluginParams } from '../../types';
import {
  getContextMenuIframeUrl,
  getDashboardIframeUrl,
  getPanelIframeUrl,
  getViewIframeUrl,
} from './utils';

export const useIframeUrl = (params: IPluginParams) => {
  const { pluginUrl } = params;
  const { resolvedTheme } = useTheme();
  const defaultTheme = useRef(resolvedTheme);
  const {
    i18n: { resolvedLanguage },
  } = useTranslation(['common']);

  return useMemo(() => {
    if (!pluginUrl) {
      return;
    }
    const urlObj = new URL(pluginUrl);
    defaultTheme.current && urlObj.searchParams.set('theme', defaultTheme.current);
    resolvedLanguage && urlObj.searchParams.set('lang', resolvedLanguage);
    const urlStr = urlObj.toString();
    switch (params.positionType) {
      case PluginPosition.Dashboard:
        return getDashboardIframeUrl(urlStr, params);
      case PluginPosition.View:
        return getViewIframeUrl(urlStr, params);
      case PluginPosition.ContextMenu:
        return getContextMenuIframeUrl(urlStr, params);
      case PluginPosition.Panel:
        return getPanelIframeUrl(urlStr, params);
      default:
        throw new Error(`Invalid position type`);
    }
  }, [pluginUrl, resolvedLanguage, params]);
};
