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
import { RECORD_REMOVAL_REASON, RecordsDeleted } from '../domain/table/events/RecordsDeleted';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import type { UndoRedoArchiveTrashRow } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { ArchiveRecordsCommand } from './ArchiveRecordsCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildDeletedRecordSnapshot } from './shared/buildDeletedRecordSnapshot';
import { composeRecordConditionSpecs } from './shared/recordWriteScope';
import { toTableRecord } from './shared/toTableRecord';

export class ArchiveRecordsResult {
  private constructor(
    readonly archivedRecordIds: ReadonlyArray<string>,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(archivedRecordIds: ReadonlyArray<string>, events: ReadonlyArray<IDomainEvent>) {
    return new ArchiveRecordsResult([...archivedRecordIds], [...events]);
  }
}

// The record_trash snapshot keeps the v1 wire shape (`order`/`name` keys) because the
// archive list UI, the EE restore path and the cold-storage truncator all parse it as
// IRecord — see V2RecordsDeletedTableTrashProjection for the same mapping on the
// recycle-bin side.
const buildArchiveSnapshotJson = (snapshot: IDeletedRecordSnapshot): string => {
  return JSON.stringify({
    id: snapshot.id,
    fields: snapshot.fields,
    ...(snapshot.version !== undefined ? { version: snapshot.version } : {}),
    ...(snapshot.autoNumber !== undefined ? { autoNumber: snapshot.autoNumber } : {}),
    ...(snapshot.createdTime ? { createdTime: snapshot.createdTime } : {}),
    ...(snapshot.createdBy ? { createdBy: snapshot.createdBy } : {}),
    ...(snapshot.lastModifiedTime ? { lastModifiedTime: snapshot.lastModifiedTime } : {}),
    ...(snapshot.lastModifiedBy ? { lastModifiedBy: snapshot.lastModifiedBy } : {}),
    ...(snapshot.orders ? { order: snapshot.orders } : {}),
    ...(snapshot.displayName ? { name: snapshot.displayName } : {}),
  });
};

type ArchiveTransactionOutcome = {
  archiveRows: ReadonlyArray<UndoRedoArchiveTrashRow>;
  recordSnapshots: ReadonlyArray<IDeletedRecordSnapshot>;
};

@CommandHandler(ArchiveRecordsCommand)
@injectable()
export class ArchiveRecordsHandler
  implements ICommandHandler<ArchiveRecordsCommand, ArchiveRecordsResult>
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
    command: ArchiveRecordsCommand
  ): Promise<Result<ArchiveRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<ArchiveRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      // Archive runs through the delete pipeline (same scope and limits); the removal
      // reason lets authorization plugins gate it as an archive rather than a delete.
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.deleteMany,
        executionContext: context,
        table,
        payload: {
          recordIds: command.recordIds,
          recordCount: command.recordIds.length,
          removalReason: RECORD_REMOVAL_REASON.Archived,
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
      const expectedSnapshotCount = scopedSnapshots?.records.length;
      let deleteReportedNotFound = false;

      // Snapshot persistence rides the delete transaction: the archive rows and the
      // physical delete commit or roll back together, so there is never a deleted
      // record without its snapshot nor a snapshot for a live record.
      const outcome = yield* await handler.unitOfWork.withTransaction<ArchiveTransactionOutcome>(
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
              return ok<ArchiveTransactionOutcome>({ archiveRows: [], recordSnapshots: [] });
            }
            return err(deleteResult.error);
          }

          if (expectedSnapshotCount === 0 && !deleteResult.value.deletedRecords) {
            return ok<ArchiveTransactionOutcome>({ archiveRows: [], recordSnapshots: [] });
          }

          const storedSnapshotsResult = requireStoredRecordSnapshots(
            {
              operation: 'delete',
              tableId: table.id().toString(),
              ...(expectedSnapshotCount !== undefined
                ? { expectedCount: expectedSnapshotCount }
                : {}),
            },
            deleteResult.value.deletedRecords
          );
          if (storedSnapshotsResult.isErr()) {
            return err(storedSnapshotsResult.error);
          }

          const recordSnapshots = storedSnapshotsResult.value.map((snapshot) =>
            buildDeletedRecordSnapshot(table, snapshot)
          );
          const deletedIdSet = new Set(recordSnapshots.map((snapshot) => snapshot.id));
          const archivedAt = new Date().toISOString();
          // Redo replay carries the rows the undo removed — re-persist those (narrowed
          // to what this run actually deleted, stamped with the replay time so the row
          // sorts after the undo's restore tombstone in cold storage). An original
          // archive builds fresh rows from the delete capture.
          const archiveRows: ReadonlyArray<UndoRedoArchiveTrashRow> = command.archiveRows
            ? command.archiveRows
                .filter((row) => deletedIdSet.has(row.recordId))
                .map((row) => ({ ...row, createdTime: archivedAt }))
            : recordSnapshots.map((snapshot) => ({
                recordId: snapshot.id,
                snapshot: buildArchiveSnapshotJson(snapshot),
                createdBy: context.actorId.toString(),
                createdTime: archivedAt,
                operationId: command.operationId,
                recordCreatedTime: snapshot.createdTime,
                recordCreatedBy: snapshot.createdBy,
                recordLastModifiedTime: snapshot.lastModifiedTime,
                recordLastModifiedBy: snapshot.lastModifiedBy,
              }));

          if (archiveRows.length > 0) {
            if (!handler.tableRecordRepository.insertArchiveTrashRows) {
              return err(
                domainError.validation({
                  message: 'Repository does not support archive snapshot persistence',
                })
              );
            }
            const persistResult = await handler.tableRecordRepository.insertArchiveTrashRows(
              transactionContext,
              table,
              archiveRows
            );
            if (persistResult.isErr()) {
              return err(persistResult.error);
            }
          }

          return ok<ArchiveTransactionOutcome>({ archiveRows, recordSnapshots });
        }
      );

      if (deleteReportedNotFound || outcome.recordSnapshots.length === 0) {
        await pluginExecution.afterCommit();
        return ok(ArchiveRecordsResult.create([], []));
      }

      const { archiveRows, recordSnapshots } = outcome;
      const archivedRecordIds = recordSnapshots.map((snapshot) => snapshot.id);

      const events: IDomainEvent[] = [
        RecordsDeleted.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordIds: archivedRecordIds.map((id) => RecordId.create(id)._unsafeUnwrap()),
          recordSnapshots,
          orchestration: {
            operationId: command.operationId ?? context.requestId,
            ...(command.archiveGroupId ? { groupId: command.archiveGroupId } : {}),
            totalRecordCount: archivedRecordIds.length,
            totalChunkCount: 1,
            chunkIndex: 0,
            scope: 'operation',
          },
          removalReason: RECORD_REMOVAL_REASON.Archived,
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

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

      // Undo restores the records and cleans the archive snapshot rows + kept
      // attachment refs; redo re-persists the carried rows before deleting again.
      yield* await handler.undoRedoStackService.appendRecordArchive(
        toUndoRedoStackAppendContext(context),
        {
          tableId: table.id(),
          archivedRecords: stackRecords,
          recordIds: archivedRecordIds,
          archiveRows,
          ...(command.archiveGroupId ? { groupId: command.archiveGroupId } : {}),
        }
      );

      await pluginExecution.afterCommit();

      return ok(ArchiveRecordsResult.create(archivedRecordIds, events));
    });
  }
}
