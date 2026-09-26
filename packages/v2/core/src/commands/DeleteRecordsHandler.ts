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
import { generateUuid } from '../domain/shared/IdGenerator';
import type { IDeletedRecordSnapshot } from '../domain/table/events/RecordsDeleted';
import { RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import {
  domainWrite,
  type IDomainWriteTransaction,
  type NonEmptyDomainEvents,
} from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DeleteRecordsCommand } from './DeleteRecordsCommand';
import { buildDeletedRecordSnapshot } from './shared/buildDeletedRecordSnapshot';
import { persistDeletedTrashMarkers } from './shared/persistDeletedTrashMarkers';
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
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: DeleteRecordsCommand
  ): Promise<Result<DeleteRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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
      const operationId = context.requestId ?? generateUuid();

      const committed =
        yield* await handler.domainWriteTransaction.execute<TableRecordRepositoryPort.DeleteManyResult>(
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
                return ok(domainWrite.unchanged({}));
              }
              return err(deleteResult.error);
            }

            const deletedRecordIds = deleteResult.value.deletedRecords?.map(
              (record) => record.recordId
            );
            if (deletedRecordIds?.length) {
              const markerResult = await persistDeletedTrashMarkers(
                handler.tableRecordRepository,
                transactionContext,
                table,
                {
                  recordIds: deletedRecordIds,
                  createdBy: context.actorId.toString(),
                  createdTime: new Date().toISOString(),
                  operationId,
                }
              );
              if (markerResult.isErr()) {
                return err(markerResult.error);
              }
            }

            const expectedSnapshotCount = scopedSnapshots?.records.length;
            const persistedDeletedSnapshots = deleteResult.value.deletedRecords;
            if (expectedSnapshotCount === 0 && !persistedDeletedSnapshots) {
              return ok(domainWrite.unchanged(deleteResult.value));
            }

            const storedSnapshotsResult = requireStoredRecordSnapshots(
              {
                operation: 'delete',
                tableId: table.id().toString(),
                ...(expectedSnapshotCount !== undefined
                  ? { expectedCount: expectedSnapshotCount }
                  : {}),
              },
              persistedDeletedSnapshots
            );
            if (storedSnapshotsResult.isErr()) {
              return ok(domainWrite.unchanged(deleteResult.value));
            }

            const recordSnapshots: IDeletedRecordSnapshot[] = storedSnapshotsResult.value.map(
              (snapshot) => buildDeletedRecordSnapshot(table, snapshot)
            );
            if (recordSnapshots.length === 0) {
              return ok(domainWrite.unchanged(deleteResult.value));
            }

            const events: NonEmptyDomainEvents = [
              RecordsDeleted.create({
                tableId: table.id(),
                baseId: table.baseId(),
                recordIds: recordSnapshots.map((snapshot) =>
                  RecordId.create(snapshot.id)._unsafeUnwrap()
                ),
                recordSnapshots,
                orchestration: {
                  operationId,
                  totalRecordCount: recordSnapshots.length,
                  totalChunkCount: 1,
                  chunkIndex: 0,
                  scope: 'operation',
                },
              }),
            ];

            return ok(domainWrite.changed(deleteResult.value, events));
          }
        );

      const deleteResult = committed.value;
      const expectedSnapshotCount = scopedSnapshots?.records.length;
      const persistedDeletedSnapshots = deleteResult.deletedRecords;
      if (deleteReportedNotFound || (expectedSnapshotCount === 0 && !persistedDeletedSnapshots)) {
        await pluginExecution.afterCommit();
        return ok(DeleteRecordsResult.create([], []));
      }

      const events = committed.events;
      const deletedRecordIds =
        persistedDeletedSnapshots?.map((snapshot) => snapshot.recordId) ??
        command.recordIds.map((recordId) => recordId.toString());
      const recordSnapshots: IDeletedRecordSnapshot[] =
        persistedDeletedSnapshots?.map((snapshot) => buildDeletedRecordSnapshot(table, snapshot)) ??
        [];

      if (recordSnapshots.length > 0) {
        const stackRecords = recordSnapshots.map((snapshot) => ({
          recordId: snapshot.id,
          fields: snapshot.fields,
          ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
          ...(snapshot.orders ? { orders: snapshot.orders } : {}),
          ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
          ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
          ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
          ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
          ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
        }));

        yield* await handler.undoRedoStackService.appendRecordDelete(
          toUndoRedoStackAppendContext(context),
          {
            tableId: table.id(),
            deletedRecords: stackRecords,
          }
        );
      }
      await pluginExecution.afterCommit();

      return ok(DeleteRecordsResult.create(deletedRecordIds, events));
    });
  }
}
