import { useTheme } from '@teable/next-themes';
import { useBaseId, useBasePermission } from '@teable/sdk/hooks';
import type { IChildBridgeMethods } from '@teable/sdk/plugin-bridge';
import { Spin } from '@teable/ui-lib/base';
import { cn } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIframeSize } from './hooks/useIframeSize';
import { PluginRender } from './PluginRender';

export const PluginContent = (props: {
  className?: string;
  renderClassName?: string;
  pluginId: string;
  pluginInstallId: string;
  pluginUrl?: string;
  positionId: string;
  tableId?: string;
  shareId?: string;
  dragging?: boolean;
  onExpand?: () => void;
}) => {
  const {
    className,
    renderClassName,
    pluginInstallId,
    pluginUrl,
    positionId,
    tableId,
    pluginId,
    shareId,
    dragging,
    onExpand,
  } = props;
  const baseId = useBaseId()!;
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string;
  const {
    t,
    i18n: { resolvedLanguage },
  } = useTranslation(['common']);
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
    url.searchParams.set('positionId', positionId);
    url.searchParams.set('pluginId', pluginId);

    tableId && url.searchParams.set('tableId', tableId);
    shareId && url.searchParams.set('shareId', shareId);
    defaultTheme.current && url.searchParams.set('theme', defaultTheme.current);
    resolvedLanguage && url.searchParams.set('lang', resolvedLanguage);
    return url.toString();
  }, [
    pluginUrl,
    pluginInstallId,
    baseId,
    positionId,
    pluginId,
    resolvedLanguage,
    shareId,
    tableId,
  ]);

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
      <div
        ref={ref}
        className="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        {t('common:pluginCenter.pluginUrlEmpty')}
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
        onExpand={onExpand}
        src={iframeUrl}
        className={renderClassName}
        {...{
          pluginInstallId,
          positionId,
          baseId,
          pluginId,
        }}
      />
    </div>
  );
};
