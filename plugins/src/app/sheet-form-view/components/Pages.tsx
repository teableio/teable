'use client';
import type { IUIConfig } from '@teable/sdk';
import { isIframe, usePluginBridge } from '@teable/sdk';
import { ThemeProvider } from '@teable/ui-lib';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEnv } from '../../../hooks/useEnv';
import { useInitializationZodI18n } from '../../../hooks/useInitializationZodI18n';

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
      <Container {...props} />
    </ThemeProvider>
  );
};

// The Univer-based sheet designer was removed together with the React 19 upgrade
// (Univer 0.3 cannot initialise under React 19); the view renders empty.
const Container = (props: IPageProps) => {
  const { baseId, pluginInstallId } = props;
  const [isIframeMode, setIsIframeMode] = useState(true);
  const pluginBridge = usePluginBridge();
  const { t } = useTranslation();
  const { shareId } = useEnv();

  useEffect(() => {
    setIsIframeMode(isIframe);
  }, []);

  if (!baseId && !shareId) {
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

  return <div className="size-full" id="portal" />;
};
