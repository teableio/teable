import type { INestApplication } from '@nestjs/common';
import { FieldType } from '@teable/core';
import {
  CommentNodeType,
  GET_COMMENT_COUNT,
  axios,
  createComment,
  deleteComment,
  getCommentCount,
  urlBuilder,
} from '@teable/openapi';
import type { ICommentContent, ITableFullVo } from '@teable/openapi';
import { createTable, initApp, permanentDeleteTable } from './utils/init-app';

describe('OpenAPI comment counts for loaded records (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let table: ITableFullVo;

  const commentContent = (value: string): ICommentContent => [
    {
      type: CommentNodeType.Paragraph,
      children: [{ type: CommentNodeType.Text, value }],
    },
  ];

  beforeAll(async () => {
    app = (await initApp()).app;
    table = await createTable(baseId, {
      name: 'Loaded record comment counts',
      fields: [{ name: 'Label', type: FieldType.SingleLineText }],
      records: [
        { fields: { Label: 'First' } },
        { fields: { Label: 'Second' } },
        { fields: { Label: 'No comments' } },
      ],
    });
    for (const record of [table.records[0], table.records[1], table.records[1]]) {
      await createComment(table.id, record.id, {
        content: commentContent('Active comment'),
        quoteId: null,
      });
    }
    const deleted = await createComment(table.id, table.records[1].id, {
      content: commentContent('Deleted comment'),
      quoteId: null,
    });
    await deleteComment(table.id, table.records[1].id, deleted.data.id);
  });

  afterAll(async () => {
    if (table?.id) {
      await permanentDeleteTable(baseId, table.id);
    }
    await app.close();
  });

  it('returns only active counts for the requested subset', async () => {
    const counts = await getCommentCount(table.id, {
      recordIds: [table.records[1].id, table.records[2].id],
    });
    expect(counts.status).toBe(200);
    expect(counts.data).toEqual([{ recordId: table.records[1].id, count: 2 }]);
  });

  it('returns no counts for an empty loaded-record batch', async () => {
    const counts = await getCommentCount(table.id, { recordIds: [] });
    expect(counts.status).toBe(200);
    expect(counts.data).toEqual([]);
  });

  it('accepts 1000 requested IDs without multiplying counts for duplicate IDs', async () => {
    const counts = await getCommentCount(table.id, {
      recordIds: Array<string>(1000).fill(table.records[1].id),
    });
    expect(counts.status).toBe(200);
    expect(counts.data).toEqual([{ recordId: table.records[1].id, count: 2 }]);
  });

  it('rejects more than 1000 requested IDs before deduplication', async () => {
    await expect(
      getCommentCount(table.id, {
        recordIds: Array<string>(1001).fill(table.records[0].id),
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a recordIds body instead of defaulting to every record', async () => {
    await expect(
      axios.post(urlBuilder(GET_COMMENT_COUNT, { tableId: table.id }), {})
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid record IDs', async () => {
    await expect(
      getCommentCount(table.id, { recordIds: ['not-a-record-id'] })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('does not expose comments from another table through supplied record IDs', async () => {
    const otherTable = await createTable(baseId, {
      name: 'Other table comments',
      fields: [{ name: 'Label', type: FieldType.SingleLineText }],
      records: [{ fields: { Label: 'Other' } }],
    });
    try {
      await createComment(otherTable.id, otherTable.records[0].id, {
        content: commentContent('Other table comment'),
        quoteId: null,
      });
      const counts = await getCommentCount(table.id, {
        recordIds: [table.records[0].id, otherTable.records[0].id],
      });
      expect(counts.data).toEqual([{ recordId: table.records[0].id, count: 1 }]);
    } finally {
      await permanentDeleteTable(baseId, otherTable.id);
    }
  });
});
