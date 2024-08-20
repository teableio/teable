import { Injectable } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { OperationName } from '../../../cache/types';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';

@Injectable()
export class UndoRedoService {
  constructor(
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService
  ) {}

  async undo(tableId: string, windowId: string): Promise<IUndoVo> {
    const { operation, save } = await this.undoRedoStackService.undo(tableId, windowId);

    console.log('startUndo:', tableId, windowId, operation);
    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      switch (operation.name) {
        case OperationName.CreateRecords:
          await this.undoRedoOperationService.createRecords.undo(operation);
          break;
        case OperationName.DeleteRecord:
          // await this.undoDeleteRecord(operation);
          break;
      }
    } catch (e) {
      return {
        status: 'failed',
        errorMessage: (e as { message: string }).message,
      };
    }

    await save();
    return {
      status: 'fulfilled',
    };
  }

  async redo(tableId: string, windowId: string): Promise<IRedoVo> {
    const { operation, save } = await this.undoRedoStackService.redo(tableId, windowId);
    if (!operation) {
      return {
        status: 'empty',
      };
    }
    console.log('startRedo:', tableId, windowId, operation);

    try {
      switch (operation.name) {
        case OperationName.CreateRecords:
          await this.undoRedoOperationService.createRecords.redo(operation);
          break;
        case OperationName.DeleteRecord:
          // await this.undoUpdateRecord(operation);
          break;
      }
    } catch (e) {
      return {
        status: 'failed',
        errorMessage: (e as { message: string }).message,
      };
    }

    await save();
    return {
      status: 'fulfilled',
    };
  }
}
