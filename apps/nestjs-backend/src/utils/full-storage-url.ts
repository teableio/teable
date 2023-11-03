import { URL } from 'url';
import { baseConfig } from '../configs/base.config';

export const getFullStorageUrl = (url: string) => {
  const storagePrefix = baseConfig().storagePrefix;
  return new URL(url, storagePrefix).href;
};
