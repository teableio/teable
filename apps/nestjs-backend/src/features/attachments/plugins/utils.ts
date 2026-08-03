/* eslint-disable @typescript-eslint/naming-convention */
import { getPublicFullStorageUrl as getPublicFullStorageUrlOpenApi } from '@teable/openapi';
import { baseConfig } from '../../../configs/base.config';
import { storageConfig } from '../../../configs/storage';
import type { ThumbnailSize } from './types';

const OCTET_STREAM = 'application/octet-stream';
const JSON_PREFIX = 'application/json';

/**
 * Check if a content type would be intercepted by Express body parser (e.g. application/json).
 * When uploading internally via localhost, these types cause the stream to be consumed
 * before reaching the upload handler, so we need to fall back to application/octet-stream.
 * This only applies to local storage where the upload goes through the same Express server.
 */
export const getSafeUploadContentType = (contentType: string): string => {
  const { provider } = storageConfig();
  if (provider === 'local' && contentType && contentType.startsWith(JSON_PREFIX)) {
    return OCTET_STREAM;
  }
  return contentType;
};

/**
 * Check if a mimetype mismatch is caused by the body parser fallback.
 * Returns true if the request used octet-stream as a substitute for a JSON content type.
 */
export const isBodyParserFallback = (mimetype: string, expectedType: string): boolean => {
  const { provider } = storageConfig();
  if (provider === 'local' && mimetype === OCTET_STREAM && expectedType.startsWith(JSON_PREFIX)) {
    return true;
  }
  return false;
};

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
