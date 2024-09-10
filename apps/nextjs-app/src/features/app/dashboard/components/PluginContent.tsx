import { useBaseId } from '@teable/sdk/hooks';
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
}) => {
  const { className, pluginInstallId, pluginUrl } = props;
  const baseId = useBaseId()!;
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string;
  const { t } = useTranslation(dashboardConfig.i18nNamespaces);
  const [bridge, setBridge] = useState<IChildBridgeMethods>();
  const iframeUrl = useMemo(() => {
    if (!pluginUrl) {
      return;
    }
    const url = new URL(pluginUrl);
    url.searchParams.set('pluginInstallId', pluginInstallId);
    url.searchParams.set('baseId', baseId);
    return url.toString();
  }, [pluginInstallId, pluginUrl, baseId]);

  useEffect(() => {
    bridge?.syncUIConfig({
      isShowingSettings: expandPluginId === pluginInstallId,
      isExpand: expandPluginId === pluginInstallId,
    });
  }, [bridge, expandPluginId, pluginInstallId]);

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
      <PluginRender onBridge={setBridge} src={iframeUrl} />
    </div>
  );
};
