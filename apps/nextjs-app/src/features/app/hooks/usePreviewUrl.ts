import { getFullStorageUrl } from '@teable/openapi';
import { useCallback } from 'react';
import { useEnv } from './useEnv';

export const usePreviewUrl = () => {
  const { storagePrefix, storageProvider } = useEnv();

  return useCallback(
    (path: string) => {
      if (!storagePrefix) {
        console.error('storagePrefix is not set');
        return path;
      }
      if (path.startsWith(storagePrefix)) {
        return path;
      }

      return getFullStorageUrl(
        { prefix: storagePrefix, provider: storageProvider },
        'public',
        path
      );
    },
    [storagePrefix, storageProvider]
  );
};
