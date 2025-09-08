'use client';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula/lib/index.css';
import '@univerjs/sheets-data-validation/lib/index.css';

import { useQuery } from '@tanstack/react-query';
import { ANONYMOUS_USER_ID } from '@teable/core';

import { ThemeProvider } from '@teable/next-themes';
import { getShareView } from '@teable/openapi';
import type { IUIConfig } from '@teable/sdk';
import {
  isIframe,
  usePluginBridge,
  FieldProvider,
  AnchorContext,
  AppProvider,
  TableProvider,
  ViewProvider,
  TablePermissionProvider,
  SessionProvider,
  ShareViewProxy,
} from '@teable/sdk';

import { Toaster } from '@teable/ui-lib';
import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnv } from '../../../hooks/useEnv';
import { useInitializationZodI18n } from '../../../hooks/useInitializationZodI18n';
import { SheetShareView } from './SheetShareView';
import { SheetView } from './SheetView';

function addQueryParamsToWebSocketUrl(url: string, params: Record<string, string>) {
  const urlObj = new URL(url);

  Object.keys(params).forEach((key) => {
    urlObj.searchParams.set(key, params[key]);
  });

  return urlObj.toString();
}

function getWsPath() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${window.location.host}/socket`;
}

interface IPageProps {
  lang: string;
  baseId: string;
  dashboardId: string;
  pluginInstallId: string;
  theme: string;
}

export const Pages = (props: IPageProps) => {
  const pluginBridge = usePluginBridge();
  const [uiConfig, setUIConfig] = useState<IUIConfig | undefined>();
  useInitializationZodI18n();

  useEffect(() => {
    if (!pluginBridge) {
      return;
    }
    const uiConfigListener = (config: IUIConfig) => {
      setUIConfig(config);
    };
    pluginBridge.on('syncUIConfig', uiConfigListener);
    return () => {
      pluginBridge.removeListener('syncUIConfig', uiConfigListener);
    };
  }, [pluginBridge]);

  return (
    <ThemeProvider attribute="class" forcedTheme={uiConfig?.theme ?? props.theme}>
      <Container {...props} uiConfig={uiConfig} />
    </ThemeProvider>
  );
};

const Container = (props: IPageProps & { uiConfig?: IUIConfig }) => {
  const { baseId, pluginInstallId, uiConfig } = props;
  const [isIframeMode, setIsIframeMode] = useState(true);
  const pluginBridge = usePluginBridge();
  const { i18n, t } = useTranslation();
  const { tableId, positionId: viewId, shareId } = useEnv();

  const { data: shareView } = useQuery({
    queryKey: ['share_view', shareId],
    queryFn: () => getShareView(shareId!).then((res) => res.data),
    enabled: !!shareId,
  });

  const finalTableId = tableId || shareView?.tableId;

  const wsPath = useMemo(() => {
    if (typeof window === 'object' && shareId) {
      return addQueryParamsToWebSocketUrl(getWsPath(), { shareId });
    }
    return undefined;
  }, [shareId]);

  useEffect(() => {
    setIsIframeMode(isIframe);
  }, []);

  if (!baseId && !shareId) {
    return <div className="text-muted-foreground text-center">{t('notBaseId')}</div>;
  }

  if (!pluginInstallId) {
    return <div className="text-muted-foreground text-center">{t('notPluginInstallId')}</div>;
  }

  if (!pluginBridge && isIframeMode) {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="text-muted-foreground text-center">{t('initBridge')}</p>
      </div>
    );
  }

  return (
    <ThemeProvider attribute="class" forcedTheme={uiConfig?.theme}>
      <AppProvider
        wsPath={wsPath}
        lang={i18n.resolvedLanguage}
        locale={i18n.getDataByLanguage(i18n.resolvedLanguage || i18n.language)?.sdk}
      >
        <AnchorContext.Provider
          value={{
            baseId,
            tableId: finalTableId,
            viewId,
          }}
        >
          <>
            {shareId && shareView?.view && (
              <SessionProvider
                disabledApi={true}
                user={{
                  id: ANONYMOUS_USER_ID,
                  name: ANONYMOUS_USER_ID,
                  email: '',
                  notifyMeta: {},
                  hasPassword: false,
                  isAdmin: false,
                }}
              >
                <ViewProvider serverData={[shareView.view]}>
                  <ShareViewProxy serverData={[shareView.view]}>
                    <FieldProvider>
                      <Toaster />
                      <div className="size-full" id="portal">
                        <SheetShareView shareId={shareId} />
                      </div>
                    </FieldProvider>
                  </ShareViewProxy>
                </ViewProvider>
              </SessionProvider>
            )}

            {!shareId && (
              <TableProvider>
                <TablePermissionProvider baseId={baseId}>
                  <ViewProvider>
                    <FieldProvider>
                      <Toaster />
                      <div className="size-full" id="portal">
                        <SheetView />
                      </div>
                    </FieldProvider>
                  </ViewProvider>
                </TablePermissionProvider>
              </TableProvider>
            )}
          </>
        </AnchorContext.Provider>
      </AppProvider>
    </ThemeProvider>
  );
};
