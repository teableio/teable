/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import type { IRedoVo, IUndoVo } from '@teable/openapi';
import { RedoCommand, RedoResult, UndoCommand, UndoResult, v2CoreTokens } from '@teable/v2-core';
import type { ICommandBus } from '@teable/v2-core';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';

export const X_TEABLE_UNDO_REDO_ENGINE_HEADER = 'x-teable-undo-redo-engine';

export type UndoRedoEngine = 'v1' | 'v2';

type UndoRedoResponse<T extends IUndoVo | IRedoVo> = {
  body: T;
  engine: UndoRedoEngine;
};

@Injectable()
export class UndoRedoService {
  logger = new Logger(UndoRedoService.name);
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService
  ) {}

  async undo(tableId: string, windowId: string): Promise<UndoRedoResponse<IUndoVo>> {
    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'undo');
    if (v2Result) {
      return v2Result;
    }

    const { operation, push } = await this.undoRedoStackService.popUndo(tableId, windowId);

    if (!operation) {
      return {
        body: {
          status: 'empty',
        },
        engine: 'v1',
      };
    }

    try {
      const newOperation = await this.undoRedoOperationService.undo(operation);
      await push(newOperation);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v1',
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v1',
      };
    }

    return {
      body: {
        status: 'fulfilled',
      },
      engine: 'v1',
    };
  }

  async redo(tableId: string, windowId: string): Promise<UndoRedoResponse<IRedoVo>> {
    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'redo');
    if (v2Result) {
      return v2Result;
    }

    const { operation, push } = await this.undoRedoStackService.popRedo(tableId, windowId);
    if (!operation) {
      return {
        body: {
          status: 'empty',
        },
        engine: 'v1',
      };
    }

    try {
      const newOperation = await this.undoRedoOperationService.redo(operation);
      await push(newOperation);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v1',
        };
      }
      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v1',
      };
    }

    return {
      body: {
        status: 'fulfilled',
      },
      engine: 'v1',
    };
  }

  private async executeV2UndoRedo(
    tableId: string,
    windowId: string,
    mode: 'undo' | 'redo'
  ): Promise<UndoRedoResponse<IUndoVo | IRedoVo> | undefined> {
    try {
      const container = await this.v2ContainerService.getContainer();
      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const context = await this.v2ContextFactory.createContext();
      context.windowId = windowId;

      const commandResult =
        mode === 'undo'
          ? UndoCommand.create({ tableId, windowId })
          : RedoCommand.create({ tableId, windowId });

      if (commandResult.isErr()) {
        return {
          body: {
            status: 'failed',
            errorMessage: commandResult.error.message,
          },
          engine: 'v2',
        };
      }

      const executeResult = await commandBus.execute<
        UndoCommand | RedoCommand,
        UndoResult | RedoResult
      >(context, commandResult.value);
      if (executeResult.isErr()) {
        return {
          body: {
            status: 'failed',
            errorMessage: executeResult.error.message,
          },
          engine: 'v2',
        };
      }

      if (!executeResult.value.entry) {
        return undefined;
      }

      return {
        body: {
          status: 'fulfilled',
        },
        engine: 'v2',
      };
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(error.message, error.stack);
        return {
          body: {
            status: 'failed',
            errorMessage: error.message,
          },
          engine: 'v2',
        };
      }

      this.logger.error('An unknown error occurred');
      return {
        body: {
          status: 'failed',
          errorMessage: 'An unknown error occurred',
        },
        engine: 'v2',
      };
    }
  }
}
