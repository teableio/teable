import { HttpErrorCode } from '@teable/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomHttpException } from '../../../custom.exception';
import { UndoRedoService } from './undo-redo.service';

describe('UndoRedoService write freeze', () => {
  const freezeError = new CustomHttpException(
    'Space data database migration is in progress',
    HttpErrorCode.CONFLICT,
    {
      errorCode: 'SPACE_DATA_DB_MIGRATING',
      migrationJobId: 'sdmjxxx',
    }
  );
  const v2ContainerService = {
    getContainerForTable: vi.fn(),
  };
  const v2ContextFactory = {
    createContext: vi.fn(),
  };
  const cls = {
    get: vi.fn(),
  };
  const cacheService = {
    get: vi.fn(),
  };
  const undoRedoStackService = {
    popUndo: vi.fn(),
    popRedo: vi.fn(),
  };
  const undoRedoOperationService = {
    undo: vi.fn(),
    redo: vi.fn(),
  };
  const migrationGuard = {
    assertTableWritable: vi.fn(),
  };

  const service = () =>
    new UndoRedoService(
      v2ContainerService as never,
      v2ContextFactory as never,
      cls as never,
      cacheService as never,
      undoRedoStackService as never,
      undoRedoOperationService as never,
      migrationGuard as never
    );

  beforeEach(() => {
    vi.clearAllMocks();
    migrationGuard.assertTableWritable.mockRejectedValue(freezeError);
  });

  it('rejects undo before reading engine preference or popping the undo stack', async () => {
    await expect(service().undo('tblxxx', 'winxxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(cls.get).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(undoRedoStackService.popUndo).not.toHaveBeenCalled();
    expect(v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
  });

  it('rejects redo before reading engine preference or popping the redo stack', async () => {
    await expect(service().redo('tblxxx', 'winxxx')).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(cls.get).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(undoRedoStackService.popRedo).not.toHaveBeenCalled();
    expect(v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
  });

  it('rejects streaming undo and redo before starting stack replay', async () => {
    const undoIterator = service().undoStream('tblxxx', 'winxxx')[Symbol.asyncIterator]();
    const redoIterator = service().redoStream('tblxxx', 'winxxx')[Symbol.asyncIterator]();

    await expect(undoIterator.next()).rejects.toBe(freezeError);
    await expect(redoIterator.next()).rejects.toBe(freezeError);

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledTimes(2);
    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(cls.get).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(undoRedoStackService.popUndo).not.toHaveBeenCalled();
    expect(undoRedoStackService.popRedo).not.toHaveBeenCalled();
    expect(v2ContainerService.getContainerForTable).not.toHaveBeenCalled();
  });

  it('allows non-migrating undo to continue through the normal stack path', async () => {
    const push = vi.fn();
    const operation = { id: 'opxxx' };
    const reverseOperation = { id: 'opreverse' };

    migrationGuard.assertTableWritable.mockResolvedValue(undefined);
    cls.get.mockReturnValue('usrxxx');
    cacheService.get.mockResolvedValue('v1');
    undoRedoStackService.popUndo.mockResolvedValue({
      operation,
      push,
    });
    undoRedoOperationService.undo.mockResolvedValue(reverseOperation);

    await expect(service().undo('tblxxx', 'winxxx')).resolves.toEqual({
      body: {
        status: 'fulfilled',
      },
      engine: 'v1',
    });

    expect(migrationGuard.assertTableWritable).toHaveBeenCalledWith('tblxxx');
    expect(undoRedoStackService.popUndo).toHaveBeenCalledWith('tblxxx', 'winxxx');
    expect(undoRedoOperationService.undo).toHaveBeenCalledWith(operation);
    expect(push).toHaveBeenCalledWith(reverseOperation);
  });
});
