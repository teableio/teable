import { Injectable } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { IUndoRedoOperation } from '../../../cache/types';
import { IThresholdConfig, ThresholdConfig } from '../../../configs/threshold.config';
import type { IClsStore } from '../../../types/cls';

@Injectable()
export class UndoRedoStackService {
  constructor(
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService,
    @ThresholdConfig() private readonly thresholdConfig: IThresholdConfig
  ) {}

  private async getUndoStack(userId: string, tableId: string, windowId: string) {
    return (await this.cacheService.get(`operations:undo:${userId}:${tableId}:${windowId}`)) || [];
  }

  private async getRedoStack(userId: string, tableId: string, windowId: string) {
    return (await this.cacheService.get(`operations:redo:${userId}:${tableId}:${windowId}`)) || [];
  }

  private async setUndoStack(
    userId: string,
    tableId: string,
    windowId: string,
    undoStack: IUndoRedoOperation[]
  ) {
    await this.cacheService.set(
      `operations:undo:${userId}:${tableId}:${windowId}`,
      undoStack,
      this.thresholdConfig.undoExpirationTime
    );
  }

  private async setRedoStack(
    userId: string,
    tableId: string,
    windowId: string,
    redoStack: IUndoRedoOperation[]
  ) {
    await this.cacheService.set(
      `operations:redo:${userId}:${tableId}:${windowId}`,
      redoStack,
      this.thresholdConfig.undoExpirationTime
    );
  }

  async push(tableId: string, windowId: string, operation: IUndoRedoOperation): Promise<void> {
    const userId = this.cls.get('user.id');
    const maxUndoStackSize = this.thresholdConfig.maxUndoStackSize;
    let undoStack = await this.getUndoStack(userId, tableId, windowId);

    undoStack.push(operation);
    if (undoStack.length > this.thresholdConfig.maxUndoStackSize) {
      undoStack = undoStack.slice(-maxUndoStackSize);
    }

    await this.setUndoStack(userId, tableId, windowId, undoStack);

    // Clear redo stack when a new operation is pushed
    await this.cacheService.del(`operations:redo:${userId}:${tableId}:${windowId}`);
  }

  async undo(tableId: string, windowId: string): Promise<IUndoVo> {
    const userId = this.cls.get('user.id');
    const undoStack = await this.getUndoStack(userId, tableId, windowId);
    const redoStack = await this.getRedoStack(userId, tableId, windowId);

    const operation = undoStack.pop();

    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      redoStack.push(operation);

      await this.setUndoStack(userId, tableId, windowId, undoStack);
      await this.setRedoStack(userId, tableId, windowId, redoStack);
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
    const userId = this.cls.get('user.id');
    const undoStack = await this.getUndoStack(userId, tableId, windowId);
    const redoStack = await this.getRedoStack(userId, tableId, windowId);

    const operation = redoStack.pop();

    if (!operation) {
      return {
        status: 'empty',
      };
    }

    try {
      undoStack.push(operation);

      await this.setUndoStack(userId, tableId, windowId, undoStack);
      await this.setRedoStack(userId, tableId, windowId, redoStack);
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
