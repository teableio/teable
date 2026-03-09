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
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ReplayFieldTypeConversionCommand } from './ReplayFieldTypeConversionCommand';

export class ReplayFieldTypeConversionResult {
  private constructor(readonly table: Table) {}

  static create(table: Table): ReplayFieldTypeConversionResult {
    return new ReplayFieldTypeConversionResult(table);
  }
}

@CommandHandler(ReplayFieldTypeConversionCommand)
@injectable()
export class ReplayFieldTypeConversionHandler
  implements ICommandHandler<ReplayFieldTypeConversionCommand, ReplayFieldTypeConversionResult>
{
  constructor(
    @inject(v2CoreTokens.fieldUndoRedoReplayService)
    private readonly fieldUndoRedoReplayService: FieldUndoRedoReplayService
  ) {}

  @TraceSpan({
    attributes: (_context, command: ReplayFieldTypeConversionCommand) => ({
      [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      [TeableSpanAttributes.FIELD_ID]: command.snapshot.field.id,
      'teable.undo_redo.command_type': 'ReplayFieldTypeConversion',
    }),
  })
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ReplayFieldTypeConversionCommand
  ): Promise<Result<ReplayFieldTypeConversionResult, DomainError>> {
    const handler = this;
    return safeTry<ReplayFieldTypeConversionResult, DomainError>(async function* () {
      const table = yield* await handler.fieldUndoRedoReplayService.replay(context, {
        baseId: command.baseId.toString(),
        tableId: command.tableId.toString(),
        snapshot: command.snapshot,
      });

      return ok(ReplayFieldTypeConversionResult.create(table));
    });
  }
}
