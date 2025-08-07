/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';

@Injectable()
export class UndoRedoService {
  logger = new Logger(UndoRedoService.name);
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
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          status: 'failed',
          errorMessage: error.message,
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        status: 'failed',
        errorMessage: 'An unknown error occurred',
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
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          status: 'failed',
          errorMessage: error.message,
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        status: 'failed',
        errorMessage: 'An unknown error occurred',
      };
    }

    return {
      status: 'fulfilled',
    };
  }
}
