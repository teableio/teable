import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type {
  AttachmentSignRequest,
  AttachmentSignedUrls,
  IAttachmentUrlSignerService,
} from '../../ports/AttachmentUrlSignerService';
import { AttachmentValueDecoratorService } from './AttachmentValueDecoratorService';

const buildSigner = (
  signedByToken: Record<string, AttachmentSignedUrls> = {}
): IAttachmentUrlSignerService & {
  signItems: ReturnType<typeof vi.fn>;
  invalidatePreview: ReturnType<typeof vi.fn>;
} => ({
  signItems: vi.fn().mockImplementation(async (items: ReadonlyArray<AttachmentSignRequest>) => {
    const map = new Map<string, AttachmentSignedUrls>();
    for (const item of items) {
      if (signedByToken[item.token]) {
        map.set(item.token, signedByToken[item.token]);
      }
    }
    return ok(map);
  }),
  invalidatePreview: vi.fn().mockResolvedValue(ok(undefined)),
});

const buildTable = () => {
  const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
  const attachmentFieldId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
  const textFieldId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();

  const builder = Table.builder()
    .withId(tableId)
    .withBaseId(baseId)
    .withName(TableName.create('Attachment decoration')._unsafeUnwrap());
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

describe('AttachmentValueDecoratorService', () => {
  it('returns non-array attachment values unchanged', async () => {
    const signer = buildSigner();
    const service = new AttachmentValueDecoratorService(signer);

    const result = await service.decorateAttachmentValue(null);

    expect(result._unsafeUnwrap()).toBeNull();
    expect(signer.signItems).not.toHaveBeenCalled();
    expect(signer.invalidatePreview).not.toHaveBeenCalled();
  });

  it('skips non-attachment fields and decorates attachment fields', async () => {
    const { table, attachmentFieldId, textFieldId } = buildTable();
    const signer = buildSigner({
      'tok-1': { presignedUrl: 'https://cdn/pre', smThumbnailUrl: 'https://cdn/sm' },
    });
    const service = new AttachmentValueDecoratorService(signer);

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
      [textFieldId, 'hello'],
    ]);

    const result = await service.decorateChangedFields(table, changedFields);
    const decorated = result._unsafeUnwrap();

    expect(decorated?.get(textFieldId)).toBe('hello');
    expect(decorated?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({
        token: 'tok-1',
        presignedUrl: 'https://cdn/pre',
        smThumbnailUrl: 'https://cdn/sm',
      }),
    ]);
    expect(signer.signItems).toHaveBeenCalledTimes(1);
  });

  it('invalidates preview cache when attachment name changes', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer = buildSigner({ 'tok-1': { presignedUrl: 'https://cdn/new' } });
    const service = new AttachmentValueDecoratorService(signer);

    const changedFields = new Map<string, unknown>([
      [
        attachmentFieldId,
        [
          {
            id: 'att-1',
            name: 'renamed.txt',
            path: 'table/tok-1',
            token: 'tok-1',
            mimetype: 'text/plain',
          },
        ],
      ],
    ]);
    const previousFields: Record<string, unknown> = {
      [attachmentFieldId]: [
        {
          id: 'att-1',
          name: 'original.txt',
          path: 'table/tok-1',
          token: 'tok-1',
          mimetype: 'text/plain',
        },
      ],
    };

    const result = await service.decorateChangedFields(table, changedFields, previousFields);
    expect(result.isOk()).toBe(true);
    expect(signer.invalidatePreview).toHaveBeenCalledWith(['tok-1']);
  });

  it('does not invalidate cache when names are identical', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer = buildSigner({ 'tok-1': { presignedUrl: 'https://cdn/u' } });
    const service = new AttachmentValueDecoratorService(signer);

    const value = [
      {
        id: 'att-1',
        name: 'same.txt',
        path: 'table/tok-1',
        token: 'tok-1',
        mimetype: 'text/plain',
      },
    ];
    const changedFields = new Map<string, unknown>([[attachmentFieldId, value]]);
    const previousFields: Record<string, unknown> = { [attachmentFieldId]: value };

    await service.decorateChangedFields(table, changedFields, previousFields);
    expect(signer.invalidatePreview).not.toHaveBeenCalled();
  });

  it('passes through items missing path/token/mimetype without calling signer', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer = buildSigner();
    const service = new AttachmentValueDecoratorService(signer);

    const changedFields = new Map<string, unknown>([
      [attachmentFieldId, [{ id: 'att-1', name: 'incomplete' }]],
    ]);

    const result = await service.decorateChangedFields(table, changedFields);
    expect(result._unsafeUnwrap()?.get(attachmentFieldId)).toEqual([
      { id: 'att-1', name: 'incomplete' },
    ]);
    expect(signer.signItems).not.toHaveBeenCalled();
  });

  it('propagates signer errors through safeTry', async () => {
    const { table, attachmentFieldId } = buildTable();
    const failure = domainError.infrastructure({
      code: 'storage.unavailable',
      message: 'storage failed',
    });
    const signer: IAttachmentUrlSignerService = {
      signItems: vi.fn().mockResolvedValue(err(failure)),
      invalidatePreview: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const service = new AttachmentValueDecoratorService(signer);

    const result = await service.decorateChangedFields(
      table,
      new Map<string, unknown>([
        [
          attachmentFieldId,
          [
            {
              id: 'att-1',
              name: 'x.txt',
              path: 'table/x',
              token: 'tok-1',
              mimetype: 'text/plain',
            },
          ],
        ],
      ])
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(failure);
  });

  it('decorates per-record fields via decorateChangedFieldsByRecord', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer = buildSigner({ 'tok-1': { presignedUrl: 'https://cdn/u' } });
    const service = new AttachmentValueDecoratorService(signer);

    const perRecord = new Map<string, ReadonlyMap<string, unknown>>([
      [
        'rec1',
        new Map<string, unknown>([
          [
            attachmentFieldId,
            [
              {
                id: 'att-1',
                name: 'n.txt',
                path: 'table/tok-1',
                token: 'tok-1',
                mimetype: 'text/plain',
              },
            ],
          ],
        ]),
      ],
    ]);

    const result = await service.decorateChangedFieldsByRecord(table, perRecord);
    const decorated = result._unsafeUnwrap();

    expect(decorated?.get('rec1')?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({ token: 'tok-1', presignedUrl: 'https://cdn/u' }),
    ]);
  });
});
