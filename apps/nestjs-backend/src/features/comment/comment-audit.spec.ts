/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentOpenApiService } from './comment-open-api.service';

describe('CommentOpenApiService audit rows', () => {
  const audit = { emitAtomic: vi.fn(async () => undefined) };
  const prismaService = {
    comment: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const cls = { get: vi.fn(() => 'usr1') };
  // A comment is only reachable while its record is alive.
  const recordService = { getExistingRecordIds: vi.fn(async () => new Set(['rec1'])) };
  // Editor-level permissions by default: no table|update, so only own comments are deletable.
  const permissionService = { getPermissions: vi.fn(async () => ['record|comment']) };

  const createService = () => {
    const service = new CommentOpenApiService(
      {} as never,
      recordService as never,
      prismaService as never,
      cls as never,
      {} as never,
      {} as never,
      {} as never,
      audit as never,
      {} as never,
      permissionService as never
    );
    vi.spyOn(service as any, 'validateQuoteId').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'filterCommentContent').mockImplementation(async (c) => c);
    vi.spyOn(service as any, 'sendCommentNotify').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'sendCommentPatch').mockReturnValue(undefined);
    vi.spyOn(service as any, 'sendTableCommentPatch').mockReturnValue(undefined);
    return service;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes table.record.comment.create keyed by the new comment, without its text', async () => {
    prismaService.comment.create.mockImplementationOnce(async ({ data }) => ({
      ...data,
      content: data.content,
    }));

    const result = await createService().createComment('tbl1', 'rec1', {
      content: [{ type: 'p', children: [{ type: 'span', value: 'secret plan' }] }],
      quoteId: 'comQuoted',
    } as never);

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.record.comment.create',
      resourceId: result.id,
      params: { tableId: 'tbl1', recordId: 'rec1', commentId: result.id, quoteId: 'comQuoted' },
    });
    expect(JSON.stringify((audit.emitAtomic.mock.calls[0] as unknown[])[0])).not.toContain(
      'secret plan'
    );
  });

  it('writes table.record.comment.update after an edit of an own comment', async () => {
    prismaService.comment.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaService.comment.findFirst.mockResolvedValueOnce({
      id: 'com1',
      quoteId: null,
      content: '[]',
    });

    await createService().updateComment('tbl1', 'rec1', 'com1', { content: [] } as never);

    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.record.comment.update',
      resourceId: 'com1',
      params: { tableId: 'tbl1', recordId: 'rec1', commentId: 'com1' },
    });
  });

  it('writes table.record.comment.delete, and nothing when the comment is not the caller’s', async () => {
    prismaService.comment.updateMany.mockResolvedValueOnce({ count: 1 });
    const service = createService();

    await service.deleteComment('tbl1', 'rec1', 'com1');
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.record.comment.delete',
      resourceId: 'com1',
      params: { tableId: 'tbl1', recordId: 'rec1', commentId: 'com1' },
    });

    audit.emitAtomic.mockClear();
    prismaService.comment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.deleteComment('tbl1', 'rec1', 'com2')).rejects.toThrow();
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });

  it('lets a base creator delete a comment written by someone else, App Robot included', async () => {
    permissionService.getPermissions.mockResolvedValueOnce(['record|comment', 'table|update']);
    prismaService.comment.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await createService().deleteComment('tbl1', 'rec1', 'comByRobot');

    const secondWhere = (prismaService.comment.updateMany.mock.calls[1] as any[])[0].where;
    expect(secondWhere).toEqual({
      id: 'comByRobot',
      tableId: 'tbl1',
      recordId: 'rec1',
      deletedTime: null,
    });
    expect(audit.emitAtomic).toHaveBeenCalledWith({
      action: 'table.record.comment.delete',
      resourceId: 'comByRobot',
      params: { tableId: 'tbl1', recordId: 'rec1', commentId: 'comByRobot' },
    });
  });

  it('does not let an editor delete someone else’s comment', async () => {
    prismaService.comment.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(createService().deleteComment('tbl1', 'rec1', 'comOther')).rejects.toThrow();
    expect(prismaService.comment.updateMany).toHaveBeenCalledTimes(1);
    expect(audit.emitAtomic).not.toHaveBeenCalled();
  });
});
