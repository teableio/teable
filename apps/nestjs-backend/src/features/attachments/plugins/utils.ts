import { join } from 'path';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import { LocalStorage } from './local';

export const getFullStorageUrl = (bucket: string, path: string) => {
  const { storagePrefix } = baseConfig();
  const { provider } = storageConfig();
  if (provider === 'local') {
    return baseConfig().storagePrefix + join('/', LocalStorage.readPath, bucket, path);
  }
  return storagePrefix + join('/', bucket, path);
};

export const generateCutImagePath = (path: string, width: number, height: number) => {
  return `${path}_${width}_${height}`;
};
