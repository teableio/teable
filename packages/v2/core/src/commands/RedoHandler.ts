import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  toUndoRedoStackReplayContext,
  UndoRedoStackService,
  type UndoRedoReplayResult,
} from '../application/services/UndoRedoStackService';
import type { DomainError } from '../domain/shared/DomainError';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RedoCommand } from './RedoCommand';

export class RedoResult {
  private constructor(readonly replay: UndoRedoReplayResult | null) {}

  static create(replay: UndoRedoReplayResult | null): RedoResult {
    return new RedoResult(replay);
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
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<RedoResult, DomainError>(async function* () {
      const replay = yield* await handler.undoRedoStackService.applyRedo(
        toUndoRedoStackReplayContext(context),
        command.tableId,
        command.windowId
      );
      return ok(RedoResult.create(replay));
    });
  }
}
