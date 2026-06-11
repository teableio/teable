/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type {
  AttachmentSignRequest,
  AttachmentSignedUrls,
  IAttachmentLookupService,
  IAttachmentUrlSignerService,
} from '@teable/v2-core';
import {
  AttachmentValueDecoratorService,
  BaseId,
  FieldId,
  FieldName,
  Table,
  TableId,
  TableName,
  ok,
} from '@teable/v2-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../attachments/attachments-storage.service', () => ({
  AttachmentsStorageService: class AttachmentsStorageService {},
}));
vi.mock('../attachments/plugins/adapter', () => ({
  default: { getBucket: () => 'table-bucket' },
}));
vi.mock('../attachments/utils', () => ({
  resolveThumbnailMimetype: (mimetype: string) =>
    mimetype === 'application/pdf' ? 'image/png' : mimetype,
}));

import type { CacheService } from '../../cache/cache.service';
import { V2AttachmentUrlSignerService } from './v2-attachment-url-signer.service';
import { V2RecordChangedValueDecoratorService } from './v2-record-changed-value-decorator.service';

type IAttachmentStorage = ConstructorParameters<typeof V2AttachmentUrlSignerService>[0];

const buildCacheService = () =>
  ({
    del: vi.fn().mockResolvedValue(undefined),
  }) as unknown as CacheService;

const buildAttachmentLookupService = (
  records: Array<{
    token: string;
    thumbnailPath?: { sm?: string; lg?: string };
  }> = []
): IAttachmentLookupService => ({
  listAttachmentsByTokens: vi.fn().mockResolvedValue(
    ok(
      records.map((r) => ({
        id: `id-${r.token}`,
        token: r.token,
        path: `table/${r.token}`,
        size: 100,
        mimetype: 'application/octet-stream',
        thumbnailPath: r.thumbnailPath,
      }))
    )
  ),
  listAttachmentsByAttachmentIds: vi.fn().mockResolvedValue(ok([])),
});

const buildService = (
  attachmentsStorageService: IAttachmentStorage,
  attachmentLookupService: IAttachmentLookupService,
  cacheService: CacheService
): V2RecordChangedValueDecoratorService => {
  const signer = new V2AttachmentUrlSignerService(
    attachmentsStorageService,
    attachmentLookupService,
    cacheService
  );
  const core = new AttachmentValueDecoratorService(signer);
  return new V2RecordChangedValueDecoratorService(core);
};

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const attachmentFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Decorate Changed Values')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(textFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .attachment()
    .withId(attachmentFieldId)
    .withName(FieldName.create('Files')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();

  return {
    table: builder.build()._unsafeUnwrap(),
    attachmentFieldId: attachmentFieldId.toString(),
    textFieldId: textFieldId.toString(),
  };
};

describe('V2RecordChangedValueDecoratorService', () => {
  it('delegates decorateChangedFields to the core AttachmentValueDecoratorService', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer: IAttachmentUrlSignerService = {
      signItems: vi.fn().mockImplementation(async (items: ReadonlyArray<AttachmentSignRequest>) => {
        const map = new Map<string, AttachmentSignedUrls>();
        for (const item of items) {
          map.set(item.token, { presignedUrl: `https://cdn/${item.token}` });
        }
        return ok(map);
      }),
      invalidatePreview: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const core = new AttachmentValueDecoratorService(signer);
    const service = new V2RecordChangedValueDecoratorService(core);

    const result = await service.decorateChangedFields(
      table,
      new Map<string, unknown>([
        [
          attachmentFieldId,
          [
            {
              id: 'att-1',
              name: 'n.png',
              path: 'table/file.png',
              token: 'tok-1',
              mimetype: 'image/png',
            },
          ],
        ],
      ])
    );

    expect(signer.signItems).toHaveBeenCalledTimes(1);
    expect(result._unsafeUnwrap()?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({ presignedUrl: 'https://cdn/tok-1' }),
    ]);
  });

  it('decorates changed attachment values without touching non-attachment fields', async () => {
    const { table, attachmentFieldId, textFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/file.png'),
      getTableThumbnailUrl: vi
        .fn()
        .mockResolvedValueOnce('https://cdn.example.com/file-sm.png')
        .mockResolvedValueOnce('https://cdn.example.com/file-lg.png'),
    };
    const attachmentLookupService = buildAttachmentLookupService([
      { token: 'tok-1', thumbnailPath: { sm: 'table/file.png_sm', lg: 'table/file.png_lg' } },
    ]);
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      buildCacheService()
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'file.png',
            path: 'table/file.png',
            token: 'tok-1',
            mimetype: 'image/png',
          },
        ],
      ],
      [textFieldId, 'unchanged text'],
    ]);

    const result = await service.decorateChangedFields(table, changedFields);
    const decorated = result._unsafeUnwrap();

    expect(attachmentsStorageService.getPreviewUrlByPath).toHaveBeenCalledTimes(1);
    expect(attachmentsStorageService.getTableThumbnailUrl).toHaveBeenCalledTimes(2);
    expect(decorated?.get(textFieldId)).toBe('unchanged text');
    expect(decorated?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-1',
        name: 'file.png',
        path: 'table/file.png',
        token: 'tok-1',
        mimetype: 'image/png',
        presignedUrl: 'https://cdn.example.com/file.png',
        smThumbnailUrl: 'https://cdn.example.com/file-sm.png',
        lgThumbnailUrl: 'https://cdn.example.com/file-lg.png',
      },
    ]);
  });

  it('decorates pdf attachments with generated thumbnails and skips missing metadata', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/file.pdf'),
      getTableThumbnailUrl: vi
        .fn()
        .mockResolvedValueOnce('https://cdn.example.com/file-sm.png')
        .mockResolvedValueOnce('https://cdn.example.com/file-lg.png'),
    };
    const attachmentLookupService = buildAttachmentLookupService([
      { token: 'tok-1', thumbnailPath: { sm: 'table/file.pdf_sm', lg: 'table/file.pdf_lg' } },
    ]);
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      buildCacheService()
    );

    const changedFieldsByRecord = new Map<string, ReadonlyMap<string, unknown>>([
      [
        'rec1',
        new Map<string, unknown>([
          [
            attachmentFieldId,
            [
              {
                id: 'att-1',
                name: 'file.pdf',
                path: 'table/file.pdf',
                token: 'tok-1',
                mimetype: 'application/pdf',
              },
            ],
          ],
        ]),
      ],
      [
        'rec2',
        new Map<string, unknown>([
          [
            attachmentFieldId,
            [
              {
                id: 'att-2',
                name: 'incomplete',
              },
            ],
          ],
        ]),
      ],
    ]);

    const result = await service.decorateChangedFieldsByRecord(table, changedFieldsByRecord);
    const decorated = result._unsafeUnwrap();

    expect(attachmentsStorageService.getPreviewUrlByPath).toHaveBeenCalledTimes(1);
    expect(attachmentsStorageService.getTableThumbnailUrl).toHaveBeenCalledTimes(2);
    expect(attachmentLookupService.listAttachmentsByTokens).toHaveBeenCalledWith(['tok-1']);
    expect(attachmentsStorageService.getTableThumbnailUrl).toHaveBeenNthCalledWith(
      1,
      'table/file.pdf_sm',
      'image/png'
    );
    expect(attachmentsStorageService.getTableThumbnailUrl).toHaveBeenNthCalledWith(
      2,
      'table/file.pdf_lg',
      'image/png'
    );
    expect(decorated?.get('rec1')?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-1',
        name: 'file.pdf',
        path: 'table/file.pdf',
        token: 'tok-1',
        mimetype: 'application/pdf',
        presignedUrl: 'https://cdn.example.com/file.pdf',
        smThumbnailUrl: 'https://cdn.example.com/file-sm.png',
        lgThumbnailUrl: 'https://cdn.example.com/file-lg.png',
      },
    ]);
    expect(decorated?.get('rec2')?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-2',
        name: 'incomplete',
      },
    ]);
  });

  it('limits attachment URL decoration concurrency', async () => {
    const { table, attachmentFieldId } = buildTable();
    const startedTokens: string[] = [];
    const resolvers = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;

    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockImplementation(async (_bucket, _path, token: string) => {
        startedTokens.push(token);
        active += 1;
        maxActive = Math.max(maxActive, active);

        await new Promise<void>((resolve) => {
          resolvers.set(token, () => {
            resolvers.delete(token);
            active -= 1;
            resolve();
          });
        });

        return `https://cdn.example.com/${token}`;
      }),
      getTableThumbnailUrl: vi.fn(),
    };
    const attachmentLookupService = buildAttachmentLookupService(
      Array.from({ length: 6 }, (_, index) => ({
        token: `tok-${index}`,
        thumbnailPath: { sm: `table/file-${index}.pdf_sm`, lg: `table/file-${index}.pdf_lg` },
      }))
    );
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      buildCacheService()
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        Array.from({ length: 6 }, (_, index) => ({
          id: `att-${index}`,
          name: `file-${index}.pdf`,
          path: `table/file-${index}.pdf`,
          token: `tok-${index}`,
          mimetype: 'application/pdf',
        })),
      ],
    ]);

    const decoratePromise = service.decorateChangedFields(table, changedFields);

    await vi.waitFor(() => {
      expect(startedTokens).toHaveLength(4);
    });
    expect(maxActive).toBe(4);

    for (const token of [...startedTokens]) {
      resolvers.get(token)?.();
    }

    await vi.waitFor(() => {
      expect(startedTokens).toHaveLength(6);
    });
    expect(maxActive).toBe(4);

    for (const token of startedTokens) {
      resolvers.get(token)?.();
    }

    const result = await decoratePromise;
    expect(result.isOk()).toBe(true);
    expect(maxActive).toBe(4);
  });

  it('falls back to presignedUrl for images when thumbnails are not yet generated', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/file.png'),
      getTableThumbnailUrl: vi.fn(),
    };
    // No thumbnailPath in DB — thumbnail not yet generated
    const attachmentLookupService = buildAttachmentLookupService([{ token: 'tok-1' }]);
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      buildCacheService()
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'photo.jpg',
            path: 'table/photo.jpg',
            token: 'tok-1',
            mimetype: 'image/jpeg',
          },
        ],
      ],
    ]);

    const result = await service.decorateChangedFields(table, changedFields);
    const decorated = result._unsafeUnwrap();

    // Should NOT call getTableThumbnailUrl at all — no paths to look up
    expect(attachmentsStorageService.getTableThumbnailUrl).not.toHaveBeenCalled();
    // Image falls back to presignedUrl for thumbnails
    expect(decorated?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-1',
        name: 'photo.jpg',
        path: 'table/photo.jpg',
        token: 'tok-1',
        mimetype: 'image/jpeg',
        presignedUrl: 'https://cdn.example.com/file.png',
        smThumbnailUrl: 'https://cdn.example.com/file.png',
        lgThumbnailUrl: 'https://cdn.example.com/file.png',
      },
    ]);
  });

  it('returns undefined thumbnail URLs for PDFs when thumbnails are not yet generated', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/doc.pdf'),
      getTableThumbnailUrl: vi.fn(),
    };
    // No thumbnailPath — PDF thumbnail not yet cropped
    const attachmentLookupService = buildAttachmentLookupService([{ token: 'tok-1' }]);
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      buildCacheService()
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'doc.pdf',
            path: 'table/doc.pdf',
            token: 'tok-1',
            mimetype: 'application/pdf',
          },
        ],
      ],
    ]);

    const result = await service.decorateChangedFields(table, changedFields);
    const decorated = result._unsafeUnwrap();

    expect(attachmentsStorageService.getTableThumbnailUrl).not.toHaveBeenCalled();
    // PDF does NOT fall back to presignedUrl — thumbnails are absent
    expect(decorated?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-1',
        name: 'doc.pdf',
        path: 'table/doc.pdf',
        token: 'tok-1',
        mimetype: 'application/pdf',
        presignedUrl: 'https://cdn.example.com/doc.pdf',
      },
    ]);
  });

  it('invalidates presigned URL cache and regenerates URL when attachment name changes', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/renamed-file.txt'),
      getTableThumbnailUrl: vi.fn(),
    };
    const attachmentLookupService = buildAttachmentLookupService([{ token: 'tok-1' }]);
    const cacheService = buildCacheService();
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      cacheService
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'renamed-file.txt',
            path: 'table/tok-1',
            token: 'tok-1',
            mimetype: 'application/octet-stream',
          },
        ],
      ],
    ]);

    const previousFields: Record<string, unknown> = {
      [attachmentFieldId]: [
        {
          id: 'att-1',
          name: 'original-name.txt',
          path: 'table/tok-1',
          token: 'tok-1',
          mimetype: 'application/octet-stream',
        },
      ],
    };

    const result = await service.decorateChangedFields(table, changedFields, previousFields);
    const decorated = result._unsafeUnwrap();

    // Cache should be invalidated for the renamed attachment
    expect(cacheService.del).toHaveBeenCalledWith('attachment:preview:tok-1');

    // presignedUrl should contain the new filename in Content-Disposition
    expect(attachmentsStorageService.getPreviewUrlByPath).toHaveBeenCalledWith(
      expect.anything(),
      'table/tok-1',
      'tok-1',
      undefined,
      expect.objectContaining({
        'Content-Disposition': expect.stringContaining('renamed-file.txt'),
      })
    );

    // Result should contain the presignedUrl
    expect(decorated?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({
        token: 'tok-1',
        name: 'renamed-file.txt',
        presignedUrl: 'https://cdn.example.com/renamed-file.txt',
      }),
    ]);
  });

  it('does NOT invalidate cache when attachment name is unchanged', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/same-file.txt'),
      getTableThumbnailUrl: vi.fn(),
    };
    const attachmentLookupService = buildAttachmentLookupService([{ token: 'tok-1' }]);
    const cacheService = buildCacheService();
    const service = buildService(
      attachmentsStorageService as unknown as IAttachmentStorage,
      attachmentLookupService,
      cacheService
    );

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'same-file.txt',
            path: 'table/tok-1',
            token: 'tok-1',
            mimetype: 'application/octet-stream',
          },
        ],
      ],
    ]);

    const previousFields: Record<string, unknown> = {
      [attachmentFieldId]: [
        {
          id: 'att-1',
          name: 'same-file.txt',
          path: 'table/tok-1',
          token: 'tok-1',
          mimetype: 'application/octet-stream',
        },
      ],
    };

    const result = await service.decorateChangedFields(table, changedFields, previousFields);
    const decorated = result._unsafeUnwrap();

    // Cache should NOT be invalidated — name didn't change
    expect(cacheService.del).not.toHaveBeenCalled();

    // Decoration should still happen (presignedUrl still generated)
    expect(attachmentsStorageService.getPreviewUrlByPath).toHaveBeenCalledTimes(1);
    expect(decorated?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({
        token: 'tok-1',
        name: 'same-file.txt',
        presignedUrl: 'https://cdn.example.com/same-file.txt',
      }),
    ]);
  });
});
