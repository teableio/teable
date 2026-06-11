import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { ICommandBus } from '../ports/CommandBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { ITableRepository } from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import {
  composeUndoRedoCommands,
  createUndoRedoCommand,
  flattenUndoRedoCommands,
  type UndoRedoCommandLeafData,
} from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteFieldCommand } from './DeleteFieldCommand';
import { type DeleteFieldResult } from './DeleteFieldHandler';
import { DeleteFieldsCommand } from './DeleteFieldsCommand';

export class DeleteFieldsResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): DeleteFieldsResult {
    return new DeleteFieldsResult(table, [...events]);
  }
}

@CommandHandler(DeleteFieldsCommand)
@injectable()
export class DeleteFieldsHandler
  implements ICommandHandler<DeleteFieldsCommand, DeleteFieldsResult>
{
  constructor(
    @inject(v2CoreTokens.commandBus)
    private readonly commandBus: ICommandBus,
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: ITableRepository,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteFieldsCommand
  ): Promise<Result<DeleteFieldsResult, DomainError>> {
    const handler = this;
    return safeTry<DeleteFieldsResult, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      const targetFieldIds = new Set(command.fieldIds.map((fieldId) => fieldId.toString()));
      const relatedUndoSnapshotKeys = new Set<string>();
      const targetUndoLeaves: UndoRedoCommandLeafData[] = [];
      const relatedUndoLeaves: UndoRedoCommandLeafData[] = [];
      let latestTable: Table | undefined;

      const tableSpec = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const initialTable = yield* await handler.tableRepository.findOne(context, tableSpec);

      for (const fieldId of command.fieldIds) {
        const snapshot = yield* await handler.fieldUndoRedoSnapshotService.capture(
          context,
          initialTable,
          fieldId
        );
        targetUndoLeaves.push(
          createUndoRedoCommand('ApplyFieldSnapshot', {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            snapshot,
          })
        );
      }

      for (const fieldId of command.fieldIds) {
        const nestedCommand = yield* DeleteFieldCommand.create(
          {
            baseId: command.baseId.toString(),
            tableId: command.tableId.toString(),
            fieldId: fieldId.toString(),
          },
          { skipUndoRedo: true }
        );

        const nestedResult = yield* await handler.commandBus.execute<
          DeleteFieldCommand,
          DeleteFieldResult
        >(context, nestedCommand);

        latestTable = nestedResult.table;
        events.push(...nestedResult.events);
        for (const leaf of flattenUndoRedoCommands(nestedResult.undoCommand)) {
          if (leaf.type !== 'ApplyFieldSnapshot') {
            continue;
          }
          const snapshotFieldId = leaf.payload.snapshot.field.id;
          if (targetFieldIds.has(snapshotFieldId)) {
            continue;
          }
          const snapshotKey = `${leaf.payload.baseId}:${leaf.payload.tableId}:${snapshotFieldId}`;
          if (relatedUndoSnapshotKeys.has(snapshotKey)) {
            continue;
          }
          relatedUndoSnapshotKeys.add(snapshotKey);
          relatedUndoLeaves.push(leaf);
        }
      }

      if (!latestTable) {
        return err(domainError.validation({ message: 'DeleteFieldsCommand requires field ids' }));
      }

      const redoLeaves = command.fieldIds.map((fieldId) =>
        createUndoRedoCommand('DeleteField', {
          baseId: command.baseId.toString(),
          tableId: command.tableId.toString(),
          fieldId: fieldId.toString(),
        })
      );

      yield* await handler.undoRedoStackService.appendEntry(
        toUndoRedoStackAppendContext(context),
        latestTable.id(),
        {
          undoCommand: composeUndoRedoCommands([...targetUndoLeaves, ...relatedUndoLeaves]),
          redoCommand: composeUndoRedoCommands(redoLeaves),
        }
      );

      return ok(DeleteFieldsResult.create(latestTable, events));
    });
  }
}
