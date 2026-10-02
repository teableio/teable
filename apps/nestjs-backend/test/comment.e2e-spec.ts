import type { INestApplication } from '@nestjs/common';
import {
  CellValueType,
  DateFormattingPreset,
  DbFieldType,
  FieldType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICommentContent, ICommentVo, IGetRecordsRo, ITableFullVo } from '@teable/openapi';
import {
  createComment,
  CommentNodeType,
  getCommentCount,
  getRecords as apiGetRecords,
  getCommentList,
  updateComment,
  deleteComment,
  getCommentDetail,
  createCommentReaction,
  deleteCommentReaction,
  createCommentSubscribe,
  EmojiSymbol,
  getCommentSubscribe,
  deleteCommentSubscribe,
} from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI CommentController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;
  let tableId: string;
  let recordId: string;
  let comments: ICommentVo[] = [];

  const commentContent = (value: string): ICommentContent => [
    {
      type: CommentNodeType.Paragraph,
      children: [{ type: CommentNodeType.Text, value }],
    },
  ];

  const expectNotFound = async (request: () => Promise<unknown>) => {
    let error: { status?: number } | undefined;
    try {
      await request();
    } catch (e) {
      error = e as { status?: number };
    }
    expect(error?.status).toBe(404);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const { id, records } = await createTable(baseId, { name: 'table' });
    tableId = id;
    recordId = records[0].id;

    const commentList = [];
    for (let i = 0; i < 20; i++) {
      const result = await createComment(tableId, recordId, {
        content: commentContent(`${i}`),
        quoteId: null,
      });
      commentList.push(result.data);
    }
    comments = commentList;
  });
  afterEach(async () => {
    await deleteTable(baseId, tableId);
  });

  it('should achieve the whole comment crud flow', async () => {
    // create comment
    const createRes = await createComment(tableId, recordId, {
      content: commentContent('hello world'),
      quoteId: null,
    });

    const result = await getCommentDetail(tableId, recordId, createRes.data.id);
    const { content, id: commentId } = result?.data as ICommentVo;
    expect(content).toEqual([
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Text, value: 'hello world' }],
      },
    ]);

    // update comment
    await updateComment(tableId, recordId, commentId, {
      content: commentContent('Good night, Paris.'),
    });

    const updatedResult = await getCommentDetail(tableId, recordId, createRes.data.id);

    expect(updatedResult?.data?.content).toEqual([
      {
        type: CommentNodeType.Paragraph,
        children: [{ type: CommentNodeType.Text, value: 'Good night, Paris.' }],
      },
    ]);

    // create reaction
    await createCommentReaction(tableId, recordId, createRes.data.id, {
      reaction: EmojiSymbol.eyes,
    });

    const createdReactionResult = await getCommentDetail(tableId, recordId, createRes.data.id);
    expect(createdReactionResult?.data?.reaction?.[0]?.reaction).toEqual(EmojiSymbol.eyes);
    expect(createdReactionResult?.data?.reaction?.[0]?.user?.[0]?.id).toEqual(userId);

    // delete reaction
    await deleteCommentReaction(tableId, recordId, createRes.data.id, {
      reaction: EmojiSymbol.eyes,
    });

    const deletedReactionResult = await getCommentDetail(tableId, recordId, createRes.data.id);
    expect(deletedReactionResult?.data?.reaction).toBeNull();
  });

  describe('comment resource isolation', () => {
    let otherTableId: string;
    let otherRecordId: string;

    beforeEach(async () => {
      const { id, records } = await createTable(baseId, { name: 'other table' });
      otherTableId = id;
      otherRecordId = records[0].id;
    });

    afterEach(async () => {
      await deleteTable(baseId, otherTableId);
    });

    it('should not return comment detail through a mismatched table and record path', async () => {
      const createRes = await createComment(tableId, recordId, {
        content: commentContent('source comment'),
        quoteId: null,
      });

      const mismatchedResult = await getCommentDetail(
        otherTableId,
        otherRecordId,
        createRes.data.id
      );

      expect(mismatchedResult.data || null).toBeNull();
    });

    it('should not update or delete a comment through a mismatched table and record path', async () => {
      const createRes = await createComment(tableId, recordId, {
        content: commentContent('owner mutation source'),
        quoteId: null,
      });

      await expectNotFound(() =>
        updateComment(otherTableId, otherRecordId, createRes.data.id, {
          content: commentContent('mismatched update'),
        })
      );

      const afterUpdate = await getCommentDetail(tableId, recordId, createRes.data.id);
      expect(afterUpdate.data?.content).toEqual(commentContent('owner mutation source'));

      await expectNotFound(() => deleteComment(otherTableId, otherRecordId, createRes.data.id));

      const afterDelete = await getCommentDetail(tableId, recordId, createRes.data.id);
      expect(afterDelete.data?.id).toBe(createRes.data.id);
    });

    it('should not create or delete reactions through a mismatched table and record path', async () => {
      const createRes = await createComment(tableId, recordId, {
        content: commentContent('reaction source'),
        quoteId: null,
      });

      await expectNotFound(() =>
        createCommentReaction(otherTableId, otherRecordId, createRes.data.id, {
          reaction: EmojiSymbol.eyes,
        })
      );

      const afterMismatchedCreate = await getCommentDetail(tableId, recordId, createRes.data.id);
      expect(afterMismatchedCreate.data?.reaction).toBeNull();

      await createCommentReaction(tableId, recordId, createRes.data.id, {
        reaction: EmojiSymbol.eyes,
      });

      await expectNotFound(() =>
        deleteCommentReaction(otherTableId, otherRecordId, createRes.data.id, {
          reaction: EmojiSymbol.eyes,
        })
      );

      const afterMismatchedDelete = await getCommentDetail(tableId, recordId, createRes.data.id);
      expect(afterMismatchedDelete.data?.reaction?.[0]?.reaction).toEqual(EmojiSymbol.eyes);
      expect(afterMismatchedDelete.data?.reaction?.[0]?.user?.[0]?.id).toEqual(userId);
    });

    it('should not create a comment with a quoteId from another table and record', async () => {
      const createRes = await createComment(tableId, recordId, {
        content: commentContent('quote source'),
        quoteId: null,
      });

      await expectNotFound(() =>
        createComment(otherTableId, otherRecordId, {
          content: commentContent('mismatched quote'),
          quoteId: createRes.data.id,
        })
      );

      const otherComments = await getCommentList(otherTableId, otherRecordId, {
        cursor: null,
        take: 10,
      });
      expect(otherComments.data.comments).toHaveLength(0);
    });
  });

  describe('get comment list with cursor', async () => {
    it('should get latest comments when cursor is null', async () => {
      const latestRes = await getCommentList(tableId, recordId, {
        cursor: null,
        take: 5,
      });

      expect(latestRes.data.comments.length).toBe(5);
      expect(latestRes.data.comments.map((com) => com.id)).toEqual(
        comments.slice(-5).map((com) => com.id)
      );
      expect(latestRes.data.nextCursor).toBe(comments.slice(-6).shift()?.id);
    });

    it('should return next 20 comments', async () => {
      const nextCursorCommentRes = await getCommentList(tableId, recordId, {
        cursor: comments[14].id,
        take: 20,
      });

      expect(nextCursorCommentRes.data.comments.length).toBe(15);
      expect(nextCursorCommentRes.data.comments.map((com) => com.id)).toEqual(
        comments.slice(0, 15).map((com) => com.id)
      );
      expect(nextCursorCommentRes.data.nextCursor).toBeNull();
    });
    it('should get comment by cursor with backward direction', async () => {
      const backwardRes = await getCommentList(tableId, recordId, {
        cursor: comments[0].id,
        take: 10,
        direction: 'backward',
      });
      expect(backwardRes.data.comments.length).toBe(10);
      expect(backwardRes.data.comments.map((com) => com.id)).toEqual(
        comments.slice(0, 10).map((com) => com.id)
      );
      expect(backwardRes.data.nextCursor).toBe(comments[10].id);
    });

    it('should return the comment by cursor exclude cursor', async () => {
      const result = await getCommentList(tableId, recordId, {
        cursor: comments[0].id,
        take: 10,
        direction: 'backward',
        includeCursor: false,
      });

      expect(result.data.comments.length).toBe(10);
      expect(result.data.comments.map((com) => com.id)).toEqual(
        comments.slice(1, 11).map((com) => com.id)
      );
      expect(result.data.nextCursor).toBe(comments[11].id);
    });

    it('should get comment list with mention user and image', async () => {
      await createComment(tableId, recordId, {
        content: [
          {
            type: CommentNodeType.Paragraph,
            children: [
              { type: CommentNodeType.Text, value: 'hello' },
              {
                type: CommentNodeType.Mention,
                value: userId,
                name: 'a',
                avatar: 'b',
              },
            ],
          },
          {
            type: CommentNodeType.Img,
            path: 'comment/xxxxxx',
            url: 'c',
          },
        ],
        quoteId: null,
      });

      const result = await getCommentList(tableId, recordId, {
        cursor: null,
        take: 1,
        direction: 'forward',
      });
      expect(result.data.comments[0].content).toEqual([
        {
          type: CommentNodeType.Paragraph,
          children: [
            { type: CommentNodeType.Text, value: 'hello' },
            {
              type: CommentNodeType.Mention,
              value: userId,
              name: globalThis.testConfig.userName,
              avatar: expect.any(String),
            },
          ],
        },
        {
          type: CommentNodeType.Img,
          path: 'comment/xxxxxx',
          url: expect.any(String),
        },
      ]);
      expect(result.data.comments[0].createdBy).toEqual({
        id: userId,
        name: globalThis.testConfig.userName,
        avatar: expect.any(String),
      });
    });
  });

  describe('comment subscribe relative', () => {
    it('should subscribe the record comment', async () => {
      await createCommentSubscribe(tableId, recordId);
      const result = await getCommentSubscribe(tableId, recordId);
      expect(result?.data?.createdBy).toBe(userId);
    });

    it('should return null when can not found the subscribe info', async () => {
      await createCommentSubscribe(tableId, recordId);
      const result = await getCommentSubscribe(tableId, recordId);
      expect(result?.data?.createdBy).toBe(userId);

      await deleteCommentSubscribe(tableId, recordId);
      const subscribeInfo = await getCommentSubscribe(tableId, recordId);
      // actually the subscribe info is null but, there is no idea to return ''.
      expect(subscribeInfo.data).toEqual('');
    });
  });
});

describe('OpenAPI Comment count search with v2 date storage (e2e)', () => {
  let app: INestApplication;
  let previousForceV2All: string | undefined;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app?.close();
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  });

  it('returns exact comment counts for text search with a legacy scalar date lookup', async () => {
    const sourceTable = await createTable(baseId, {
      name: 'comment_count_date_source',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        },
      ],
      records: [
        { fields: { Name: 'Source one', Date: '2026-04-12T12:00:00.000Z' } },
        { fields: { Name: 'Source two', Date: '2026-04-13T12:00:00.000Z' } },
      ],
    });
    let table: ITableFullVo | undefined;

    try {
      table = await createTable(baseId, {
        name: 'comment_count_date_lookup_search',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Source',
            type: FieldType.Link,
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: sourceTable.id,
            },
          },
        ],
        records: [
          { fields: { Name: 'Matching record', Source: { id: sourceTable.records[0].id } } },
          { fields: { Name: 'Other record', Source: { id: sourceTable.records[1].id } } },
        ],
      });
      const lookup = await createField(table.id, {
        name: 'Source Date',
        type: FieldType.Date,
        isLookup: true,
        lookupOptions: {
          foreignTableId: sourceTable.id,
          linkFieldId: table.fields.find(({ type }) => type === FieldType.Link)!.id,
          lookupFieldId: sourceTable.fields.find(({ type }) => type === FieldType.Date)!.id,
        },
      });

      // Preserve the observed legacy metadata without changing the timestamp column
      // created by the v2 product API for this scalar manyOne date lookup.
      if (
        lookup.cellValueType === CellValueType.DateTime &&
        lookup.dbFieldType === DbFieldType.DateTime
      ) {
        await app.get(PrismaService).field.update({
          where: { id: lookup.id },
          data: {
            cellValueType: CellValueType.String,
            dbFieldType: DbFieldType.Text,
            options: null,
          },
        });
      }

      for (const record of [table.records[0], table.records[0], table.records[1]]) {
        await createComment(table.id, record.id, {
          content: [
            {
              type: CommentNodeType.Paragraph,
              children: [{ type: CommentNodeType.Text, value: 'Search comment' }],
            },
          ],
          quoteId: null,
        });
      }

      const query: IGetRecordsRo = {
        viewId: table.views[0].id,
        search: ['Matching record', '', true],
        take: 100,
      };
      const visibleRecords = await apiGetRecords(table.id, query);
      expect(visibleRecords.headers['x-teable-v2']).toBe('true');
      expect(visibleRecords.data.records.map(({ id }) => id)).toEqual([table.records[0].id]);

      const counts = await getCommentCount(table.id, {
        recordIds: visibleRecords.data.records.map(({ id }) => id),
      });
      expect(counts.data).toEqual([{ recordId: table.records[0].id, count: 2 }]);
      expect(counts.data.map(({ recordId }) => recordId)).toEqual(
        visibleRecords.data.records.map(({ id }) => id)
      );
    } finally {
      if (table) {
        await permanentDeleteTable(baseId, table.id);
      }
      await permanentDeleteTable(baseId, sourceTable.id);
    }
  });
});
