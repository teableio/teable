'use client';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/docs-ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';
import '@univerjs/sheets-formula/lib/index.css';
import '@univerjs/sheets-data-validation/lib/index.css';

import { useQuery } from '@tanstack/react-query';

import { ThemeProvider } from '@teable/next-themes';
import { getShareView } from '@teable/openapi';
import type { IUIConfig } from '@teable/sdk';
import {
  isIframe,
  usePluginBridge,
  FieldProvider,
  AnchorContext,
  AppProvider,
  SessionProvider,
  TableProvider,
  ViewProvider,
  TablePermissionProvider,
} from '@teable/sdk';
import { Toaster } from '@teable/ui-lib';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnv } from '../../../hooks/useEnv';
import { useInitializationZodI18n } from '../../../hooks/useInitializationZodI18n';
import { ExcelShareView } from './ExcelShareView';
import { ExcelView } from './ExcelView';

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

  useEffect(() => {
    setIsIframeMode(isIframe);
  }, []);

  if (!baseId) {
    return <div className="text-center text-muted-foreground">{t('notBaseId')}</div>;
  }

  if (!pluginInstallId) {
    return <div className="text-center text-muted-foreground">{t('notPluginInstallId')}</div>;
  }

  if (!pluginBridge && isIframeMode) {
    return (
      <div className="flex flex-col items-center justify-center">
        <p className="text-center text-muted-foreground">{t('initBridge')}</p>
      </div>
    );
  }

  return (
    <ThemeProvider attribute="class" forcedTheme={uiConfig?.theme}>
      <AppProvider
        lang={i18n.resolvedLanguage}
        locale={i18n.getDataByLanguage(i18n.resolvedLanguage || i18n.language)?.sdk}
      >
        <SessionProvider>
          <AnchorContext.Provider
            value={{
              baseId,
              tableId: finalTableId,
              viewId,
            }}
          >
            <TableProvider>
              <ViewProvider>
                <FieldProvider>
                  <Toaster />
                  <div className="size-full" id="portal">
                    {shareId ? (
                      <ExcelShareView shareId={shareId} />
                    ) : (
                      <TablePermissionProvider baseId={baseId}>
                        <ExcelView />
                      </TablePermissionProvider>
                    )}
                  </div>
                </FieldProvider>
              </ViewProvider>
            </TableProvider>
          </AnchorContext.Provider>
        </SessionProvider>
      </AppProvider>
    </ThemeProvider>
  );
};
