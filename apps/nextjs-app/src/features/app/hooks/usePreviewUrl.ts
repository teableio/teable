import { getPublicFullStorageUrl } from '@teable/openapi';
import { useCallback } from 'react';
import { useEnv } from './useEnv';

export const usePreviewUrl = () => {
  const { storage = {} } = useEnv();

  return useCallback(
    (path: string) => {
      const { publicUrl, prefix = '', provider, publicBucket } = storage;

      // Server responses may already carry full urls (e.g. share view options
      // converted by the backend); prepending again would corrupt them.
      if (path.startsWith(prefix) || /^https?:\/\//i.test(path)) {
        return path;
      }

      return getPublicFullStorageUrl({ publicUrl, prefix, provider, publicBucket }, path);
    },
    [storage]
  );
};
