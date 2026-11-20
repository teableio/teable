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
});
