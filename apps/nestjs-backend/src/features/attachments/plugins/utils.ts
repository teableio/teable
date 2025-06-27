import { getPublicFullStorageUrl as getPublicFullStorageUrlOpenApi } from '@teable/openapi';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import type { ThumbnailSize } from './types';

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
