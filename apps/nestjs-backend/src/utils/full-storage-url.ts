import path from 'path';
import { baseConfig } from '../configs/base.config';

export const getFullStorageUrl = (url: string) => {
  const storagePrefix = baseConfig().storagePrefix;
  return path.join(storagePrefix, url);
};
