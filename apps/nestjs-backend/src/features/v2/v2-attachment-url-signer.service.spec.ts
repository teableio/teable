import { ok } from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';
import { V2AttachmentUrlSignerService } from './v2-attachment-url-signer.service';

const original = 'https://storage.example/original';
const thumbnail = 'https://storage.example/thumbnail';

const image = { token: 'token1', path: 'table/token1', mimetype: 'image/png', name: 'a.png' };

const createSigner = (thumbnailPath?: { sm?: string; lg?: string }) => {
  const storage = {
    getPreviewUrlByPath: vi.fn().mockResolvedValue(original),
    getTableThumbnailUrl: vi.fn().mockResolvedValue(thumbnail),
  };
  const lookup = {
    listAttachmentsByTokens: vi
      .fn()
      .mockResolvedValue(ok(thumbnailPath ? [{ token: image.token, thumbnailPath }] : [])),
  };
  const signer = new V2AttachmentUrlSignerService(
    storage as never,
    lookup as never,
    { del: vi.fn() } as never
  );
  return { signer, storage };
};

describe('V2AttachmentUrlSignerService', () => {
  it('gives no url to an item that names a backend-only object, and still signs the rest', async () => {
    const { signer, storage } = createSigner();
    const coldArchive = {
      token: 'token2',
      path: 'record-history/v1/tblVictim/_stats.json',
      mimetype: 'application/json',
      name: 'stats.json',
    };

    const urls = (await signer.signItems([coldArchive, image] as never))._unsafeUnwrap();

    expect(urls.get(coldArchive.token)).toEqual({});
    expect(urls.get(image.token)).toEqual({
      presignedUrl: original,
      smThumbnailUrl: original,
      lgThumbnailUrl: original,
    });
    expect(storage.getPreviewUrlByPath).toHaveBeenCalledTimes(1);
    expect(storage.getPreviewUrlByPath.mock.calls[0][1]).toBe(image.path);
  });

  it('does not sign a thumbnail path that points into a backend-only dir', async () => {
    const { signer, storage } = createSigner({
      sm: 'audit-log/2026/part.ndjson.zst',
      lg: 'table/token1_lg.webp',
    });

    const urls = (await signer.signItems([image] as never))._unsafeUnwrap();

    expect(storage.getTableThumbnailUrl).toHaveBeenCalledTimes(1);
    expect(storage.getTableThumbnailUrl.mock.calls[0][0]).toBe('table/token1_lg.webp');
    expect(urls.get(image.token)).toEqual({
      presignedUrl: original,
      smThumbnailUrl: original,
      lgThumbnailUrl: thumbnail,
    });
  });
});
