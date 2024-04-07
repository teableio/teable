import { useCallback } from 'react';
import { useEnv } from './useEnv';

export const usePreviewUrl = () => {
  const { storagePrefix } = useEnv();

  return useCallback(
    (urlOrPath: string) => {
      const url = new URL(urlOrPath, storagePrefix);
      return url.href;
    },
    [storagePrefix]
  );
};
