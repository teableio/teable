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
    private readonly undoRedoStackService: UndoRedoStackService
  ) {}

  @TraceSpan({
    attributes: (context, command: UndoCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      'teable.window_id': command.windowId ?? context.windowId ?? 'missing',
      'teable.undo_redo.mode': 'undo',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UndoCommand
  ): Promise<Result<UndoResult, DomainError>> {
    const handler = this;
    return safeTry<UndoResult, DomainError>(async function* () {
      const entry = yield* await handler.undoRedoStackService.applyUndo(
        toUndoRedoStackReplayContext(context),
        command.tableId,
        command.windowId
      );
      return ok(UndoResult.create(entry));
    });
  }
}
