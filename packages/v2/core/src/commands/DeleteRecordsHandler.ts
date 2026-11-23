import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  loadBulkRecordExplicitScope,
  prepareBulkRecordExplicitScope,
  prepareBulkRecordSelector,
} from '../application/services/BulkRecordPreparationService';
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

const MAX_EXPLICIT_SCOPE_VALIDATION_BATCH_SIZE = 2_000;
const MAX_EXPLICIT_DELETE_RECORDS = 20_000;

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
export class DeleteRecordsHandler implements ICommandHandler<
  DeleteRecordsCommand,
  DeleteRecordsResult
> {
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
      if (command.recordIds && command.recordIds.length > MAX_EXPLICIT_DELETE_RECORDS) {
        return err(
          domainError.validation({
            code: 'validation.limit.records_per_mutation_max',
            message: `Cannot delete more than ${MAX_EXPLICIT_DELETE_RECORDS} explicit records in a single request; use the streaming delete endpoint instead.`,
            details: {
              tableId: command.tableId.toString(),
              requestedCount: command.recordIds.length,
              maxCount: MAX_EXPLICIT_DELETE_RECORDS,
            },
          })
        );
      }

      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.deleteMany,
        executionContext: context,
        table,
        payload: {
          recordIds: command.recordIds,
          recordCount: command.recordIds?.length,
          filter: command.filter,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const pluginRecordSpec = yield* pluginExecution.getRecordSpec();

      let expectedSnapshotCount: number | undefined;
      if (command.recordIds && pluginRecordSpec) {
        let totalMatchedCount = 0;
        for (
          let offset = 0;
          offset < command.recordIds.length;
          offset += MAX_EXPLICIT_SCOPE_VALIDATION_BATCH_SIZE
        ) {
          const sliceIds = command.recordIds.slice(
            offset,
            offset + MAX_EXPLICIT_SCOPE_VALIDATION_BATCH_SIZE
          );
          const scopedSnapshots = yield* await loadBulkRecordExplicitScope(
            context,
            table,
            sliceIds,
            handler.tableRecordQueryRepository
          );
          const preparedScope = yield* prepareBulkRecordExplicitScope(
            table,
            sliceIds.map((recordId) => ({ recordId, fieldValues: new Map() })),
            scopedSnapshots,
            pluginRecordSpec
          );

          if (preparedScope.pluginFilteredRecordIds.length > 0) {
            return err(
              domainError.forbidden({
                code: 'record_write_plugin.scope_forbidden',
                message: 'Record write target includes rows outside the allowed scope.',
                details: {
                  operation: RecordWriteOperationKind.deleteMany,
                  tableId: table.id().toString(),
                  requestedRecordCount: scopedSnapshots.records.length,
                  authorizedRecordCount: preparedScope.authorizedUpdates.length,
                },
              })
            );
          }
          totalMatchedCount += scopedSnapshots.records.length;
        }
        expectedSnapshotCount = totalMatchedCount;
      }

      const { scopedSpec: scopedDeleteSpec } = yield* prepareBulkRecordSelector(
        table,
        { recordIds: command.recordIds, filter: command.filter },
        pluginRecordSpec
      );
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
            if (command.filter && deleteResult.value.deletedCount === 0) {
              return ok(domainWrite.unchanged(deleteResult.value));
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

            const persistedDeletedSnapshots = deleteResult.value.deletedRecords;
            if (expectedSnapshotCount === 0 && !persistedDeletedSnapshots) {
              return ok(domainWrite.unchanged(deleteResult.value));
            }

            const requiredSnapshotCount = command.filter
              ? deleteResult.value.deletedCount
              : expectedSnapshotCount;
            const storedSnapshotsResult = requireStoredRecordSnapshots(
              {
                operation: 'delete',
                tableId: table.id().toString(),
                ...(requiredSnapshotCount !== undefined
                  ? { expectedCount: requiredSnapshotCount }
                  : {}),
              },
              persistedDeletedSnapshots
            );
            if (storedSnapshotsResult.isErr()) {
              if (command.filter) return err(storedSnapshotsResult.error);
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
      const persistedDeletedSnapshots = deleteResult.deletedRecords;
      if (
        deleteReportedNotFound ||
        (command.filter && deleteResult.deletedCount === 0) ||
        (expectedSnapshotCount === 0 && !persistedDeletedSnapshots)
      ) {
        await pluginExecution.afterCommit();
        return ok(DeleteRecordsResult.create([], []));
      }

      const events = committed.events;
      const deletedRecordIds =
        persistedDeletedSnapshots?.map((snapshot) => snapshot.recordId) ??
        command.recordIds?.map((recordId) => recordId.toString()) ??
        [];
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
