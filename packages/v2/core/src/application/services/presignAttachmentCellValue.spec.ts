import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { IAttachmentUrlSignerService } from '../../ports/AttachmentUrlSignerService';
import {
  normalizeAttachmentCellValue,
  presignAttachmentCellValue,
  presignAttachmentFieldMaps,
} from './presignAttachmentCellValue';

const item = {
  id: 'att1',
  name: 'photo.png',
  path: 'table/photo.png',
  token: 'tok-photo',
  size: 12,
  mimetype: 'image/png',
};

describe('presignAttachmentCellValue', () => {
  it('normalizes single object and array cells', () => {
    expect(normalizeAttachmentCellValue(null)).toBeNull();
    expect(normalizeAttachmentCellValue(item)).toEqual([item]);
    expect(normalizeAttachmentCellValue([item])).toEqual([item]);
    expect(normalizeAttachmentCellValue('x')).toBeNull();
  });

  it('signs a cell via the port without needing a service instance', async () => {
    const signer: IAttachmentUrlSignerService = {
      signItems: vi.fn().mockResolvedValue(
        ok(
          new Map([
            [
              'tok-photo',
              {
                presignedUrl: 'https://cdn.example/photo',
                smThumbnailUrl: 'https://cdn.example/photo-sm',
                lgThumbnailUrl: 'https://cdn.example/photo-lg',
              },
            ],
          ])
        )
      ),
      invalidatePreview: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const result = await presignAttachmentCellValue([item], signer);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([
      {
        ...item,
        presignedUrl: 'https://cdn.example/photo',
        smThumbnailUrl: 'https://cdn.example/photo-sm',
        lgThumbnailUrl: 'https://cdn.example/photo-lg',
      },
    ]);
    expect(signer.signItems).toHaveBeenCalledTimes(1);
  });

  it('batch-signs attachment keys across records with one signer call', async () => {
    const signer: IAttachmentUrlSignerService = {
      signItems: vi.fn().mockResolvedValue(
        ok(
          new Map([
            ['tok-photo', { presignedUrl: 'https://cdn.example/photo' }],
            ['tok-doc', { presignedUrl: 'https://cdn.example/doc' }],
          ])
        )
      ),
      invalidatePreview: vi.fn().mockResolvedValue(ok(undefined)),
    };

    const doc = {
      id: 'att2',
      name: 'doc.pdf',
      path: 'table/doc.pdf',
      token: 'tok-doc',
      size: 3,
      mimetype: 'application/pdf',
    };

    const result = await presignAttachmentFieldMaps(
      [
        { Title: 'a', Files: [item] },
        { Title: 'b', Files: [doc], Files2: [item] },
      ],
      new Set(['Files', 'Files2']),
      signer
    );

    expect(result.isOk()).toBe(true);
    const maps = result._unsafeUnwrap();
    expect(maps[0]?.Files).toEqual([{ ...item, presignedUrl: 'https://cdn.example/photo' }]);
    expect(maps[1]?.Files).toEqual([{ ...doc, presignedUrl: 'https://cdn.example/doc' }]);
    expect(maps[1]?.Files2).toEqual([{ ...item, presignedUrl: 'https://cdn.example/photo' }]);
    // Deduped tokens → single batch call.
    expect(signer.signItems).toHaveBeenCalledTimes(1);
    const signedTokens = (signer.signItems as ReturnType<typeof vi.fn>).mock.calls[0]![0].map(
      (r: { token: string }) => r.token
    );
    expect(signedTokens.sort()).toEqual(['tok-doc', 'tok-photo']);
  });
});
