import { useRouter } from 'next/router';
import { useCallback } from 'react';

export const useIsExpandPlugin = () => {
  const router = useRouter();
  const expandPluginId = router.query.expandPluginId as string | undefined;
  return useCallback(
    (pluginInstallId: string) => expandPluginId === pluginInstallId,
    [expandPluginId]
  );
};
