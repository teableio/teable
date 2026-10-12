import { HttpErrorCode } from '@teable/core';
import { createUndoRedoCommand, domainError, err, ok, TableId } from '@teable/v2-core';
import type { UndoEntry, UndoRedoReplayOptions } from '@teable/v2-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationName } from '../../../cache/types';
import { CustomHttpException } from '../../../custom.exception';
import { UndoRedoService } from './undo-redo.service';

const tableId = `tbl${'a'.repeat(16)}`;
const windowId = 'winxxx';
const denied = new CustomHttpException(
  'not allowed to operate record|create on tblxxx',
  HttpErrorCode.RESTRICTED_RESOURCE
);

describe('UndoRedoService permission gate', () => {
  const clsStore: Record<string, unknown> = {};
  const cls = {
    get: vi.fn((key: string) => clsStore[key]),
  };
  const cacheService = { get: vi.fn() };
  const undoRedoStackService = { popUndo: vi.fn(), popRedo: vi.fn() };
  const undoRedoOperationService = { undo: vi.fn(), redo: vi.fn() };
  const permissionService = { validPermissions: vi.fn() };
  const v2StackService = { applyUndo: vi.fn(), applyRedo: vi.fn() };
  const v2ContainerService = {
    getContainerForTable: vi.fn().mockResolvedValue({ resolve: () => v2StackService }),
  };
  const v2ContextFactory = {
    createContext: vi.fn().mockResolvedValue({ actorId: 'usrxxx' }),
  };

  const permissionResolver = { resolveTableActions: vi.fn() };

  const service = (resolver?: typeof permissionResolver) =>
    new UndoRedoService(
      v2ContainerService as never,
      v2ContextFactory as never,
      cls as never,
      cacheService as never,
      undoRedoStackService as never,
      undoRedoOperationService as never,
      { dataPrismaForTable: vi.fn() } as never,
      { markRestored: vi.fn() } as never,
      permissionService as never,
      undefined,
      resolver as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(clsStore)) {
      delete clsStore[key];
    }
    clsStore['user.id'] = 'usrxxx';
    clsStore['accessTokenId'] = 'acc_token';
    cacheService.get.mockResolvedValue('v1');
  });

  describe('v1 engine', () => {
    const push = vi.fn();
    const deleteRecordsOperation = {
      name: OperationName.DeleteRecords,
      params: { tableId },
      result: { records: [] },
    };

    beforeEach(() => {
      undoRedoStackService.popUndo.mockResolvedValue({ operation: deleteRecordsOperation, push });
      undoRedoStackService.popRedo.mockResolvedValue({ operation: deleteRecordsOperation, push });
    });

    it('checks the actions the replay writes, with the token scope, before replaying', async () => {
      permissionService.validPermissions.mockResolvedValue(['record|create']);
      undoRedoOperationService.undo.mockResolvedValue({ name: OperationName.CreateRecords });

      await expect(service().undo(tableId, windowId)).resolves.toMatchObject({
        body: { status: 'fulfilled' },
        engine: 'v1',
      });

      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableId,
        ['record|create'],
        'acc_token'
      );
      expect(undoRedoOperationService.undo).toHaveBeenCalledWith(deleteRecordsOperation);
      expect(push).toHaveBeenCalled();
    });

    it('rejects an undo the caller may no longer perform without touching the stack', async () => {
      permissionService.validPermissions.mockRejectedValue(denied);

      await expect(service().undo(tableId, windowId)).rejects.toBe(denied);

      expect(undoRedoOperationService.undo).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
      // A refused v1 replay must not fall through to the v2 engine either.
      expect(v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
    });

    it('checks the inverse action set for redo', async () => {
      permissionService.validPermissions.mockRejectedValue(denied);

      await expect(service().redo(tableId, windowId)).rejects.toBe(denied);

      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableId,
        ['record|delete'],
        'acc_token'
      );
      expect(undoRedoOperationService.redo).not.toHaveBeenCalled();
    });

    it('fails closed on an operation it cannot map', async () => {
      undoRedoStackService.popUndo.mockResolvedValue({
        operation: { name: 'somethingNew', params: { tableId } },
        push,
      });

      await expect(service().undo(tableId, windowId)).rejects.toMatchObject({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      });

      expect(permissionService.validPermissions).not.toHaveBeenCalled();
      expect(undoRedoOperationService.undo).not.toHaveBeenCalled();
    });

    it('uses the share-scoped permission set for a share-view request', async () => {
      clsStore['shareViewId'] = 'shrxxx';
      clsStore['permissions'] = ['table|read', 'record|update'];

      await expect(service().undo(tableId, windowId)).rejects.toMatchObject({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      });
      expect(permissionService.validPermissions).not.toHaveBeenCalled();
      expect(undoRedoOperationService.undo).not.toHaveBeenCalled();

      clsStore['permissions'] = ['table|read', 'record|create'];
      undoRedoOperationService.undo.mockResolvedValue({ name: OperationName.CreateRecords });
      await expect(service().undo(tableId, windowId)).resolves.toMatchObject({
        body: { status: 'fulfilled' },
      });
      expect(permissionService.validPermissions).not.toHaveBeenCalled();
    });

    it('checks against the edition resolver set instead of the base role when it governs the table', async () => {
      // e.g. an authority-matrix member: base role Viewer, matrix grants record|create.
      permissionResolver.resolveTableActions.mockResolvedValue(['table|read', 'record|create']);
      undoRedoOperationService.undo.mockResolvedValue({ name: OperationName.CreateRecords });

      await expect(service(permissionResolver).undo(tableId, windowId)).resolves.toMatchObject({
        body: { status: 'fulfilled' },
      });
      expect(permissionResolver.resolveTableActions).toHaveBeenCalledWith(tableId);
      expect(permissionService.validPermissions).not.toHaveBeenCalled();

      // The matrix withdrew record|create: refused even if the base role would allow it.
      permissionResolver.resolveTableActions.mockResolvedValue(['table|read', 'record|update']);
      permissionService.validPermissions.mockResolvedValue(['record|create']);
      undoRedoOperationService.undo.mockClear();

      await expect(service(permissionResolver).undo(tableId, windowId)).rejects.toMatchObject({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      });
      expect(permissionService.validPermissions).not.toHaveBeenCalled();
      expect(undoRedoOperationService.undo).not.toHaveBeenCalled();
    });

    it('falls back to the base role when the resolver does not govern the table', async () => {
      permissionResolver.resolveTableActions.mockResolvedValue(undefined);
      permissionService.validPermissions.mockRejectedValue(denied);

      await expect(service(permissionResolver).undo(tableId, windowId)).rejects.toBe(denied);
      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableId,
        ['record|create'],
        'acc_token'
      );
    });
  });

  describe('v2 engine', () => {
    const entry: UndoEntry = {
      scope: {
        actorId: 'usrxxx' as never,
        tableId: TableId.create(tableId)._unsafeUnwrap(),
        windowId,
      },
      undoCommand: createUndoRedoCommand('RestoreRecords', { tableId, records: [] }),
      redoCommand: createUndoRedoCommand('DeleteRecords', { tableId, recordIds: [] }),
      createdAt: new Date().toISOString(),
    };

    // Stand-in for the engine: runs the host veto the way applyStackEntry does
    // and reports whether the entry would have been replayed.
    const engineReplay = async (
      options: UndoRedoReplayOptions | undefined,
      mode: 'undo' | 'redo'
    ) => {
      const veto = await options?.beforeReplay?.(entry, mode);
      if (veto?.isErr()) {
        return err(veto.error);
      }
      return ok(entry);
    };

    beforeEach(() => {
      cacheService.get.mockResolvedValue('v2');
      v2StackService.applyUndo.mockImplementation((_ctx, _tableId, _windowId, options) =>
        engineReplay(options, 'undo')
      );
      v2StackService.applyRedo.mockImplementation((_ctx, _tableId, _windowId, options) =>
        engineReplay(options, 'redo')
      );
    });

    it('vetoes the reserved entry through the engine hook and answers 403', async () => {
      permissionService.validPermissions.mockRejectedValue(denied);

      await expect(service().undo(tableId, windowId)).rejects.toBe(denied);

      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableId,
        ['record|create'],
        'acc_token'
      );
      // Nothing to fall back to: the refusal must not pop the v1 stack.
      expect(undoRedoStackService.popUndo).not.toHaveBeenCalled();
    });

    it('lets a permitted replay through', async () => {
      permissionService.validPermissions.mockResolvedValue(['record|delete']);

      await expect(service().redo(tableId, windowId)).resolves.toMatchObject({
        body: { status: 'fulfilled' },
        engine: 'v2',
      });
      expect(permissionService.validPermissions).toHaveBeenCalledWith(
        tableId,
        ['record|delete'],
        'acc_token'
      );
    });

    it('surfaces a refusal on the stream as an error event carrying the http code', async () => {
      permissionService.validPermissions.mockRejectedValue(denied);

      const events = [];
      for await (const event of service().undoStream(tableId, windowId)) {
        events.push(event);
      }

      expect(events).toEqual([
        {
          id: 'error',
          mode: 'undo',
          engine: 'v2',
          message: denied.message,
          code: HttpErrorCode.RESTRICTED_RESOURCE,
        },
      ]);
    });

    it('keeps reporting engine failures as failed replays', async () => {
      v2StackService.applyUndo.mockResolvedValue(
        err(domainError.unexpected({ message: 'replay failed' }))
      );

      await expect(service().undo(tableId, windowId)).resolves.toMatchObject({
        body: { status: 'failed', errorMessage: 'replay failed' },
        engine: 'v2',
      });
    });
  });
});
