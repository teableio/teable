import { CellValueType, DbFieldType, FieldType, type IFieldVo } from '@teable/core';
import type { ICopyVo } from '@teable/openapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTableContent } from '@/features/app/utils/clipboard';
import { ClipboardTypes, copyHandler } from './copyAndPaste';

class TestClipboardItem {
  constructor(readonly data: Record<string, Blob | PromiseLike<Blob>>) {}
}

const userHeader = {
  id: 'fldUser',
  name: 'Owner',
  dbFieldName: 'owner',
  type: FieldType.User,
  options: { isMultiple: false, shouldNotify: false },
  cellValueType: CellValueType.String,
  dbFieldType: DbFieldType.Json,
  isMultipleCellValue: false,
} as IFieldVo;

const multipleUserHeader = {
  ...userHeader,
  options: { isMultiple: true, shouldNotify: false },
  isMultipleCellValue: true,
} as IFieldVo;

const textHeader = {
  ...userHeader,
  id: 'fldText',
  name: 'Text',
  dbFieldName: 'text',
  type: FieldType.SingleLineText,
  options: {},
  dbFieldType: DbFieldType.Text,
} as IFieldVo;

const installClipboard = (userAgent = 'Mozilla/5.0 Chrome/124 Safari/537.36') => {
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('ClipboardItem', TestClipboardItem);
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { write },
  });
  return write;
};

const readBlob = async (value: Blob | PromiseLike<Blob>) => {
  const blob = await value;
  return blob.text();
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('copyHandler', () => {
  it('round-trips an async user cell with its authorized id and email', async () => {
    const write = installClipboard();
    const rawContent = [[{ id: 'usrAlice', title: 'Alice', email: 'alice@example.com' }]];
    const getCopyData = vi.fn<() => Promise<ICopyVo>>().mockResolvedValue({
      content: 'Alice',
      header: [userHeader],
      rawContent,
    });

    await copyHandler(getCopyData);

    const item = write.mock.calls[0]![0][0] as TestClipboardItem;
    const html = await readBlob(item.data[ClipboardTypes.html]);
    expect(extractTableContent(html)).toEqual(rawContent);
    expect(await readBlob(item.data[ClipboardTypes.text])).toBe('Alice');
    expect(getCopyData).toHaveBeenCalledTimes(1);
  });

  it('round-trips multiple users without adding missing email values', async () => {
    const write = installClipboard();
    const rawContent = [
      [
        [
          { id: 'usrEmpty', title: 'Empty email', email: '' },
          { id: 'usrMissing', title: 'Missing email' },
        ],
      ],
    ];

    await copyHandler(async () => ({
      content: 'Empty email, Missing email',
      header: [multipleUserHeader],
      rawContent,
    }));

    const item = write.mock.calls[0]![0][0] as TestClipboardItem;
    const parsed = extractTableContent(await readBlob(item.data[ClipboardTypes.html]));
    expect(parsed).toEqual(rawContent);
    expect((parsed?.[0]?.[0] as Array<Record<string, unknown>>)[1]).not.toHaveProperty('email');
  });

  it('keeps the legacy string HTML fallback when rawContent is absent', async () => {
    const write = installClipboard();

    await copyHandler(async () => ({ content: 'plain value', header: [textHeader] }));

    const item = write.mock.calls[0]![0][0] as TestClipboardItem;
    expect(extractTableContent(await readBlob(item.data[ClipboardTypes.html]))).toEqual([
      ['plain value'],
    ]);
    expect(await readBlob(item.data[ClipboardTypes.text])).toBe('plain value');
  });

  it('starts Safari clipboard writes in the gesture and shares one async data request', async () => {
    const write = installClipboard(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15'
    );
    const rawContent = [[{ id: 'usrAlice', title: 'Alice', email: 'alice@example.com' }]];
    const { promise: copyDataPromise, resolve: resolveCopy } = Promise.withResolvers<ICopyVo>();
    const getCopyData = vi.fn<() => Promise<ICopyVo>>().mockReturnValue(copyDataPromise);

    const copying = copyHandler(getCopyData);

    // This assertion runs before either the request or a microtask can resolve.
    expect(write).toHaveBeenCalledTimes(1);
    resolveCopy({ content: 'Alice', header: [userHeader], rawContent });
    await copying;
    expect(getCopyData).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0]![0][0] as TestClipboardItem;
    expect(extractTableContent(await readBlob(item.data[ClipboardTypes.html]))).toEqual(rawContent);
    expect(await readBlob(item.data[ClipboardTypes.text])).toBe('Alice');
  });

  it('keeps formatted link and attachment display beside a raw user cell', async () => {
    const write = installClipboard();
    const linkHeader = {
      ...textHeader,
      id: 'fldLink',
      type: FieldType.Link,
      options: {
        relationship: 'manyOne',
        foreignTableId: 'tblForeign',
        lookupFieldId: 'fldTitle',
        fkHostTableName: 'junction',
        selfKeyName: 'self_id',
        foreignKeyName: 'foreign_id',
      },
    } as IFieldVo;
    const attachmentHeader = {
      ...textHeader,
      id: 'fldAttachment',
      type: FieldType.Attachment,
      options: {},
      isMultipleCellValue: true,
    } as IFieldVo;
    const rawContent = [
      [
        { id: 'usrAlice', title: 'Alice', email: 'alice@example.com' },
        'Linked <record>',
        'report & notes.pdf',
      ],
    ];
    const content = 'Alice\tLinked <record>\treport & notes.pdf';

    await copyHandler(async () => ({
      content,
      header: [userHeader, linkHeader, attachmentHeader],
      rawContent,
    }));

    const item = write.mock.calls[0]![0][0] as TestClipboardItem;
    const html = await readBlob(item.data[ClipboardTypes.html]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(Array.from(doc.querySelectorAll('td'), (cell) => cell.textContent)).toEqual([
      'Alice',
      'Linked <record>',
      'report & notes.pdf',
    ]);
    expect(extractTableContent(html)).toEqual(rawContent);
    expect(await readBlob(item.data[ClipboardTypes.text])).toBe(content);
  });
});
