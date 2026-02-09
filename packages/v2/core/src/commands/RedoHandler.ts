import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { UndoRedoService } from '../application/services/UndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { UndoEntry } from '../ports/UndoRedoStore';
import { v2CoreTokens } from '../ports/tokens';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RedoCommand } from './RedoCommand';

export class RedoResult {
  private constructor(readonly entry: UndoEntry | null) {}

  static create(entry: UndoEntry | null): RedoResult {
    return new RedoResult(entry);
  }
}

@CommandHandler(RedoCommand)
@injectable()
export class RedoHandler implements ICommandHandler<RedoCommand, RedoResult> {
  constructor(
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService
  ) {}

  async handle(
    context: IExecutionContext,
    command: RedoCommand
  ): Promise<Result<RedoResult, DomainError>> {
    const handler = this;
    return safeTry<RedoResult, DomainError>(async function* () {
      const entry = yield* await handler.undoRedoService.redo(
        context,
        command.tableId,
        command.windowId
      );
      return ok(RedoResult.create(entry));
    });
  }
}
