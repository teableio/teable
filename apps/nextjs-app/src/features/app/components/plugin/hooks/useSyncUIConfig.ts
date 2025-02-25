import { useTheme } from '@teable/next-themes';
import { useBasePermission } from '@teable/sdk/hooks';
import type { IChildBridgeMethods, IUIConfig } from '@teable/sdk/plugin-bridge';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import type { IPluginParams } from '../types';

export const useSyncUIConfig = (
  bridge: IChildBridgeMethods | undefined,
  pluginParams: IPluginParams
) => {
  const basePermissions = useBasePermission();
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string;
  const canSetting = basePermissions?.['base|update'];
  const pluginInstallId =
    'pluginInstallId' in pluginParams ? pluginParams.pluginInstallId : undefined;

  useEffect(() => {
    const uiConfig: IUIConfig = {
      theme: resolvedTheme,
    };
    if (pluginInstallId) {
      uiConfig.isShowingSettings = expandPluginId === pluginInstallId && canSetting;
      uiConfig.isExpand = expandPluginId === pluginInstallId;
    }
    bridge?.syncUIConfig(uiConfig);
  }, [bridge, expandPluginId, pluginInstallId, resolvedTheme, canSetting]);
};
