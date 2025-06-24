import { useCallback } from 'react';
import { useEnv } from './useEnv';

function pathJoin(...parts: string[]) {
  const separator = '/';
  const replace = new RegExp(separator + '+', 'g');
  return parts.join(separator).replace(replace, separator);
}

export const READ_PATH = '/api/attachments/read/public';

export const usePreviewUrl = () => {
  const { storagePrefix } = useEnv();
  return useCallback(
    (path: string, readPath = '') => {
      if (!storagePrefix) {
        console.error('storagePrefix is not set');
        return path;
      }
      if (path.startsWith(storagePrefix)) {
        return path;
      }
      return storagePrefix + pathJoin(readPath, path);
    },
    [storagePrefix]
  );
};
