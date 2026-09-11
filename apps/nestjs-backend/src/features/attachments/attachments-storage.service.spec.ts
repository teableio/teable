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
});
