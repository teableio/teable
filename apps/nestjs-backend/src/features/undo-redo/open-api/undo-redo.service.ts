/* eslint-disable sonarjs/no-duplicate-string */
import { Injectable, Logger } from '@nestjs/common';
import type { IRedoVo, IUndoRedoStreamEvent, IUndoVo } from '@teable/openapi';
import {
  RedoCommand,
  TableId,
  toUndoRedoStackReplayContext,
  UndoCommand,
  v2CoreTokens,
} from '@teable/v2-core';
import type {
  ICommandBus,
  RedoResult,
  UndoRedoStackService as V2UndoRedoStackService,
  UndoResult,
} from '@teable/v2-core';
import { ClsService } from 'nestjs-cls';
import { CacheService } from '../../../cache/cache.service';
import type { ICacheStore } from '../../../cache/types';
import type { IClsStore } from '../../../types/cls';
import { V2ContainerService } from '../../v2/v2-container.service';
import { V2ExecutionContextFactory } from '../../v2/v2-execution-context.factory';
import { UndoRedoOperationService } from '../stack/undo-redo-operation.service';
import { UndoRedoStackService } from '../stack/undo-redo-stack.service';
import { buildUndoRedoEnginePreferenceKey } from './undo-redo-engine-preference';

export const X_TEABLE_UNDO_REDO_ENGINE_HEADER = 'x-teable-undo-redo-engine';

export type IUndoRedoEngine = 'v1' | 'v2';

type IUndoRedoResponse<T extends IUndoVo | IRedoVo> = {
  body: T;
  engine: IUndoRedoEngine;
};

type IUndoRedoMode = 'undo' | 'redo';

class UndoRedoStreamQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly resolvers: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T) {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ value, done: false });
      return;
    }
    this.values.push(value);
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.resolvers.length) {
      this.resolvers.shift()?.({ value: undefined as T, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: async () => {
        const value = this.values.shift();
        if (value) {
          return { value, done: false };
        }
        if (this.closed) {
          return { value: undefined as T, done: true };
        }
        return await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: async () => {
        this.close();
        return { value: undefined as T, done: true };
      },
    };
  }
}

@Injectable()
export class UndoRedoService {
  logger = new Logger(UndoRedoService.name);
  constructor(
    private readonly v2ContainerService: V2ContainerService,
    private readonly v2ContextFactory: V2ExecutionContextFactory,
    private readonly cls: ClsService<IClsStore>,
    private readonly cacheService: CacheService<ICacheStore>,
    private readonly undoRedoStackService: UndoRedoStackService,
    private readonly undoRedoOperationService: UndoRedoOperationService
  ) {}

  async undo(tableId: string, windowId: string): Promise<IUndoRedoResponse<IUndoVo>> {
    const preferredEngine = await this.getPreferredEngine(tableId, windowId);
    if (preferredEngine === 'v1') {
      const v1Result = await this.executeV1Undo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        return v1Result;
      }

      const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'undo');
      if (v2Result) {
        return v2Result;
      }

      return v1Result;
    }

    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'undo');
    if (v2Result) {
      return v2Result;
    }

    return this.executeV1Undo(tableId, windowId);
  }

  async redo(tableId: string, windowId: string): Promise<IUndoRedoResponse<IRedoVo>> {
    const preferredEngine = await this.getPreferredEngine(tableId, windowId);
    if (preferredEngine === 'v1') {
      const v1Result = await this.executeV1Redo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        return v1Result;
      }

      const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'redo');
      if (v2Result) {
        return v2Result;
      }

      return v1Result;
    }

    const v2Result = await this.executeV2UndoRedo(tableId, windowId, 'redo');
    if (v2Result) {
      return v2Result;
    }

    return this.executeV1Redo(tableId, windowId);
  }

  async *undoStream(tableId: string, windowId: string): AsyncIterable<IUndoRedoStreamEvent> {
    yield* this.executeUndoRedoStream(tableId, windowId, 'undo');
  }

  async *redoStream(tableId: string, windowId: string): AsyncIterable<IUndoRedoStreamEvent> {
    yield* this.executeUndoRedoStream(tableId, windowId, 'redo');
  }

  private async *executeUndoRedoStream(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode
  ): AsyncIterable<IUndoRedoStreamEvent> {
    const preferredEngine = await this.getPreferredEngine(tableId, windowId);

    if (preferredEngine === 'v1') {
      const v1Result =
        mode === 'undo'
          ? await this.executeV1Undo(tableId, windowId)
          : await this.executeV1Redo(tableId, windowId);
      if (v1Result.body.status !== 'empty') {
        yield this.toStreamTerminalEvent(mode, v1Result);
        return;
      }
      yield* this.executeV2UndoRedoStream(tableId, windowId, mode);
      return;
    }

    for await (const event of this.executeV2UndoRedoStream(tableId, windowId, mode)) {
      if (event.id === 'done' && event.status === 'empty') {
        const v1Result =
          mode === 'undo'
            ? await this.executeV1Undo(tableId, windowId)
            : await this.executeV1Redo(tableId, windowId);
        yield this.toStreamTerminalEvent(mode, v1Result);
        return;
      }
      yield event;
    }
  }

  private getPreferenceKey(
    tableId: string,
    windowId: string
  ): ReturnType<typeof buildUndoRedoEnginePreferenceKey> | null {
    const userId = this.cls.get('user.id');
    if (!userId || !windowId) {
      return null;
    }
    return buildUndoRedoEnginePreferenceKey(userId, tableId, windowId);
  }

  private async getPreferredEngine(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoEngine | undefined> {
    const key = this.getPreferenceKey(tableId, windowId);
    if (!key) {
      return undefined;
    }
    return this.cacheService.get(key);
  }

  private async executeV1Undo(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoResponse<IUndoVo>> {
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

  private async executeV1Redo(
    tableId: string,
    windowId: string
  ): Promise<IUndoRedoResponse<IRedoVo>> {
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
  ): Promise<IUndoRedoResponse<IUndoVo | IRedoVo> | undefined> {
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

  private executeV2UndoRedoStream(
    tableId: string,
    windowId: string,
    mode: IUndoRedoMode
  ): AsyncIterable<IUndoRedoStreamEvent> {
    const queue = new UndoRedoStreamQueue<IUndoRedoStreamEvent>();

    void (async () => {
      try {
        const tableIdResult = TableId.create(tableId);
        if (tableIdResult.isErr()) {
          queue.push({
            id: 'error',
            mode,
            engine: 'v2',
            message: tableIdResult.error.message,
          });
          return;
        }

        const container = await this.v2ContainerService.getContainer();
        const stackService = container.resolve<V2UndoRedoStackService>(
          v2CoreTokens.undoRedoService
        );
        const context = await this.v2ContextFactory.createContext();
        context.windowId = windowId;

        const replayContext = toUndoRedoStackReplayContext(context);
        const replayResult =
          mode === 'undo'
            ? await stackService.applyUndo(replayContext, tableIdResult.value, windowId, {
                onProgress: (progress) =>
                  queue.push({
                    id: 'progress',
                    mode,
                    engine: 'v2',
                    ...progress,
                  }),
              })
            : await stackService.applyRedo(replayContext, tableIdResult.value, windowId, {
                onProgress: (progress) =>
                  queue.push({
                    id: 'progress',
                    mode,
                    engine: 'v2',
                    ...progress,
                  }),
              });

        if (replayResult.isErr()) {
          queue.push({
            id: 'error',
            mode,
            engine: 'v2',
            message: replayResult.error.message,
          });
          return;
        }

        queue.push({
          id: 'done',
          mode,
          engine: 'v2',
          status: replayResult.value ? 'fulfilled' : 'empty',
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unknown error occurred';
        if (error instanceof Error) {
          this.logger.error(error.message, error.stack);
        } else {
          this.logger.error('An unknown error occurred');
        }
        queue.push({
          id: 'error',
          mode,
          engine: 'v2',
          message,
        });
      } finally {
        queue.close();
      }
    })();

    return queue;
  }

  private toStreamTerminalEvent(
    mode: IUndoRedoMode,
    response: IUndoRedoResponse<IUndoVo | IRedoVo>
  ): IUndoRedoStreamEvent {
    if (response.body.status === 'failed') {
      return {
        id: 'error',
        mode,
        engine: response.engine,
        message: response.body.errorMessage ?? 'Undo/redo failed',
      };
    }
    return {
      id: 'done',
      mode,
      engine: response.engine,
      status: response.body.status,
    };
  }
}
