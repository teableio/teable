/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { vi } from 'vitest';
import { AliyunStorage } from './aliyun';
import { S3Storage } from './s3';
import { getFreshPreviewCacheUrl, getPreviewCacheKey, getPreviewUrlConfigSig } from './utils';

vi.mock('fs-extra');

const mockS3Config = (forcePathStyle: boolean, internalForcePathStyle?: boolean): any => ({
  provider: 'aliyun',
  publicBucket: 'public-bucket',
  privateBucket: 'private-bucket',
  privateBucketEndpoint: undefined,
  uploadMethod: 'put',
  tokenExpireIn: '6d',
  urlExpireIn: '6d',
  s3: {
    region: 'oss-cn-shenzhen',
    endpoint: 'https://teable.example.com/oss',
    internalEndpoint: 'https://oss-cn-shenzhen-internal.aliyuncs.com',
    accessKey: 'mock-access-key',
    secretKey: 'mock-secret-key',
    maxSockets: 100,
    forcePathStyle,
    internalForcePathStyle,
  },
});

describe('S3Storage forcePathStyle', () => {
  it('keeps virtual-hosted style presigned PUT url when disabled', async () => {
    const storage = new S3Storage(mockS3Config(false));
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'hash a b',
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('private-bucket.teable.example.com');
    expect(parsed.pathname).toBe('/oss/table/attachment/hash%20a%20b');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('generates path style presigned PUT url when enabled', async () => {
    const storage = new S3Storage(mockS3Config(true));
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'hash a b',
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('teable.example.com');
    expect(parsed.pathname).toBe('/oss/private-bucket/table/attachment/hash%20a%20b');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('generates path style preview url when enabled', async () => {
    const storage = new S3Storage(mockS3Config(true));
    const url = await storage.getPreviewUrl('private-bucket', 'table/attachment/preview', 60);
    const parsed = new URL(url);
    expect(parsed.host).toBe('teable.example.com');
    expect(parsed.pathname).toBe('/oss/private-bucket/table/attachment/preview');
  });

  it('keeps internal presigned url on the internal endpoint without path style', async () => {
    const storage = new S3Storage(mockS3Config(true));
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'internal-hash',
      internal: true,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('private-bucket.oss-cn-shenzhen-internal.aliyuncs.com');
    expect(parsed.pathname).toBe('/table/attachment/internal-hash');
  });

  it('applies path style to the internal client only via its own flag', async () => {
    const storage = new S3Storage(mockS3Config(false, true));
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'internal-hash',
      internal: true,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('oss-cn-shenzhen-internal.aliyuncs.com');
    expect(parsed.pathname).toBe('/private-bucket/table/attachment/internal-hash');
  });

  it('inherits public path-style for the internal client when sharing the endpoint', async () => {
    const config = mockS3Config(true);
    config.s3.internalEndpoint = undefined;
    const storage = new S3Storage(config);
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'internal-hash',
      internal: true,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('teable.example.com');
    expect(parsed.pathname).toBe('/oss/private-bucket/table/attachment/internal-hash');
  });

  it('honors internal path-style on the shared endpoint when no internal endpoint is set', async () => {
    const config = mockS3Config(false, true);
    config.s3.internalEndpoint = undefined;
    const storage = new S3Storage(config);
    const { url } = await storage.presigned('private-bucket', 'table/attachment', {
      contentType: 'text/plain',
      contentLength: 10,
      hash: 'internal-hash',
      internal: true,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe('teable.example.com');
    expect(parsed.pathname).toBe('/oss/private-bucket/table/attachment/internal-hash');
  });

  it('rejects forcePathStyle combined with privateBucketEndpoint', () => {
    const config = mockS3Config(true);
    config.privateBucketEndpoint = 'https://private.example.com';
    expect(() => new S3Storage(config)).toThrowError(
      /FORCE_PATH_STYLE cannot be combined with BACKEND_STORAGE_PRIVATE_BUCKET_ENDPOINT/
    );
  });
});

describe('preview cache config fingerprint', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps a stable per-token key regardless of config', () => {
    vi.stubEnv('BACKEND_STORAGE_S3_FORCE_PATH_STYLE', 'true');
    expect(getPreviewCacheKey('tok123')).toBe('attachment:preview:tok123');
  });

  it('changes the fingerprint when url-shaping config changes', () => {
    vi.stubEnv('BACKEND_STORAGE_S3_FORCE_PATH_STYLE', 'false');
    const virtualHostedSig = getPreviewUrlConfigSig();
    expect(getPreviewUrlConfigSig()).toBe(virtualHostedSig);

    vi.stubEnv('BACKEND_STORAGE_S3_FORCE_PATH_STYLE', 'true');
    const pathStyleSig = getPreviewUrlConfigSig();
    expect(pathStyleSig).not.toBe(virtualHostedSig);

    vi.stubEnv('BACKEND_STORAGE_S3_ENDPOINT', 'https://other-endpoint.example.com');
    const endpointSig = getPreviewUrlConfigSig();
    expect(endpointSig).not.toBe(pathStyleSig);

    vi.stubEnv('BACKEND_STORAGE_S3_SECRET_KEY', 'rotated-secret-key');
    expect(getPreviewUrlConfigSig()).not.toBe(endpointSig);
  });

  it('treats entries from another config or without fingerprint as stale', () => {
    const sig = getPreviewUrlConfigSig();
    expect(getFreshPreviewCacheUrl({ url: 'https://a/b', expiresIn: 60, configSig: sig })).toBe(
      'https://a/b'
    );
    expect(
      getFreshPreviewCacheUrl({ url: 'https://a/b', expiresIn: 60, configSig: 'deadbeef0000' })
    ).toBeUndefined();
    expect(getFreshPreviewCacheUrl({ url: 'https://a/b', expiresIn: 60 })).toBeUndefined();
    expect(getFreshPreviewCacheUrl(undefined)).toBeUndefined();
  });
});

describe('AliyunStorage forcePathStyle', () => {
  it('keeps virtual-hosted style preview url when disabled', async () => {
    const storage = new AliyunStorage(mockS3Config(false));
    const url = await storage.getPreviewUrl('private-bucket', 'table/attachment/preview', 60);
    const parsed = new URL(url);
    expect(parsed.host).toBe('private-bucket.teable.example.com');
    expect(parsed.pathname).toBe('/oss/table/attachment/preview');
  });

  it('generates path style preview url when enabled', async () => {
    const storage = new AliyunStorage(mockS3Config(true));
    const url = await storage.getPreviewUrl('private-bucket', 'table/attachment/preview', 60);
    const parsed = new URL(url);
    expect(parsed.host).toBe('teable.example.com');
    expect(parsed.pathname).toBe('/oss/private-bucket/table/attachment/preview');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
