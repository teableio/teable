import { describe, expect, it, vi } from 'vitest';
import { BaseId, FieldId, FieldName, Table, TableId, TableName } from '@teable/v2-core';

vi.mock('../attachments/attachments-storage.service', () => ({
  AttachmentsStorageService: class AttachmentsStorageService {},
}));

import { V2RecordChangedValueDecoratorService } from './v2-record-changed-value-decorator.service';

type AttachmentStorage = ConstructorParameters<typeof V2RecordChangedValueDecoratorService>[0];

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
  it('decorates changed attachment values without touching non-attachment fields', async () => {
    const { table, attachmentFieldId, textFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/file.png'),
      getTableThumbnailUrl: vi
        .fn()
        .mockResolvedValueOnce('https://cdn.example.com/file-sm.png')
        .mockResolvedValueOnce('https://cdn.example.com/file-lg.png'),
    };
    const service = new V2RecordChangedValueDecoratorService(
      attachmentsStorageService as unknown as AttachmentStorage
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

  it('decorates changed fields by record and skips missing attachment metadata', async () => {
    const { table, attachmentFieldId } = buildTable();
    const attachmentsStorageService = {
      getPreviewUrlByPath: vi.fn().mockResolvedValue('https://cdn.example.com/file.pdf'),
      getTableThumbnailUrl: vi.fn(),
    };
    const service = new V2RecordChangedValueDecoratorService(
      attachmentsStorageService as unknown as AttachmentStorage
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
    expect(attachmentsStorageService.getTableThumbnailUrl).not.toHaveBeenCalled();
    expect(decorated?.get('rec1')?.get(attachmentFieldId)).toEqual([
      {
        id: 'att-1',
        name: 'file.pdf',
        path: 'table/file.pdf',
        token: 'tok-1',
        mimetype: 'application/pdf',
        presignedUrl: 'https://cdn.example.com/file.pdf',
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
    const service = new V2RecordChangedValueDecoratorService(
      attachmentsStorageService as unknown as AttachmentStorage
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
});
