import { Injectable } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import type { IUndoRedoOperation } from '../../../cache/types';
import { OperationName } from '../../../cache/types';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';

@Injectable()
export class UndoRedoService {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService
  ) {}

  private async performUndo(operation: IUndoRedoOperation): Promise<IUndoRedoOperation> {
    switch (operation.name) {
      case OperationName.CreateRecords:
        return this.undoRedoOperationService.createRecords.undo(operation);
      case OperationName.DeleteRecord:
        return this.undoRedoOperationService.deleteRecord.undo(operation);
      case OperationName.UpdateRecord:
        return this.undoRedoOperationService.updateRecord.undo(operation);
    }
    throw new Error('Operation not found');
  }

  async undo(tableId: string, windowId: string): Promise<IUndoVo> {
    const { operation, push } = await this.undoRedoStackService.undo(tableId, windowId);

    console.log('startUndo:', tableId, windowId, operation);
    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      const newOperation = await this.performUndo(operation);
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

  private async performRedo(operation: IUndoRedoOperation): Promise<IUndoRedoOperation> {
    switch (operation.name) {
      case OperationName.CreateRecords:
        return this.undoRedoOperationService.createRecords.redo(operation);
      case OperationName.DeleteRecord:
        return this.undoRedoOperationService.deleteRecord.redo(operation);
      case OperationName.UpdateRecord:
        return this.undoRedoOperationService.updateRecord.redo(operation);
    }
    throw new Error('Operation not found');
  }

  async redo(tableId: string, windowId: string): Promise<IRedoVo> {
    const { operation, push } = await this.undoRedoStackService.redo(tableId, windowId);
    if (!operation) {
      return {
        status: 'empty',
      };
    }
    console.log('startRedo:', tableId, windowId, operation);

    try {
      const newOperation = await this.performRedo(operation);
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
