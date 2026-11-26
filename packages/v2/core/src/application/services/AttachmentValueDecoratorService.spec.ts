import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { domainError } from '../../domain/shared/DomainError';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { AttachmentPublicAccess } from '../../domain/table/fields/types/AttachmentPublicAccess';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type {
  AttachmentPublicLinkRequest,
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
  publicLinks: ReturnType<typeof vi.fn>;
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
  publicLinks: vi.fn(async (cells: ReadonlyArray<unknown>) => ok(cells.map(() => undefined))),
});

const buildTable = ({ isPublic = false } = {}) => {
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
    .withPublicAccess(
      isPublic ? AttachmentPublicAccess.enabled() : AttachmentPublicAccess.disabled()
    )
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

    const result = await service.decorateChangedFields(table, 'rec1', changedFields);
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

    const result = await service.decorateChangedFields(
      table,
      'rec1',
      changedFields,
      previousFields
    );
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

    await service.decorateChangedFields(table, 'rec1', changedFields, previousFields);
    expect(signer.invalidatePreview).not.toHaveBeenCalled();
  });

  it('passes through items missing path/token/mimetype without calling signer', async () => {
    const { table, attachmentFieldId } = buildTable();
    const signer = buildSigner();
    const service = new AttachmentValueDecoratorService(signer);

    const changedFields = new Map<string, unknown>([
      [attachmentFieldId, [{ id: 'att-1', name: 'incomplete' }]],
    ]);

    const result = await service.decorateChangedFields(table, 'rec1', changedFields);
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
      publicLinks: vi.fn(async (cells: ReadonlyArray<unknown>) => ok(cells.map(() => undefined))),
    };
    const service = new AttachmentValueDecoratorService(signer);

    const result = await service.decorateChangedFields(
      table,
      'rec1',
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

  it('batches per-record attachment signing and preview invalidation', async () => {
    const { table, attachmentFieldId, textFieldId } = buildTable();
    const signer = buildSigner({
      'tok-1': { presignedUrl: 'https://cdn/one' },
      'tok-2': { presignedUrl: 'https://cdn/two' },
    });
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
                name: 'renamed.txt',
                path: 'table/tok-1',
                token: 'tok-1',
                mimetype: 'text/plain',
              },
            ],
          ],
          [textFieldId, 'kept'],
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
                name: 'second.txt',
                path: 'table/tok-2',
                token: 'tok-2',
                mimetype: 'text/plain',
              },
            ],
          ],
        ]),
      ],
    ]);
    const previous = new Map<string, Record<string, unknown>>([
      [
        'rec1',
        {
          [attachmentFieldId]: [
            {
              id: 'att-1',
              name: 'original.txt',
              path: 'table/tok-1',
              token: 'tok-1',
              mimetype: 'text/plain',
            },
          ],
        },
      ],
    ]);

    const result = await service.decorateChangedFieldsByRecord(table, perRecord, previous);
    const decorated = result._unsafeUnwrap();

    expect(decorated?.get('rec1')?.get(textFieldId)).toBe('kept');
    expect(decorated?.get('rec1')?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({ token: 'tok-1', presignedUrl: 'https://cdn/one' }),
    ]);
    expect(decorated?.get('rec2')?.get(attachmentFieldId)).toEqual([
      expect.objectContaining({ token: 'tok-2', presignedUrl: 'https://cdn/two' }),
    ]);
    expect(signer.signItems).toHaveBeenCalledTimes(1);
    expect(signer.signItems).toHaveBeenCalledWith([
      expect.objectContaining({ token: 'tok-1' }),
      expect.objectContaining({ token: 'tok-2' }),
    ]);
    expect(signer.invalidatePreview).toHaveBeenCalledTimes(1);
    expect(signer.invalidatePreview).toHaveBeenCalledWith(['tok-1']);
  });

  describe('public links', () => {
    const item = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: `${id}.png`,
      path: `table/tok-${id}`,
      token: `tok-${id}`,
      mimetype: 'image/png',
      size: 10,
      ...extra,
    });
    const linkingSigner = () => {
      const signer = buildSigner();
      signer.publicLinks.mockImplementation(
        async (cells: ReadonlyArray<AttachmentPublicLinkRequest>) =>
          ok(
            cells.map(({ recordId, attachmentId }) =>
              attachmentId === 'att-private'
                ? undefined
                : { publicUrl: `https://pub/${recordId}/${attachmentId}` }
            )
          )
      );
      return signer;
    };

    it('gives the items of a public field their links, by cell', async () => {
      const { table, attachmentFieldId } = buildTable({ isPublic: true });
      const signer = linkingSigner();
      const service = new AttachmentValueDecoratorService(signer);

      const result = await service.decorateChangedFields(
        table,
        'rec1',
        new Map([[attachmentFieldId, [item('att-1')]]])
      );

      expect(result._unsafeUnwrap()?.get(attachmentFieldId)).toEqual([
        expect.objectContaining({ id: 'att-1', publicUrl: 'https://pub/rec1/att-1' }),
      ]);
      expect(signer.publicLinks).toHaveBeenCalledWith([
        {
          tableId: table.id().toString(),
          recordId: 'rec1',
          fieldId: attachmentFieldId,
          attachmentId: 'att-1',
          token: 'tok-att-1',
          mimetype: 'image/png',
          size: 10,
        },
      ]);
    });

    it('hands the links the files the signer just read, for one record and a batch', async () => {
      const { table, attachmentFieldId } = buildTable({ isPublic: true });
      const file = { size: 12, mimetype: 'image/png', thumbnailPath: { lg: 'table/tok-att-1_lg' } };
      const signer = buildSigner({ 'tok-att-1': { presignedUrl: 'https://signed/1', file } });
      const service = new AttachmentValueDecoratorService(signer);

      const single = await service.decorateChangedFields(
        table,
        'rec1',
        new Map([[attachmentFieldId, [item('att-1')]]])
      );
      await service.decorateChangedFieldsByRecord(
        table,
        new Map([['rec2', new Map([[attachmentFieldId, [item('att-1')]]])]])
      );

      const requests = signer.publicLinks.mock.calls.flatMap(
        ([cells]) => cells as AttachmentPublicLinkRequest[]
      );
      expect(requests.map(({ recordId, file: given }) => [recordId, given])).toEqual([
        ['rec1', file],
        ['rec2', file],
      ]);
      // the stored row goes to the host only, never into the cell
      expect(single._unsafeUnwrap()?.get(attachmentFieldId)).toEqual([
        expect.not.objectContaining({ file: expect.anything() }),
      ]);
    });

    it('does not ask for links in a field without public links', async () => {
      const { table, attachmentFieldId } = buildTable();
      const signer = linkingSigner();
      const service = new AttachmentValueDecoratorService(signer);

      await service.decorateChangedFields(
        table,
        'rec1',
        new Map([[attachmentFieldId, [item('att-1')]]])
      );

      expect(signer.publicLinks).not.toHaveBeenCalled();
    });

    it('replaces the links an item carried, and drops one the host no longer gives', async () => {
      const signer = linkingSigner();
      const service = new AttachmentValueDecoratorService(signer);

      const result = await service.linkCells([
        {
          location: { tableId: 'tbl1', recordId: 'rec1', fieldId: 'fld1' },
          value: [
            item('att-1', {
              publicUrl: 'https://stale/1',
              publicThumbnailUrl: 'https://stale/1_t',
            }),
            item('att-private', { publicUrl: 'https://stale/2' }),
          ],
        },
      ]);

      const [linked, dropped] = result._unsafeUnwrap()[0] as Record<string, unknown>[];
      expect(linked).toMatchObject({ publicUrl: 'https://pub/rec1/att-1' });
      expect(linked).not.toHaveProperty('publicThumbnailUrl');
      expect(dropped).not.toHaveProperty('publicUrl');
    });

    it('links each record of a batch in its own cell', async () => {
      const { table, attachmentFieldId } = buildTable({ isPublic: true });
      const signer = linkingSigner();
      const service = new AttachmentValueDecoratorService(signer);

      const result = await service.decorateChangedFieldsByRecord(
        table,
        new Map([
          ['rec1', new Map([[attachmentFieldId, [item('att-1')]]])],
          ['rec2', new Map([[attachmentFieldId, [item('att-1')]]])],
        ])
      );

      const decorated = result._unsafeUnwrap();
      expect(decorated?.get('rec1')?.get(attachmentFieldId)).toEqual([
        expect.objectContaining({ publicUrl: 'https://pub/rec1/att-1' }),
      ]);
      expect(decorated?.get('rec2')?.get(attachmentFieldId)).toEqual([
        expect.objectContaining({ publicUrl: 'https://pub/rec2/att-1' }),
      ]);
    });
  });
});
