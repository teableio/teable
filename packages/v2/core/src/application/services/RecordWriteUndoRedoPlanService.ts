import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import { RecordWriteSideEffects } from '../../domain/table/fields/visitors/RecordWriteSideEffectVisitor';
import { Table } from '../../domain/table/Table';
import { IExecutionContext } from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import { TraceSpan } from '../../ports/TraceSpan';
import { createUndoRedoCommand, type UndoRedoCommandLeafData } from '../../ports/UndoRedoStore';
import { FieldUndoRedoSnapshotService } from './FieldUndoRedoSnapshotService';

export type RecordWriteUndoRedoPlan = {
  readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
};

@injectable()
export class RecordWriteUndoRedoPlanService {
  constructor(
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  @TraceSpan()
  async captureSelectOptionSideEffects(
    context: IExecutionContext,
    beforeTable: Table,
    afterTable: Table,
    effects: RecordWriteSideEffects
  ): Promise<Result<RecordWriteUndoRedoPlan, DomainError>> {
    const service = this;
    return safeTry<RecordWriteUndoRedoPlan, DomainError>(async function* () {
      // Side effects may contain multiple mutations for the same field across different batches.
      // Undo/redo is intentionally command-scoped: restore each affected field from the table
      // snapshot before the command to the final table snapshot after the command.
      const uniqueFieldIds = [
        ...new Map(effects.map((effect) => [effect.fieldId.toString(), effect.fieldId])).values(),
      ];
      const undoCommands: UndoRedoCommandLeafData[] = [];
      const redoCommands: UndoRedoCommandLeafData[] = [];

      for (const fieldId of uniqueFieldIds) {
        const oldSnapshot = yield* await service.fieldUndoRedoSnapshotService.capture(
          context,
          beforeTable,
          fieldId,
          { includeRecords: false }
        );
        const newSnapshot = yield* await service.fieldUndoRedoSnapshotService.capture(
          context,
          afterTable,
          fieldId,
          { includeRecords: false }
        );

        undoCommands.push(
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: beforeTable.baseId().toString(),
            tableId: beforeTable.id().toString(),
            snapshot: oldSnapshot,
          })
        );
        redoCommands.push(
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: afterTable.baseId().toString(),
            tableId: afterTable.id().toString(),
            snapshot: newSnapshot,
          })
        );
      }

      return ok({ undoCommands, redoCommands });
    });
  }
}
