import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import { UndoRedoService } from '../application/services/UndoRedoService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IDeletedRecordSnapshot } from '../domain/table/events/RecordsDeleted';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteRecordsCommand } from './DeleteRecordsCommand';
import { composeRecordConditionSpecs } from './shared/recordWriteScope';
import { toTableRecord } from './shared/toTableRecord';

export class DeleteRecordsResult {
  private constructor(
    readonly deletedRecordIds: ReadonlyArray<string>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(deletedRecordIds: ReadonlyArray<string>, events: ReadonlyArray<IDomainEvent>) {
    return new DeleteRecordsResult([...deletedRecordIds], [...events]);
  }
}

@CommandHandler(DeleteRecordsCommand)
@injectable()
export class DeleteRecordsHandler
  implements ICommandHandler<DeleteRecordsCommand, DeleteRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteRecordsCommand
  ): Promise<Result<DeleteRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<DeleteRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.deleteMany,
        executionContext: context,
        table,
        payload: {
          recordIds: command.recordIds,
          recordCount: command.recordIds.length,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const pluginRecordSpec = yield* pluginExecution.getRecordSpec();

      const deleteSpec = RecordByIdsSpec.create(command.recordIds);

      // Query records before deletion to capture snapshots for undo/redo support
      const queryResult = yield* await handler.tableRecordQueryRepository.find(
        context,
        table,
        deleteSpec,
        { mode: 'stored', includeOrders: true }
      );

      const recordSnapshots: IDeletedRecordSnapshot[] = queryResult.records.map((record) => ({
        id: record.id,
        fields: record.fields,
        autoNumber: record.autoNumber,
        createdTime: record.createdTime,
        createdBy: record.createdBy,
        lastModifiedTime: record.lastModifiedTime,
        lastModifiedBy: record.lastModifiedBy,
        orders: record.orders,
      }));

      const existingRecordIds = queryResult.records.map((record) => record.id);
      if (pluginRecordSpec && existingRecordIds.length > 0) {
        let authorizedRecordCount = 0;
        for (const readModel of queryResult.records) {
          const tableRecord = yield* toTableRecord(table, readModel);
          if (pluginRecordSpec.isSatisfiedBy(tableRecord)) {
            authorizedRecordCount += 1;
          }
        }

        if (authorizedRecordCount !== existingRecordIds.length) {
          return err(
            domainError.forbidden({
              code: 'record_write_plugin.scope_forbidden',
              message: 'Record write target includes rows outside the allowed scope.',
              details: {
                operation: RecordWriteOperationKind.deleteMany,
                tableId: table.id().toString(),
                requestedRecordCount: existingRecordIds.length,
                authorizedRecordCount,
              },
            })
          );
        }
      }
      const scopedDeleteSpec =
        composeRecordConditionSpecs(deleteSpec, pluginRecordSpec) ?? deleteSpec;

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        const pluginBeforePersist = await pluginExecution.beforePersist(transactionContext);
        if (pluginBeforePersist.isErr()) {
          return pluginBeforePersist;
        }
        const deleteResult = await handler.tableRecordRepository.deleteMany(
          transactionContext,
          table,
          scopedDeleteSpec
        );

        if (deleteResult.isErr()) {
          if (isNotFoundError(deleteResult.error)) return ok(undefined);
          return err(deleteResult.error);
        }

        return ok(undefined);
      });

      const events: IDomainEvent[] = [
        RecordsDeleted.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordIds: command.recordIds,
          recordSnapshots,
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

      const restoreRecords = recordSnapshots.map((snapshot) => ({
        recordId: snapshot.id,
        fields: snapshot.fields,
        orders: snapshot.orders,
        autoNumber: snapshot.autoNumber,
        createdTime: snapshot.createdTime,
        createdBy: snapshot.createdBy,
        lastModifiedTime: snapshot.lastModifiedTime,
        lastModifiedBy: snapshot.lastModifiedBy,
      }));

      if (restoreRecords.length > 0) {
        yield* await handler.undoRedoService.recordEntry(context, table.id(), {
          undoCommand: createUndoRedoCommand('RestoreRecords', {
            tableId: table.id().toString(),
            records: restoreRecords,
          }),
          redoCommand: createUndoRedoCommand('DeleteRecords', {
            tableId: table.id().toString(),
            recordIds: restoreRecords.map((record) => record.recordId),
          }),
        });
      }
      await pluginExecution.afterCommit();

      return ok(
        DeleteRecordsResult.create(
          command.recordIds.map((id) => id.toString()),
          events
        )
      );
    });
  }
}
