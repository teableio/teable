/* eslint-disable @typescript-eslint/no-explicit-any */
import { readdirSync } from 'fs';
import { resolve } from 'path';
import { Readable } from 'stream';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import * as fse from 'fs-extra';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import StorageAdapter from './adapter';
import { MinioStorage } from './minio';
import { S3Storage } from './s3';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

let testPath = '';

const temporaryFilesFor = (path: string) =>
  readdirSync(StorageAdapter.TEMPORARY_DIR).filter((file) => file.includes(path));

const createS3Storage = (content: Buffer) => {
  const storage = Object.create(S3Storage.prototype) as S3Storage;
  const send = vi.fn(async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      throw Object.assign(new Error('not found'), { name: 'NotFound' });
    }
    if (command instanceof GetObjectCommand) {
      return { Body: Readable.from(content), ContentType: 'image/png' };
    }
    throw new Error('Unexpected S3 command');
  });
  (storage as any).s3ClientPrivateNetwork = { send };
  return storage;
};

const createMinioStorage = (content: Buffer) => {
  const storage = Object.create(MinioStorage.prototype) as MinioStorage;
  (storage as any).minioClientPrivateNetwork = {
    statObject: vi
      .fn()
      .mockRejectedValueOnce({ code: 'NotFound' })
      .mockResolvedValueOnce({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        metaData: { 'content-type': 'image/png' },
      }),
    getObject: vi.fn().mockResolvedValue(Readable.from(content)),
  };
  return storage;
};

beforeAll(() => {
  fse.ensureDirSync(StorageAdapter.TEMPORARY_DIR);
});

afterEach(() => {
  for (const file of temporaryFilesFor(testPath)) {
    fse.removeSync(resolve(StorageAdapter.TEMPORARY_DIR, file));
  }
  testPath = '';
  vi.restoreAllMocks();
});

describe.each([
  ['S3', createS3Storage],
  ['MinIO', createMinioStorage],
])('%s crop temporary files', (_name, createStorage) => {
  it('cleans up when image processing fails', async () => {
    testPath = `crop-processing-failure-${vi.getRealSystemTime()}`;
    const storage = createStorage(Buffer.from('invalid image'));
    const upload = vi.spyOn(storage, 'uploadFileWidthPath');

    await expect(storage.cropImage('bucket', testPath, 10, 10)).rejects.toThrow();

    expect(upload).not.toHaveBeenCalled();
    expect(temporaryFilesFor(testPath)).toEqual([]);
  });

  it('cleans up when remote upload fails', async () => {
    testPath = `crop-upload-failure-${vi.getRealSystemTime()}`;
    const storage = createStorage(png);
    vi.spyOn(storage, 'uploadFileWidthPath').mockRejectedValue(new Error('upload failed'));

    await expect(storage.cropImage('bucket', testPath, 10, 10)).rejects.toThrow('upload failed');

    expect(temporaryFilesFor(testPath)).toEqual([]);
  });
});
