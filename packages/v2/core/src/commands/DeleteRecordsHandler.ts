import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { requireStoredRecordSnapshots } from '../application/services/RecordMutationSnapshotContract';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { IDeletedRecordSnapshot } from '../domain/table/events/RecordsDeleted';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteRecordsCommand } from './DeleteRecordsCommand';
import { buildDeletedRecordSnapshot } from './shared/buildDeletedRecordSnapshot';
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
    private readonly undoRedoStackService: UndoRedoStackService,
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
      const scopedSnapshots =
        pluginRecordSpec != null
          ? yield* await handler.tableRecordQueryRepository.find(context, table, deleteSpec, {
              mode: 'stored',
            })
          : undefined;

      if (pluginRecordSpec && scopedSnapshots && scopedSnapshots.records.length > 0) {
        let authorizedRecordCount = 0;
        for (const readModel of scopedSnapshots.records) {
          const tableRecord = yield* toTableRecord(table, readModel);
          if (pluginRecordSpec.isSatisfiedBy(tableRecord)) {
            authorizedRecordCount += 1;
          }
        }

        if (authorizedRecordCount !== scopedSnapshots.records.length) {
          return err(
            domainError.forbidden({
              code: 'record_write_plugin.scope_forbidden',
              message: 'Record write target includes rows outside the allowed scope.',
              details: {
                operation: RecordWriteOperationKind.deleteMany,
                tableId: table.id().toString(),
                requestedRecordCount: scopedSnapshots.records.length,
                authorizedRecordCount,
              },
            })
          );
        }
      }
      const scopedDeleteSpec =
        composeRecordConditionSpecs(deleteSpec, pluginRecordSpec) ?? deleteSpec;
      let deleteReportedNotFound = false;

      const deleteResult =
        yield* await handler.unitOfWork.withTransaction<TableRecordRepositoryPort.DeleteManyResult>(
          context,
          async (transactionContext) => {
            const pluginBeforePersist = await pluginExecution.beforePersist(transactionContext);
            if (pluginBeforePersist.isErr()) {
              return err(pluginBeforePersist.error);
            }
            const deleteResult = await handler.tableRecordRepository.deleteMany(
              transactionContext,
              table,
              scopedDeleteSpec
            );

            if (deleteResult.isErr()) {
              if (isNotFoundError(deleteResult.error)) {
                deleteReportedNotFound = true;
                return ok<TableRecordRepositoryPort.DeleteManyResult>({});
              }
              return err(deleteResult.error);
            }

            return ok(deleteResult.value);
          }
        );

      const expectedSnapshotCount = scopedSnapshots?.records.length;
      const persistedDeletedSnapshots = deleteResult.deletedRecords;
      if (deleteReportedNotFound || (expectedSnapshotCount === 0 && !persistedDeletedSnapshots)) {
        await pluginExecution.afterCommit();
        return ok(DeleteRecordsResult.create([], []));
      }

      const storedSnapshotsResult = requireStoredRecordSnapshots(
        {
          operation: 'delete',
          tableId: table.id().toString(),
          ...(expectedSnapshotCount !== undefined ? { expectedCount: expectedSnapshotCount } : {}),
        },
        persistedDeletedSnapshots
      );
      if (storedSnapshotsResult.isErr()) {
        return err(storedSnapshotsResult.error);
      }

      const recordSnapshots: IDeletedRecordSnapshot[] = storedSnapshotsResult.value.map(
        (snapshot) => buildDeletedRecordSnapshot(table, snapshot)
      );
      const deletedRecordIds = recordSnapshots.map((snapshot) => snapshot.id);

      const events: IDomainEvent[] = [
        RecordsDeleted.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordIds: deletedRecordIds.map((id) => RecordId.create(id)._unsafeUnwrap()),
          recordSnapshots,
          orchestration: {
            operationId: context.requestId,
            totalRecordCount: deletedRecordIds.length,
            totalChunkCount: 1,
            chunkIndex: 0,
            scope: 'operation',
          },
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

      if (recordSnapshots.length > 0) {
        yield* await handler.undoRedoStackService.appendRecordDelete(
          toUndoRedoStackAppendContext(context),
          {
            tableId: table.id(),
            deletedRecords: recordSnapshots.map((snapshot) => ({
              recordId: snapshot.id,
              fields: snapshot.fields,
              ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
              ...(snapshot.orders ? { orders: snapshot.orders } : {}),
              ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
              ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
              ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
              ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
              ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
            })),
          }
        );
      }
      await pluginExecution.afterCommit();

      return ok(DeleteRecordsResult.create(deletedRecordIds, events));
    });
  }
}
