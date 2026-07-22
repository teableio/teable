/* eslint-disable @typescript-eslint/no-explicit-any */
import { S3Client } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IStorageConfig } from '../../../configs/storage';
import { S3Storage } from './s3';

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    S3Client: vi.fn(function s3Client(this: unknown) {
      return this;
    }),
  };
});

type StorageConfigOverrides = Partial<Omit<IStorageConfig, 's3'>> & {
  s3?: Partial<IStorageConfig['s3']>;
};

const createConfig = (overrides: StorageConfigOverrides = {}): IStorageConfig => {
  const { s3: s3Overrides, ...configOverrides } = overrides;
  return {
    provider: 's3',
    publicBucket: 'public',
    privateBucket: 'private',
    s3: {
      region: 'us-east-1',
      endpoint: 'https://s3.us-east-1.amazonaws.com',
      accessKey: 'access-key',
      secretKey: 'secret-key',
      maxSockets: 100,
      forcePathStyle: false,
      ...s3Overrides,
    },
    uploadMethod: 'put',
    tokenExpireIn: '6d',
    urlExpireIn: '6d',
    ...configOverrides,
  } as IStorageConfig;
};

describe('S3Storage IAM role credentials', () => {
  beforeEach(() => {
    vi.mocked(S3Client).mockClear();
  });

  it('uses configured static credentials by default', () => {
    new S3Storage(createConfig());

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        },
      })
    );
  });

  it('omits credentials when S3 IAM role support is enabled', () => {
    new S3Storage(
      createConfig({
        privateBucketEndpoint: 'https://private.example.com',
        s3: {
          useIAMRole: true,
          internalEndpoint: 'https://s3.internal.example.com',
          accessKey: undefined as any,
          secretKey: undefined as any,
        },
      })
    );

    for (const [clientConfig] of vi.mocked(S3Client).mock.calls) {
      expect(clientConfig).not.toHaveProperty('credentials');
    }
  });
});
