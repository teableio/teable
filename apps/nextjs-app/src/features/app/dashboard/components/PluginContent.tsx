import { useTheme } from '@teable/next-themes';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { PluginRender } from './PluginRender';

export const PluginContent = (props: {
  className?: string;
  pluginId: string;
  pluginInstallId: string;
  pluginUrl?: string;
  dashboardId: string;
}) => {
  const { className, pluginInstallId, pluginUrl, dashboardId } = props;
  const baseId = useBaseId()!;
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string;
  const {
    t,
    i18n: { resolvedLanguage },
  } = useTranslation(dashboardConfig.i18nNamespaces);
  const { resolvedTheme } = useTheme();
  const [bridge, setBridge] = useState<IChildBridgeMethods>();
  const basePermissions = useBasePermission();
  const iframeUrl = useMemo(() => {
    if (!pluginUrl) {
      return;
    }
    const url = new URL(pluginUrl);
    url.searchParams.set('pluginInstallId', pluginInstallId);
    url.searchParams.set('baseId', baseId);
    url.searchParams.set('dashboardId', dashboardId);
    resolvedLanguage && url.searchParams.set('lang', resolvedLanguage);
    return url.toString();
  }, [pluginUrl, pluginInstallId, baseId, dashboardId, resolvedLanguage]);

  const canSetting = basePermissions?.['base|update'];
  useEffect(() => {
    bridge?.syncUIConfig({
      isShowingSettings: expandPluginId === pluginInstallId && canSetting,
      isExpand: expandPluginId === pluginInstallId,
      theme: resolvedTheme,
    });
  }, [bridge, expandPluginId, pluginInstallId, resolvedTheme, canSetting]);

  useEffect(() => {
    if (!basePermissions) {
      return;
    }
    bridge?.syncBasePermissions(basePermissions);
  }, [basePermissions, bridge]);

  if (!iframeUrl) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('dashboard:pluginUrlEmpty')}
      </div>
    );
  }

  return (
    <div className={cn('relative size-full', className)}>
      {!bridge && (
        <div className="flex size-full items-center justify-center">
          <Spin />
        </div>
      )}
      <PluginRender
        onBridge={setBridge}
        src={iframeUrl}
        {...{
          pluginInstallId,
          dashboardId,
          baseId,
        }}
      />
    </div>
  );
};
