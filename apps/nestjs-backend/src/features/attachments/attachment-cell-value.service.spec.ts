import { UploadType } from '@teable/openapi';
import { describe, expect, it, vi } from 'vitest';
import { getTableThumbnailToken } from '../../utils/generate-thumbnail-path';
import { AttachmentCellValueService } from './attachment-cell-value.service';
import StorageAdapter from './plugins/adapter';

const attachment = {
  id: 'act1',
  name: 'A photo.png',
  token: 'token1',
  path: 'table/photo.png',
  mimetype: 'image/png',
  size: 12,
};

const createService = () => {
  const getPreviewUrlByPath = vi.fn().mockResolvedValue('https://storage.example/original');
  const getTableThumbnailUrl = vi.fn().mockResolvedValue('https://storage.example/thumbnail');
  const service = new AttachmentCellValueService({
    getPreviewUrlByPath,
    getTableThumbnailUrl,
  } as never);
  return { service, getPreviewUrlByPath, getTableThumbnailUrl };
};

describe('AttachmentCellValueService', () => {
  it('preserves null and normalizes singleton cells before signing with download headers', async () => {
    const { service, getPreviewUrlByPath, getTableThumbnailUrl } = createService();

    expect(await service.getAttachmentPresignedCellValue(null)).toBeNull();
    expect(getPreviewUrlByPath).not.toHaveBeenCalled();
    const result = await service.getAttachmentPresignedCellValue(attachment);

    expect(getPreviewUrlByPath).toHaveBeenCalledExactlyOnceWith(
      StorageAdapter.getBucket(UploadType.Table),
      attachment.path,
      attachment.token,
      undefined,
      {
        ['Content-Type']: attachment.mimetype,
        ['Content-Disposition']: "attachment; filename*=UTF-8''A%20photo.png",
      }
    );
    expect(getTableThumbnailUrl).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        ...attachment,
        presignedUrl: 'https://storage.example/original',
        smThumbnailUrl: 'https://storage.example/original',
        lgThumbnailUrl: 'https://storage.example/original',
      },
    ]);
  });

  it('reuses cached original and thumbnail URLs while signing missing thumbnail sizes', async () => {
    const { service, getPreviewUrlByPath, getTableThumbnailUrl } = createService();
    const smPath = 'thumbnails/small.webp';
    const lgPath = 'thumbnails/large.webp';

    const result = await service.getAttachmentPresignedCellValue(
      [attachment],
      {
        [attachment.token]: 'https://cached.example/original',
        [getTableThumbnailToken(smPath)]: 'https://cached.example/small',
      },
      { [attachment.token]: { sm: smPath, lg: lgPath } }
    );

    expect(getPreviewUrlByPath).not.toHaveBeenCalled();
    expect(getTableThumbnailUrl).toHaveBeenCalledExactlyOnceWith(lgPath, 'image/webp');
    expect(result).toEqual([
      {
        ...attachment,
        presignedUrl: 'https://cached.example/original',
        smThumbnailUrl: 'https://cached.example/small',
        lgThumbnailUrl: 'https://storage.example/thumbnail',
      },
    ]);
  });

  it('does not use the original as an absent thumbnail for non-images', async () => {
    const { service } = createService();
    const document = { ...attachment, mimetype: 'application/pdf', name: 'document.pdf' };

    expect(await service.getAttachmentPresignedCellValue([document])).toEqual([
      {
        ...document,
        presignedUrl: 'https://storage.example/original',
        smThumbnailUrl: undefined,
        lgThumbnailUrl: undefined,
      },
    ]);
  });
  it('gives no url to a cell item that names a backend-only object, cached or fresh', async () => {
    const { service, getPreviewUrlByPath } = createService();
    const coldArchive = {
      ...attachment,
      id: 'act2',
      token: 'token2',
      path: 'record-history/v1/tblVictim/_stats.json',
    };

    const result = await service.getAttachmentPresignedCellValue([coldArchive, attachment], {
      [coldArchive.token]: 'https://storage.example/signed-before-the-check',
    });

    expect(result?.[0]).toEqual({
      ...coldArchive,
      presignedUrl: undefined,
      smThumbnailUrl: undefined,
      lgThumbnailUrl: undefined,
    });
    expect(result?.[1].presignedUrl).toBe('https://storage.example/original');
    expect(getPreviewUrlByPath).toHaveBeenCalledTimes(1);
    expect(getPreviewUrlByPath.mock.calls[0][1]).toBe(attachment.path);
  });

  it('does not sign a thumbnail path that points into a backend-only dir', async () => {
    const { service, getTableThumbnailUrl } = createService();

    const result = await service.getAttachmentPresignedCellValue(attachment, undefined, {
      [attachment.token]: { sm: 'audit-log/2026/part.ndjson.zst', lg: 'table/photo_lg.webp' },
    });

    expect(getTableThumbnailUrl).toHaveBeenCalledTimes(1);
    expect(getTableThumbnailUrl.mock.calls[0][0]).toBe('table/photo_lg.webp');
    expect(result?.[0]).toMatchObject({
      smThumbnailUrl: 'https://storage.example/original',
      lgThumbnailUrl: 'https://storage.example/thumbnail',
    });
  });
});
