import { getFullStorageUrl as getFullStorageUrlOpenApi } from '@teable/openapi';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import type { ThumbnailSize } from './types';

export const getFullStorageUrl = (bucket: string, path: string) => {
  const { storagePrefix } = baseConfig();
  const { provider } = storageConfig();

  return getFullStorageUrlOpenApi({ prefix: storagePrefix, provider }, bucket, path);
};

export const generateCropImagePath = (path: string, size: ThumbnailSize) => {
  return `${path}_${size}`;
};
