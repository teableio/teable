import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '@teable/db-main-prisma';
import type { ICommentContent } from '@teable/openapi';
import {
  CommentNodeType,
  createComment,
  createCommentSubscribe,
  getCommentCount,
  getCommentDetail,
  getCommentList,
  getCommentSubscribe,
  getTrashItems,
  resetTrashItems,
  TrashType,
  restoreTrash,
  TableTrashType,
} from '@teable/openapi';
import { createTable, deleteRecord, initApp, permanentDeleteTable } from './utils/init-app';

const commentContent = (value: string): ICommentContent => [
  {
    type: CommentNodeType.Paragraph,
    children: [{ type: CommentNodeType.Text, value }],
  },
];

describe('Record comment lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const baseId = globalThis.testConfig.baseId;
  let tableId: string;
  let targetRecordId: string;
  let controlRecordId: string;

  const countCommentRows = (recordId: string) =>
    prisma.comment.count({ where: { tableId, recordId } });

  const waitForRecordTrashItem = async () => {
    for (let i = 0; i < 100; i++) {
      const result = await getTrashItems({
        resourceId: tableId,
        resourceType: TrashType.Table,
      });
      const item = result.data.trashItems.find(
        (trashItem) => trashItem.resourceType === TableTrashType.Record
      );
      if (item) return item;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('record trash item not found');
  };

  const expectRecordNotFound = async (request: () => Promise<unknown>) => {
    const error = await request().then(
      () => undefined,
      (e: { status?: number }) => e
    );
    expect(error?.status).toBe(404);
  };

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const table = await createTable(baseId, { name: 'record comment lifecycle' });
    tableId = table.id;
    targetRecordId = table.records[0].id;
    controlRecordId = table.records[1].id;
    await createComment(tableId, targetRecordId, {
      content: commentContent('target'),
      quoteId: null,
    });
    await createCommentSubscribe(tableId, targetRecordId);
    await createComment(tableId, controlRecordId, {
      content: commentContent('control'),
      quoteId: null,
    });
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  it('keeps comments while the record is in the trash, restores them, and purges on reset', async () => {
    const [targetComment] = (await getCommentList(tableId, targetRecordId, {})).data.comments;

    await deleteRecord(tableId, targetRecordId);

    // unreachable while deleted, but kept for a restore
    expect((await getCommentList(tableId, targetRecordId, {})).data.comments).toEqual([]);
    expect((await getCommentDetail(tableId, targetRecordId, targetComment.id)).data).toBeFalsy();
    await expectRecordNotFound(() =>
      createComment(tableId, targetRecordId, { content: commentContent('late'), quoteId: null })
    );
    expect((await getCommentSubscribe(tableId, targetRecordId)).data).toBeFalsy();
    await expectRecordNotFound(() => createCommentSubscribe(tableId, targetRecordId));
    expect(await countCommentRows(targetRecordId)).toBe(1);

    const trashItem = await waitForRecordTrashItem();
    await restoreTrash(trashItem.id, tableId);

    const restoredComments = (await getCommentList(tableId, targetRecordId, {})).data.comments;
    expect(restoredComments.map(({ id }) => id)).toEqual([targetComment.id]);
    expect((await getCommentSubscribe(tableId, targetRecordId)).data?.recordId).toBe(
      targetRecordId
    );

    await deleteRecord(tableId, targetRecordId);
    await waitForRecordTrashItem();
    await resetTrashItems({ resourceType: TrashType.Table, resourceId: tableId });

    expect(await countCommentRows(targetRecordId)).toBe(0);
    expect(
      await prisma.commentSubscription.count({ where: { tableId, recordId: targetRecordId } })
    ).toBe(0);

    // the control record keeps its thread
    expect(await countCommentRows(controlRecordId)).toBe(1);
    const controlCounts = await getCommentCount(tableId, { recordIds: [controlRecordId] });
    expect(controlCounts.data).toEqual([{ recordId: controlRecordId, count: 1 }]);
  });
});
