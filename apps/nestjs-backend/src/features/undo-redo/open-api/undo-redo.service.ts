import { Injectable } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';

@Injectable()
export class UndoRedoService {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService
  ) {}

  async undo(tableId: string, windowId: string): Promise<IUndoVo> {
    const { operation, push } = await this.undoRedoStackService.popUndo(tableId, windowId);

    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      const newOperation = await this.undoRedoOperationService.undo(operation);
      await push(newOperation);
    } catch (e) {
      return {
        status: 'failed',
        errorMessage: (e as { message: string }).message,
      };
    }

    return {
      status: 'fulfilled',
    };
  }

  async redo(tableId: string, windowId: string): Promise<IRedoVo> {
    const { operation, push } = await this.undoRedoStackService.popRedo(tableId, windowId);
    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      const newOperation = await this.undoRedoOperationService.redo(operation);
      await push(newOperation);
    } catch (e) {
      return {
        status: 'failed',
        errorMessage: (e as { message: string }).message,
      };
    }

    return {
      status: 'fulfilled',
    };
  }
}
