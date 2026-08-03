import { getPublicFullStorageUrl } from '@teable/openapi';
import { useCallback } from 'react';
import { useEnv } from './useEnv';

export const usePreviewUrl = () => {
  const { storage = {} } = useEnv();

  return useCallback(
    (path: string) => {
      const { publicUrl, prefix = '', provider, publicBucket } = storage;

      if (path.startsWith(prefix)) {
        return path;
      }

      return getPublicFullStorageUrl({ publicUrl, prefix, provider, publicBucket }, path);
    },
    [storage]
  );
};
