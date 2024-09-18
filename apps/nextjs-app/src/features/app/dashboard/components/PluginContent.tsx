import { useTheme } from '@teable/next-themes';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dashboardConfig } from '@/features/i18n/dashboard.config';
import { useIframeSize } from '../hooks/useIframeSize';
import { PluginRender } from './PluginRender';

export const PluginContent = (props: {
  className?: string;
  pluginId: string;
  pluginInstallId: string;
  pluginUrl?: string;
  dashboardId: string;
  dragging?: boolean;
}) => {
  const { className, pluginInstallId, pluginUrl, dashboardId, pluginId, dragging } = props;
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
  const defaultTheme = useRef(resolvedTheme);
  const iframeUrl = useMemo(() => {
    if (!pluginUrl) {
      return;
    }
    const url = new URL(pluginUrl);
    url.searchParams.set('pluginInstallId', pluginInstallId);
    url.searchParams.set('baseId', baseId);
    url.searchParams.set('dashboardId', dashboardId);
    url.searchParams.set('pluginId', pluginId);
    defaultTheme.current && url.searchParams.set('theme', defaultTheme.current);
    resolvedLanguage && url.searchParams.set('lang', resolvedLanguage);
    return url.toString();
  }, [pluginUrl, pluginInstallId, baseId, dashboardId, pluginId, resolvedLanguage]);

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

  const [ref, { width, height }] = useIframeSize(dragging);

  if (!iframeUrl) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('dashboard:pluginUrlEmpty')}
      </div>
    );
  }

  return (
    <div ref={ref} className={cn('relative size-full overflow-hidden', className)}>
      {!bridge && (
        <div className="flex size-full items-center justify-center">
          <Spin />
        </div>
      )}
      <PluginRender
        width={width}
        height={height}
        onBridge={setBridge}
        src={iframeUrl}
        {...{
          pluginInstallId,
          dashboardId,
          baseId,
          pluginId,
        }}
      />
    </div>
  );
};
