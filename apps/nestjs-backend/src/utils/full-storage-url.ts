import path from 'path';
import { replaceSuffix } from '@teable/core';
import { baseConfig } from '../configs/base.config';

export const getFullStorageUrl = (url: string) => {
  const storagePrefix = baseConfig().storagePrefix;
  return path.join(storagePrefix, url);
};

export const replaceStorageUrl = (originalUrl: string) => {
  const storagePrefix = baseConfig().storagePrefix;
  return replaceSuffix(originalUrl, storagePrefix);
};
