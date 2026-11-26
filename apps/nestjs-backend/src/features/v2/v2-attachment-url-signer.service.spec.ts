import { domainError, err, ok } from '@teable/v2-core';
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

    expect(urls.get(coldArchive.token)).toEqual({ file: null });
    expect(urls.get(image.token)).toEqual({
      presignedUrl: original,
      smThumbnailUrl: original,
      lgThumbnailUrl: original,
      file: null,
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
      file: expect.anything(),
    });
  });

  it('hands each live stored row to the public links, null for a deleted or missing one', async () => {
    const doc = { token: 'token2', path: 'table/token2', mimetype: 'application/pdf' };
    const gone = { token: 'token3', path: 'table/token3', mimetype: 'text/plain' };
    const lookup = {
      listAttachmentsByTokens: vi.fn().mockResolvedValue(
        ok([
          {
            token: image.token,
            size: 10,
            mimetype: 'image/png',
            thumbnailPath: { lg: 'table/lg' },
          },
          { token: gone.token, size: 3, mimetype: 'text/plain', deleted: true },
        ])
      ),
    };
    const storage = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue(original),
      getTableThumbnailUrl: vi.fn(),
    };
    const signer = new V2AttachmentUrlSignerService(
      storage as never,
      lookup as never,
      { del: vi.fn() } as never
    );

    const urls = (await signer.signItems([image, doc, gone] as never))._unsafeUnwrap();

    expect(urls.get(image.token)?.file).toEqual({
      size: 10,
      mimetype: 'image/png',
      thumbnailPath: { lg: 'table/lg' },
    });
    expect(urls.get(doc.token)?.file).toBeNull();
    expect(urls.get(gone.token)?.file).toBeNull();
  });

  it('hands no stored row when the lookup failed, so the links read it themselves', async () => {
    const lookup = {
      listAttachmentsByTokens: vi
        .fn()
        .mockResolvedValue(err(domainError.infrastructure({ message: 'down' }))),
    };
    const storage = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue(original),
      getTableThumbnailUrl: vi.fn(),
    };
    const signer = new V2AttachmentUrlSignerService(
      storage as never,
      lookup as never,
      { del: vi.fn() } as never
    );

    const urls = (await signer.signItems([image] as never))._unsafeUnwrap();

    expect(urls.get(image.token)).not.toHaveProperty('file');
  });

  it('gives public links through the edition hook, and none without one', async () => {
    const cell = {
      tableId: 'tbl1',
      recordId: 'rec1',
      fieldId: 'fld1',
      attachmentId: 'act1',
      token: image.token,
    };
    const { signer } = createSigner();
    expect((await signer.publicLinks([cell]))._unsafeUnwrap()).toEqual([undefined]);

    const hook = { publicLinks: vi.fn().mockResolvedValue([{ publicUrl: 'https://pub/act1' }]) };
    const withHook = new V2AttachmentUrlSignerService(
      {} as never,
      {} as never,
      {} as never,
      () => hook
    );
    expect((await withHook.publicLinks([cell]))._unsafeUnwrap()).toEqual([
      { publicUrl: 'https://pub/act1' },
    ]);
    expect(hook.publicLinks).toHaveBeenCalledWith([cell]);
  });

  it('leaves the links out when the hook fails', async () => {
    const hook = { publicLinks: vi.fn().mockRejectedValue(new Error('redis down')) };
    const signer = new V2AttachmentUrlSignerService(
      {} as never,
      {} as never,
      {} as never,
      () => hook
    );
    const result = await signer.publicLinks([
      { tableId: 'tbl1', recordId: 'rec1', fieldId: 'fld1', attachmentId: 'act1', token: 't' },
    ]);
    expect(result._unsafeUnwrap()).toEqual([undefined]);
  });
});
