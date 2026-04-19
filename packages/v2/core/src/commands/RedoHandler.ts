import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  toUndoRedoStackReplayContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import type { DomainError } from '../domain/shared/DomainError';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import type { UndoEntry } from '../ports/UndoRedoStore';
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
    private readonly undoRedoStackService: UndoRedoStackService
  ) {}

  @TraceSpan({
    attributes: (context, command: RedoCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      'teable.window_id': command.windowId ?? context.windowId ?? 'missing',
      'teable.undo_redo.mode': 'redo',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RedoCommand
  ): Promise<Result<RedoResult, DomainError>> {
    const handler = this;
    return safeTry<RedoResult, DomainError>(async function* () {
      const entry = yield* await handler.undoRedoStackService.applyRedo(
        toUndoRedoStackReplayContext(context),
        command.tableId,
        command.windowId
      );
      return ok(RedoResult.create(entry));
    });
  }
}
