/* eslint-disable @typescript-eslint/naming-convention */
import { HttpErrorCode } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import sharp from 'sharp';
import { vi } from 'vitest';
import type { CacheService } from '../../cache/cache.service';
import type { IStorageConfig } from '../../configs/storage';
import type { EventEmitterService } from '../../event-emitter/event-emitter.service';
import { AttachmentsStorageService } from './attachments-storage.service';
import { ATTACHMENT_LG_THUMBNAIL_HEIGHT, ATTACHMENT_SM_THUMBNAIL_HEIGHT } from './constant';
import type StorageAdapter from './plugins/adapter';

describe('AttachmentsStorageService.uploadTableImageThumbnailsFromBuffer', () => {
  const uploads: { path: string; buffer: Buffer }[] = [];
  const storageAdapter = {
    uploadFile: vi.fn(async (_bucket: string, path: string, buffer: Buffer) => {
      uploads.push({ path, buffer });
      return { path };
    }),
  } as unknown as StorageAdapter;
  const service = new AttachmentsStorageService(
    {} as CacheService,
    {} as PrismaService,
    { emit: vi.fn() } as unknown as EventEmitterService,
    { urlExpireIn: '1h' } as IStorageConfig,
    storageAdapter
  );

  beforeEach(() => {
    uploads.length = 0;
  });

  it('writes both thumbnails for a raster shorter than the lg threshold, without upscaling', async () => {
    // Readers fall back to the original when a thumbnail is missing, which is
    // exactly what a HEIC/PDF source cannot offer.
    const height = ATTACHMENT_SM_THUMBNAIL_HEIGHT + 24;
    const png = await sharp({
      create: { width: height * 2, height, channels: 3, background: '#3b82f6' },
    })
      .png()
      .toBuffer();

    const result = await service.uploadTableImageThumbnailsFromBuffer('bucket', 'table/x', png);

    expect(result.smThumbnailPath).toBeDefined();
    expect(result.lgThumbnailPath).toBeDefined();
    expect(result.smThumbnailPath).not.toBe(result.lgThumbnailPath);
    const byPath = Object.fromEntries(uploads.map(({ path, buffer }) => [path, buffer]));
    const sm = await sharp(byPath[result.smThumbnailPath]).metadata();
    const lg = await sharp(byPath[result.lgThumbnailPath]).metadata();
    expect(sm.height).toBe(ATTACHMENT_SM_THUMBNAIL_HEIGHT);
    expect(lg.height).toBe(height);
    expect(lg.height).toBeLessThan(ATTACHMENT_LG_THUMBNAIL_HEIGHT);
  });

  it('writes WebP thumbnails under .webp keys', async () => {
    const png = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#3b82f6' },
    })
      .png()
      .toBuffer();

    const result = await service.uploadTableImageThumbnailsFromBuffer('bucket', 'table/x', png);

    expect(result).toEqual({
      smThumbnailPath: 'table/x_sm.webp',
      lgThumbnailPath: 'table/x_lg.webp',
    });
    expect(storageAdapter.uploadFile).toHaveBeenCalledWith(
      'bucket',
      'table/x_lg.webp',
      expect.any(Buffer),
      { 'Content-Type': 'image/webp' }
    );
    for (const { buffer } of uploads) {
      expect((await sharp(buffer).metadata()).format).toBe('webp');
    }
  });

  it('caps an extra-wide rendered thumbnail at the widest side WebP can encode', async () => {
    const wide = await sharp({
      create: { width: 40000, height: 600, channels: 3, background: '#3b82f6' },
    })
      .png()
      .toBuffer();

    await service.uploadTableImageThumbnailsFromBuffer('bucket', 'table/x', wide);

    const byPath = Object.fromEntries(uploads.map(({ path, buffer }) => [path, buffer]));
    expect(await sharp(byPath['table/x_lg.webp']).metadata()).toMatchObject({
      format: 'webp',
      width: 16383,
    });
    expect((await sharp(byPath['table/x_sm.webp']).metadata()).height).toBe(56);
  });
});

describe('AttachmentsStorageService.getPreviewUrlByPath', () => {
  const createService = () => {
    const cacheService = { get: vi.fn().mockResolvedValue(undefined), set: vi.fn() };
    const storageAdapter = {
      getPreviewUrl: vi.fn().mockResolvedValue('https://storage.example/signed'),
    };
    const service = new AttachmentsStorageService(
      cacheService as unknown as CacheService,
      {} as PrismaService,
      { emit: vi.fn() } as unknown as EventEmitterService,
      { urlExpireIn: '1h' } as IStorageConfig,
      storageAdapter as unknown as StorageAdapter
    );
    return { service, cacheService, storageAdapter };
  };

  it('signs a table attachment path', async () => {
    const { service, storageAdapter } = createService();

    await expect(service.getPreviewUrlByPath('private', 'table/tok123', 'tok123')).resolves.toBe(
      'https://storage.example/signed'
    );
    expect(storageAdapter.getPreviewUrl).toHaveBeenCalledWith(
      'private',
      'table/tok123',
      3600,
      undefined
    );
  });

  it.each([
    'record-history/v1/tblVictim/_stats.json',
    'record-removal/v1/tblVictim/delete/_stats.json',
    'audit-log/2026/part.ndjson.zst',
    'workflow-run/2026/part.ndjson.zst',
    'artifact/art1/index.html',
    'table/../record-history/v1/tblVictim/_stats.json',
  ])('refuses to sign %s, without consulting the cache or the provider', async (path) => {
    const { service, cacheService, storageAdapter } = createService();

    await expect(service.getPreviewUrlByPath('private', path, 'tok123')).rejects.toMatchObject({
      code: HttpErrorCode.VALIDATION_ERROR,
    });
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(storageAdapter.getPreviewUrl).not.toHaveBeenCalled();
  });
});
