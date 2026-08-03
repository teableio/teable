import type { INestApplication } from '@nestjs/common';
import type { ICommentContent, ICommentVo } from '@teable/openapi';
import {
  createComment,
  CommentNodeType,
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
import { createTable, deleteTable, initApp } from './utils/init-app';

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
