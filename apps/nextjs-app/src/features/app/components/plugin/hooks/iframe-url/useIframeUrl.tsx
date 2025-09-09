import { useTheme } from '@teable/next-themes';
import { PluginPosition } from '@teable/openapi';
import { useTranslation } from 'next-i18next';
import { useMemo, useRef } from 'react';
import { useEnv } from '@/features/app/hooks/useEnv';
import { RenderType } from '../../types';
import type { IPluginParams } from '../../types';
import {
  getContextMenuIframeUrl,
  getDashboardIframeUrl,
  getPanelIframeUrl,
  getViewIframeUrl,
} from './utils';

const componentPluginIds = ['plgchart'];

export const useIframeUrl = (params: IPluginParams) => {
  const { pluginUrl } = params;
  const { resolvedTheme } = useTheme();
  const defaultTheme = useRef(resolvedTheme);
  const {
    i18n: { resolvedLanguage },
  } = useTranslation(['common']);
  const { publicOrigin } = useEnv();

  const iframeUrl = useMemo(() => {
    if (!pluginUrl) {
      return;
    }

    const urlObj = new URL(pluginUrl, publicOrigin);
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
  }, [pluginUrl, publicOrigin, resolvedLanguage, params]);

  const renderType = useMemo(() => {
    if (componentPluginIds.includes(params.pluginId)) {
      return RenderType.Component;
    }
    return RenderType.Iframe;
  }, [params.pluginId]);

  return {
    iframeUrl,
    renderType,
  };
};
