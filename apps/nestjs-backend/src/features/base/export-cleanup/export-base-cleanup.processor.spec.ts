import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { UploadType } from '@teable/openapi';
import type { Queue } from 'bullmq';
import type { ClsService } from 'nestjs-cls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../../cache/cache.service';
import type { IBaseConfig } from '../../../configs/base.config';
import type { IStorageConfig } from '../../../configs/storage';
import type { IClsStore } from '../../../types/cls';
import StorageAdapter from '../../attachments/plugins/adapter';
import { LocalStorage } from '../../attachments/plugins/local';
import type { IListedObject } from '../../attachments/plugins/types';
import { ExportBaseCleanupProcessor } from './export-base-cleanup.processor';
import { exportBaseObjectPath, parseExportLinkExpiresIn } from './export-base-path';

const NOW = new Date('2026-10-23T00:00:00.000Z');
const DAY_S = 24 * 60 * 60;
const BUCKET = StorageAdapter.getBucket(UploadType.ExportBase);
const daysAgo = (days: number, now = NOW) => new Date(now.getTime() - days * DAY_S * 1000);
const tea = (name: string, linkDays: number) => exportBaseObjectPath(name, 'tea', linkDays * DAY_S);

const setup = (
  objects: IListedObject[],
  {
    tokenExpireIn = '6d',
    queue = { upsertJobScheduler: vi.fn() },
  }: { tokenExpireIn?: string; queue?: Partial<Queue> } = {}
) => {
  const listObjects = vi.fn(async () => ({ objects, prefixes: [] }));
  const deleteFile = vi.fn(async () => undefined);
  const storageAdapter = { listObjects, deleteFile } as unknown as StorageAdapter;
  const storageConfig = { tokenExpireIn } as IStorageConfig;
  return {
    processor: new ExportBaseCleanupProcessor(storageAdapter, storageConfig, queue as Queue),
    listObjects,
    deleteFile,
  };
};

describe('exportBaseObjectPath', () => {
  it('records the link lifetime in the key', () => {
    expect(tea('abc', 6)).toBe('export-base/abc-ttl518400.tea');
    expect(parseExportLinkExpiresIn(tea('abc', 6))).toBe(6 * DAY_S);
    expect(parseExportLinkExpiresIn('export-base/archive/x-ttl3600.csv')).toBe(3600);
    expect(parseExportLinkExpiresIn('export-base/abc.tea')).toBeUndefined();
  });
});

describe('ExportBaseCleanupProcessor', () => {
  it('deletes exports whose own link has expired and keeps the rest', async () => {
    const { processor, listObjects, deleteFile } = setup([
      { key: tea('expired', 6), size: 1, lastModified: daysAgo(30) },
      {
        key: exportBaseObjectPath('archive/expired', 'csv', 6 * DAY_S),
        size: 1,
        lastModified: daysAgo(8),
      },
      { key: tea('link-still-valid', 6), size: 1, lastModified: daysAgo(5) },
      // past the 6d link but inside the margin for a long multipart upload
      { key: tea('in-margin', 6), size: 1, lastModified: daysAgo(6.5) },
      { key: tea('undated', 6), size: 1 },
    ]);

    const result = await processor.cleanupExpired(NOW);

    expect(listObjects).toHaveBeenCalledWith(BUCKET, 'export-base/');
    expect(deleteFile.mock.calls).toEqual([
      [BUCKET, tea('expired', 6)],
      [BUCKET, 'export-base/archive/expired-ttl518400.csv'],
    ]);
    expect(result).toEqual({ deleted: 2, failed: 0 });
  });

  it('honours the lifetime an export was signed with after the setting is shortened', async () => {
    const { processor, deleteFile } = setup(
      [
        // signed for 6 days two days ago: still downloadable for four more
        { key: tea('signed-6d', 6), size: 1, lastModified: daysAgo(2) },
        { key: tea('signed-1h', 1 / 24), size: 1, lastModified: daysAgo(2) },
      ],
      { tokenExpireIn: '1h' }
    );

    await processor.cleanupExpired(NOW);

    expect(deleteFile.mock.calls).toEqual([[BUCKET, tea('signed-1h', 1 / 24)]]);
  });

  it('keeps keys without a recorded lifetime for at least the longest presigned link', async () => {
    const { processor, deleteFile } = setup(
      [
        { key: 'export-base/legacy-recent.tea', size: 1, lastModified: daysAgo(7.5) },
        { key: 'export-base/legacy-old.tea', size: 1, lastModified: daysAgo(9) },
      ],
      { tokenExpireIn: '1h' }
    );

    await processor.cleanupExpired(NOW);

    expect(deleteFile.mock.calls).toEqual([[BUCKET, 'export-base/legacy-old.tea']]);
  });

  it('keeps sweeping when one delete fails', async () => {
    const { processor, deleteFile } = setup([
      { key: tea('a', 6), size: 1, lastModified: daysAgo(10) },
      { key: tea('b', 6), size: 1, lastModified: daysAgo(10) },
    ]);
    deleteFile.mockRejectedValueOnce(new Error('boom'));

    const result = await processor.cleanupExpired(NOW);

    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ deleted: 1, failed: 1 });
  });

  it('registers an hourly scheduler on a redis queue', async () => {
    const upsertJobScheduler = vi.fn();
    const { processor } = setup([], { queue: { upsertJobScheduler } });
    await processor.onModuleInit();
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'export-base:cleanup',
      { every: 60 * 60 * 1000 },
      { name: 'export-base:cleanup' }
    );
  });

  it('sweeps on its own timer without redis', async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      const { processor, listObjects } = setup([], { queue: {} });
      await processor.onModuleInit();
      expect(listObjects).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(listObjects).toHaveBeenCalledTimes(1);
      processor.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(listObjects).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ExportBaseCleanupProcessor on local storage', () => {
  let dir: string;
  let storage: LocalStorage;
  const storageConfig = {
    local: { path: '' },
    encryption: {
      entries: [{ algorithm: 'aes-128-cbc', key: '73b00476e456323e', iv: '8c9183e4c175f63c' }],
    },
    tokenExpireIn: '6d',
    urlExpireIn: '6d',
  } as unknown as IStorageConfig;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 't7086-export-'));
    storage = new LocalStorage(
      { ...storageConfig, local: { path: dir } } as IStorageConfig,
      { storagePrefix: 'http://localhost' } as IBaseConfig,
      {} as CacheService,
      { get: () => undefined } as unknown as ClsService<IClsStore>
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const readAll = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString();
  };

  it('serves the export while its link is valid and removes it once expired', async () => {
    const path = tea('lifecycle', 6);
    await storage.uploadFileStream(BUCKET, path, Readable.from(['tea-bytes']));
    const uploadedAt = new Date();
    const processor = new ExportBaseCleanupProcessor(storage, storageConfig, {
      upsertJobScheduler: vi.fn(),
    } as unknown as Queue);

    // five days in: the link is still valid
    await processor.cleanupExpired(new Date(uploadedAt.getTime() + 5 * DAY_S * 1000));
    expect(await readAll((await storage.downloadFile(BUCKET, path)) as never)).toBe('tea-bytes');

    // backdate the file past its 6d link and the margin
    const old = daysAgo(8, uploadedAt);
    utimesSync(join(dir, BUCKET, path), old, old);
    expect(await processor.cleanupExpired(uploadedAt)).toEqual({ deleted: 1, failed: 0 });
    await expect(storage.downloadFile(BUCKET, path)).rejects.toThrow();
    expect((await storage.listObjects(BUCKET, 'export-base/')).objects).toEqual([]);
  });
});
