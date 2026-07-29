/* eslint-disable @typescript-eslint/naming-convention */
import { createHash } from 'crypto';
import { getPublicFullStorageUrl as getPublicFullStorageUrlOpenApi } from '@teable/openapi';
import type { IAttachmentPreviewCache } from '../../../cache/types';
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

export const getPreviewCacheKey = (token: string) => `attachment:preview:${token}` as const;

let previewUrlConfigSigCache: { input: string; sig: string } | undefined;

/**
 * Fingerprint of every storage setting that shapes generated preview URLs.
 * Cached entries carry it, and readers treat a mismatch as a cache miss, so
 * any storage reconfiguration (endpoint, addressing style, credentials,
 * bucket layout...) self-invalidates cached URLs without manual flushes or
 * per-setting handling. The key itself stays stable per token, so rename
 * invalidation always deletes the one and only entry.
 */
export const getPreviewUrlConfigSig = () => {
  const { provider, publicUrl, publicBucket, privateBucket, privateBucketEndpoint, s3, minio } =
    storageConfig();
  // Secrets participate as digests so rotating only the secret key still
  // changes the fingerprint, without keeping raw key material in the memo.
  const digest = (value?: string) =>
    value ? createHash('sha1').update(value).digest('hex') : value;
  const input = JSON.stringify([
    provider,
    publicUrl,
    publicBucket,
    privateBucket,
    privateBucketEndpoint,
    s3.endpoint,
    s3.region,
    s3.accessKey,
    digest(s3.secretKey),
    s3.forcePathStyle,
    minio.endPoint,
    minio.port,
    minio.useSSL,
    minio.accessKey,
    digest(minio.secretKey),
  ]);
  if (previewUrlConfigSigCache?.input !== input) {
    previewUrlConfigSigCache = {
      input,
      sig: createHash('sha1').update(input).digest('hex').slice(0, 12),
    };
  }
  return previewUrlConfigSigCache.sig;
};

/**
 * Returns the cached preview URL only when it was generated under the current
 * storage configuration; entries written before the config change (or before
 * this field existed) are treated as misses.
 */
export const getFreshPreviewCacheUrl = (value?: IAttachmentPreviewCache) =>
  value && value.configSig === getPreviewUrlConfigSig() ? value.url : undefined;

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
