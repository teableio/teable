import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { UndoRedoService } from '../application/services/UndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import type { UndoEntry } from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UndoCommand } from './UndoCommand';

export class UndoResult {
  private constructor(readonly entry: UndoEntry | null) {}

  static create(entry: UndoEntry | null): UndoResult {
    return new UndoResult(entry);
  }
}

@CommandHandler(UndoCommand)
@injectable()
export class UndoHandler implements ICommandHandler<UndoCommand, UndoResult> {
  constructor(
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService
  ) {}

  async handle(
    context: IExecutionContext,
    command: UndoCommand
  ): Promise<Result<UndoResult, DomainError>> {
    const handler = this;
    return safeTry<UndoResult, DomainError>(async function* () {
      const entry = yield* await handler.undoRedoService.undo(
        context,
        command.tableId,
        command.windowId
      );
      return ok(UndoResult.create(entry));
    });
  }
}
