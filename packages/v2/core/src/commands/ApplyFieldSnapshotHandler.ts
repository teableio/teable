import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldUndoRedoReplayService } from '../application/services/FieldUndoRedoReplayService';
import type { DomainError } from '../domain/shared/DomainError';
import type { Table } from '../domain/table/Table';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { ApplyFieldSnapshotCommand } from './ApplyFieldSnapshotCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';

export class ApplyFieldSnapshotResult {
  private constructor(readonly table: Table) {}

  static create(table: Table): ApplyFieldSnapshotResult {
    return new ApplyFieldSnapshotResult(table);
  }
}

@CommandHandler(ApplyFieldSnapshotCommand)
@injectable()
export class ApplyFieldSnapshotHandler
  implements ICommandHandler<ApplyFieldSnapshotCommand, ApplyFieldSnapshotResult>
{
  constructor(
    @inject(v2CoreTokens.fieldUndoRedoReplayService)
    private readonly fieldUndoRedoReplayService: FieldUndoRedoReplayService
  ) {}

  @TraceSpan({
    attributes: (_context, command: ApplyFieldSnapshotCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      [TeableSpanAttributes.FIELD_ID]: command.snapshot.field.id,
      'teable.undo_redo.command_type': 'ApplyFieldSnapshot',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyFieldSnapshotCommand
  ): Promise<Result<ApplyFieldSnapshotResult, DomainError>> {
    const handler = this;
    return safeTry<ApplyFieldSnapshotResult, DomainError>(async function* () {
      const table = yield* await handler.fieldUndoRedoReplayService.replay(context, {
        baseId: command.baseId.toString(),
        tableId: command.tableId.toString(),
        snapshot: command.snapshot,
      });

      return ok(ApplyFieldSnapshotResult.create(table));
    });
  }
}
