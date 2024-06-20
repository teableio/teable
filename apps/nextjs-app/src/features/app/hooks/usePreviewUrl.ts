import { useCallback } from 'react';
import { useEnv } from './useEnv';

function pathJoin(...parts: string[]) {
  const separator = '/';
  const replace = new RegExp(separator + '+', 'g');
  return parts.join(separator).replace(replace, separator);
}

export const usePreviewUrl = () => {
  const { storagePrefix } = useEnv();

  return useCallback(
    (path: string) => {
      if (!storagePrefix) {
        console.error('storagePrefix is not set');
        return path;
      }
      return pathJoin(storagePrefix, path);
    },
    [storagePrefix]
  );
};
