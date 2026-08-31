import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { Table } from '../../domain/table/Table';
import { captureViewSnapshot, type ViewSnapshotValue } from '../../domain/table/views/ViewSnapshot';
import type * as ExecutionContextPort from '../../ports/ExecutionContext';
import { v2CoreTokens } from '../../ports/tokens';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  type UndoRedoCommandLeafData,
} from '../../ports/UndoRedoStore';
import { toUndoRedoStackAppendContext, UndoRedoStackService } from './UndoRedoStackService';

const withoutAuditMetadata = ({
  auditMetadata: _auditMetadata,
  ...snapshot
}: ViewSnapshotValue): Omit<ViewSnapshotValue, 'auditMetadata'> => snapshot;

@injectable()
export class ViewUndoRedoService {
  constructor(
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService
  ) {}

  capture(table: Table, viewId: string): Result<ViewSnapshotValue, DomainError> {
    return table.getViewById(viewId).andThen(captureViewSnapshot);
  }

  captureAll(table: Table): Result<ReadonlyArray<ViewSnapshotValue>, DomainError> {
    const snapshots: ViewSnapshotValue[] = [];
    for (const view of table.views()) {
      const snapshotResult = captureViewSnapshot(view);
      if (snapshotResult.isErr()) return err(snapshotResult.error);
      snapshots.push(snapshotResult.value);
    }
    return ok(snapshots);
  }

  async appendCreate(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    snapshot: ViewSnapshotValue
  ): Promise<Result<void, DomainError>> {
    return this.undoRedoStackService.appendEntry(
      toUndoRedoStackAppendContext(context),
      table.id(),
      {
        undoCommand: createUndoRedoCommand('DeleteView', {
          tableId: table.id().toString(),
          viewId: snapshot.id,
        }),
        redoCommand: createUndoRedoCommand('ApplyViewSnapshot', {
          tableId: table.id().toString(),
          snapshot,
        }),
      }
    );
  }

  async appendDelete(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    snapshot: ViewSnapshotValue
  ): Promise<Result<void, DomainError>> {
    return this.undoRedoStackService.appendEntry(
      toUndoRedoStackAppendContext(context),
      table.id(),
      {
        undoCommand: createUndoRedoCommand('ApplyViewSnapshot', {
          tableId: table.id().toString(),
          snapshot,
        }),
        redoCommand: createUndoRedoCommand('DeleteView', {
          tableId: table.id().toString(),
          viewId: snapshot.id,
        }),
      }
    );
  }

  async appendUpdate(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    previousSnapshots: ReadonlyArray<ViewSnapshotValue>,
    nextSnapshots: ReadonlyArray<ViewSnapshotValue>
  ): Promise<Result<void, DomainError>> {
    const previousById = new Map(previousSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const changedPairs = nextSnapshots.flatMap((next) => {
      const previous = previousById.get(next.id);
      if (
        !previous ||
        JSON.stringify(withoutAuditMetadata(previous)) ===
          JSON.stringify(withoutAuditMetadata(next))
      ) {
        return [];
      }
      return [{ previous, next }];
    });
    if (changedPairs.length === 0) return ok(undefined);

    const undoCommands: UndoRedoCommandLeafData[] = changedPairs.map(({ previous }) =>
      createUndoRedoCommand('ApplyViewSnapshot', {
        tableId: table.id().toString(),
        snapshot: previous,
      })
    );
    const redoCommands: UndoRedoCommandLeafData[] = changedPairs.map(({ next }) =>
      createUndoRedoCommand('ApplyViewSnapshot', {
        tableId: table.id().toString(),
        snapshot: next,
      })
    );

    return this.undoRedoStackService.appendEntry(
      toUndoRedoStackAppendContext(context),
      table.id(),
      {
        undoCommand: composeUndoRedoCommands(undoCommands),
        redoCommand: composeUndoRedoCommands(redoCommands),
      }
    );
  }

  async appendShareLifecycle(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    viewId: string,
    action: 'enable' | 'disable'
  ): Promise<Result<void, DomainError>> {
    const payload = { tableId: table.id().toString(), viewId };
    return this.undoRedoStackService.appendEntry(
      toUndoRedoStackAppendContext(context),
      table.id(),
      action === 'enable'
        ? {
            undoCommand: createUndoRedoCommand('DisableViewShare', payload),
            redoCommand: createUndoRedoCommand('EnableViewShare', payload),
          }
        : {
            undoCommand: createUndoRedoCommand('EnableViewShare', payload),
            redoCommand: createUndoRedoCommand('DisableViewShare', payload),
          }
    );
  }
}
