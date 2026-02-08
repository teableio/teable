import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { DeleteRecordsCommand } from '../../commands/DeleteRecordsCommand';
import { RestoreRecordsCommand } from '../../commands/RestoreRecordsCommand';
import { UpdateRecordCommand } from '../../commands/UpdateRecordCommand';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { TableId } from '../../domain/table/TableId';
import { ICommandBus } from '../../ports/CommandBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { IUndoRedoStore } from '../../ports/UndoRedoStore';
import type {
  UndoEntry,
  UndoRedoCommandData,
  UndoRedoUpdateCommandData,
  UndoScope,
} from '../../ports/UndoRedoStore';

export type RecordUpdateUndoRedoInput = {
  readonly tableId: TableId;
  readonly recordId: RecordId;
  readonly oldValues: Record<string, unknown>;
  readonly newValues: Record<string, unknown>;
  readonly recordVersionBefore: number;
  readonly recordVersionAfter: number;
};

@injectable()
export class UndoRedoService {
  constructor(
    @inject(v2CoreTokens.undoRedoStore)
    private readonly undoRedoStore: IUndoRedoStore,
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: ICommandBus
  ) {}

  async recordUpdateRecord(
    context: IExecutionContext,
    params: RecordUpdateUndoRedoInput
  ): Promise<Result<void, DomainError>> {
    if (Object.keys(params.oldValues).length === 0) {
      return ok(undefined);
    }

    const basePayload = {
      tableId: params.tableId.toString(),
      recordId: params.recordId.toString(),
      fieldKeyType: FieldKeyType.Id,
      typecast: false,
    } as const;

    const undoCommand: UndoRedoUpdateCommandData = {
      type: 'UpdateRecord',
      version: 1,
      payload: {
        ...basePayload,
        fields: params.oldValues,
      },
    };

    const redoCommand: UndoRedoUpdateCommandData = {
      type: 'UpdateRecord',
      version: 1,
      payload: {
        ...basePayload,
        fields: params.newValues,
      },
    };

    const entry: Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'> = {
      undoCommand,
      redoCommand,
      recordVersionBefore: params.recordVersionBefore,
      recordVersionAfter: params.recordVersionAfter,
    };
    return this.recordEntry(context, params.tableId, entry);
  }

  async recordEntry(
    context: IExecutionContext,
    tableId: TableId,
    entry: Omit<UndoEntry, 'scope' | 'createdAt' | 'requestId'>
  ): Promise<Result<void, DomainError>> {
    if (context.undoRedo?.mode === 'undo' || context.undoRedo?.mode === 'redo') {
      return ok(undefined);
    }

    if (!context.windowId) {
      return ok(undefined);
    }

    if (this.isEmptyCommand(entry.undoCommand) && this.isEmptyCommand(entry.redoCommand)) {
      return ok(undefined);
    }

    const scope: UndoScope = {
      actorId: context.actorId,
      tableId,
      windowId: context.windowId,
    };

    const entryWithScope: UndoEntry = {
      ...entry,
      scope,
      createdAt: new Date().toISOString(),
      requestId: context.requestId,
    };

    const appendResult = await this.undoRedoStore.append(scope, entryWithScope);
    if (appendResult.isErr()) {
      return err(appendResult.error);
    }
    return ok(undefined);
  }

  async undo(
    context: IExecutionContext,
    tableId: TableId,
    windowId?: string
  ): Promise<Result<UndoEntry | null, DomainError>> {
    return this.applyEntry(context, tableId, windowId, 'undo');
  }

  async redo(
    context: IExecutionContext,
    tableId: TableId,
    windowId?: string
  ): Promise<Result<UndoEntry | null, DomainError>> {
    return this.applyEntry(context, tableId, windowId, 'redo');
  }

  private async applyEntry(
    context: IExecutionContext,
    tableId: TableId,
    windowId: string | undefined,
    mode: 'undo' | 'redo'
  ): Promise<Result<UndoEntry | null, DomainError>> {
    const service = this;
    return safeTry<UndoEntry | null, DomainError>(async function* () {
      const scope = yield* service.resolveScope(context, tableId, windowId);
      const entry =
        mode === 'undo'
          ? yield* await service.undoRedoStore.undo(scope)
          : yield* await service.undoRedoStore.redo(scope);

      if (!entry) return ok(null);

      const commandData = mode === 'undo' ? entry.undoCommand : entry.redoCommand;

      const executeContext: IExecutionContext = {
        ...context,
        undoRedo: { mode },
      };

      yield* await service.executeCommandData(executeContext, commandData);

      return ok(entry);
    });
  }

  private createCommand(commandData: UndoRedoCommandData): Result<unknown, DomainError> {
    switch (commandData.type) {
      case 'UpdateRecord': {
        if (commandData.version !== 1) {
          return err(
            domainError.validation({
              message: `Unsupported undo/redo command version: ${commandData.version}`,
            })
          );
        }
        return UpdateRecordCommand.create(commandData.payload);
      }
      case 'DeleteRecords': {
        if (commandData.version !== 1) {
          return err(
            domainError.validation({
              message: `Unsupported undo/redo command version: ${commandData.version}`,
            })
          );
        }
        return DeleteRecordsCommand.create(commandData.payload);
      }
      case 'RestoreRecords': {
        if (commandData.version !== 1) {
          return err(
            domainError.validation({
              message: `Unsupported undo/redo command version: ${commandData.version}`,
            })
          );
        }
        return RestoreRecordsCommand.create(commandData.payload);
      }
      case 'Batch': {
        return err(domainError.validation({ message: 'Batch undo/redo command must be expanded' }));
      }
      default:
        return err(
          domainError.validation({
            message: 'Unsupported undo/redo command type',
          })
        );
    }
  }

  private async executeCommandData(
    context: IExecutionContext,
    commandData: UndoRedoCommandData
  ): Promise<Result<void, DomainError>> {
    if (commandData.type === 'Batch') {
      if (commandData.version !== 1) {
        return err(
          domainError.validation({
            message: `Unsupported undo/redo command version: ${commandData.version}`,
          })
        );
      }
      for (const nested of commandData.payload) {
        const nestedResult = await this.executeCommandData(context, nested);
        if (nestedResult.isErr()) {
          return err(nestedResult.error);
        }
      }
      return ok(undefined);
    }

    const command = this.createCommand(commandData);
    if (command.isErr()) {
      return err(command.error);
    }

    const executeResult = await this.commandBus.execute(context, command.value);
    if (executeResult.isErr()) {
      return err(executeResult.error);
    }
    return ok(undefined);
  }

  private isEmptyCommand(command: UndoRedoCommandData): boolean {
    if (command.type !== 'Batch') return false;
    return command.payload.length === 0;
  }

  private resolveScope(
    context: IExecutionContext,
    tableId: TableId,
    windowId?: string
  ): Result<UndoScope, DomainError> {
    const resolvedWindowId = windowId ?? context.windowId;
    if (!resolvedWindowId) {
      return err(domainError.validation({ message: 'Missing windowId for undo/redo operation' }));
    }
    return ok({ actorId: context.actorId, tableId, windowId: resolvedWindowId });
  }
}
