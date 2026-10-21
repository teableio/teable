/* eslint-disable @typescript-eslint/no-explicit-any */
import { vi } from 'vitest';
import StorageAdapter from './adapter';
import { MinioStorage } from './minio';

vi.mock('fs-extra');

const mockMinioConfig = (): any => ({
  provider: 'minio',
  publicBucket: 'public-bucket',
  privateBucket: 'private-bucket',
  uploadMethod: 'put',
  tokenExpireIn: '6d',
  urlExpireIn: '6d',
  minio: {
    endPoint: 'minio.example.com',
    port: 9000,
    useSSL: true,
    accessKey: 'mock-access-key',
    secretKey: 'mock-secret-key',
    region: 'us-east-1',
  },
});

describe('MinioStorage cache-control', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns Cache-Control in presigned PUT requestHeaders when policy is set', async () => {
    const storage = new MinioStorage(mockMinioConfig());
    const { requestHeaders } = await storage.presigned('public-bucket', 'template', {
      contentType: 'image/png',
      contentLength: 10,
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(requestHeaders['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  it('omits Cache-Control from requestHeaders when no policy applies', async () => {
    const storage = new MinioStorage(mockMinioConfig());
    const { requestHeaders } = await storage.presigned('private-bucket', 'table', {
      contentType: 'image/png',
      contentLength: 10,
    });
    expect(requestHeaders).not.toHaveProperty('Cache-Control');
  });

  it('adds private cache-control to private-bucket preview urls', async () => {
    const storage = new MinioStorage(mockMinioConfig());
    const url = await storage.getPreviewUrl('private-bucket', 'table/attachment', 60);
    expect(new URL(url).searchParams.get('response-cache-control')).toBe(
      StorageAdapter.PRIVATE_PREVIEW_CACHE_CONTROL
    );
  });

  it('leaves public-bucket preview urls without response-cache-control', async () => {
    vi.stubEnv('BACKEND_STORAGE_PUBLIC_BUCKET', 'public-bucket');
    const storage = new MinioStorage(mockMinioConfig());
    const url = await storage.getPreviewUrl('public-bucket', 'template/cover', 60);
    expect(new URL(url).searchParams.get('response-cache-control')).toBeNull();
  });
});
