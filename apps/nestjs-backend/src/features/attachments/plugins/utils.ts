import { getPublicFullStorageUrl as getPublicFullStorageUrlOpenApi } from '@teable/openapi';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import type { ThumbnailSize } from './types';

/**
 * public bucket storage url path
 */
export const getPublicFullStorageUrl = (path: string) => {
  const { storagePrefix } = baseConfig();
  const { provider, publicUrl, publicBucket } = storageConfig();

  return getPublicFullStorageUrlOpenApi(
    { publicUrl, prefix: storagePrefix, provider, publicBucket },
    path
  );
};

export const generateCropImagePath = (path: string, size: ThumbnailSize) => {
  return `${path}_${size}`;
};

/**
 * resolve storage url to full url
 */
export const resolveStorageUrl = (url: string) => {
  const { storagePrefix } = baseConfig();
  const { provider } = storageConfig();
  if (provider === 'local' && storagePrefix) {
    return new URL(url, storagePrefix).toString();
  }

  return url;
};
