import { inject, injectable } from '@teable/v2-di';
import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import { assertRecordActorStorageEnabled } from '../application/services/withRecordWriteCoordination';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type {
  RecordFieldValueDTO,
  RecordUpdateDTO,
  RecordValuesDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { RecordsBatchUpdated } from '../domain/table/events/RecordsBatchUpdated';
import { RECORD_REMOVAL_REASON } from '../domain/table/events/RecordsDeleted';
import { FieldId } from '../domain/table/fields/FieldId';
import { LinkField } from '../domain/table/fields/types/LinkField';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import type { Table } from '../domain/table/Table';
import { domainWrite, type IDomainWriteTransaction } from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { NoopTableSchemaCoordination } from '../ports/TableSchemaCoordination';
import type { ITableSchemaCoordination } from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import {
  RestoreRecordsCommand,
  type IDeferredSelfReferentialLinkRecord,
  type RestoreRecordInput,
} from './RestoreRecordsCommand';
import { resolveRestoreRecordsBatchSize } from './shared/streamBatchSize';

export class RestoreRecordsResult {
  private constructor(
    readonly restoredCount: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(restoredCount: number, events: ReadonlyArray<IDomainEvent>): RestoreRecordsResult {
    return new RestoreRecordsResult(restoredCount, [...events]);
  }
}

const DEFAULT_RESTORE_SELF_LINK_BATCH_SIZE = 200;

@CommandHandler(RestoreRecordsCommand)
@injectable()
export class RestoreRecordsHandler implements ICommandHandler<
  RestoreRecordsCommand,
  RestoreRecordsResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsCommand
  ): Promise<Result<RestoreRecordsResult, DomainError>> {
    const lease = await this.tableSchemaCoordination.acquire(
      context,
      [command.tableId.toString()],
      'shared'
    );
    if (lease.isErr()) return err(lease.error);
    try {
      return await this.restoreWithSchemaLease(context, command);
    } finally {
      await lease.value.release();
    }
  }

  private async restoreWithSchemaLease(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsCommand
  ): Promise<Result<RestoreRecordsResult, DomainError>> {
    const tableResult = await this.tableQueryService.getById(context, command.tableId);
    if (tableResult.isErr()) {
      return err(tableResult.error);
    }

    const table = tableResult.value;
    const actorStorage = assertRecordActorStorageEnabled(context, table);
    if (actorStorage.isErr()) return err(actorStorage.error);

    const selfLinkFieldIds = this.collectSelfReferentialLinkFieldIds(table);
    command.onTableSelfLinkFieldsResolved?.(selfLinkFieldIds);

    if (command.selfReferentialLinksOnly) {
      const cleanupTrashSet = new Set(command.cleanupTrashRecordIds ?? []);
      const flushResult = await this.flushSelfReferentialLinks(
        context,
        table,
        command.records.map((record) => ({
          recordId: record.recordId,
          fields: this.pickSelfReferentialLinks(record.fields, selfLinkFieldIds),
          ...(cleanupTrashSet.has(record.recordId) ? { cleanupTrash: true } : {}),
        }))
      );
      if (flushResult.isErr()) {
        return err(flushResult.error);
      }
      return ok(RestoreRecordsResult.create(0, flushResult.value));
    }

    // Replay guard: an undo entry carries full snapshots, so a replay after the
    // trash rows disappeared (purged by the user, or restored through another
    // path) would resurrect them — restore only the survivors. An empty survivor
    // set is a successful no-op. Without the optional port method the check is
    // skipped and the replay behaves as before.
    let records = command.records;
    let discardedTrashIndexRecordIds: string[] | undefined;
    if (command.requireTrashRowReason && this.tableRecordRepository.listTrashedRecordIds) {
      const surviving = await this.tableRecordRepository.listTrashedRecordIds(
        context,
        table,
        records.map((record) => record.recordId),
        command.requireTrashRowReason
      );
      if (surviving.isErr()) {
        return err(surviving.error);
      }
      records = records.filter((record) => surviving.value.has(record.recordId));
      if (records.length === 0) {
        return ok(RestoreRecordsResult.create(0, []));
      }
      if (
        command.requireTrashRowReason === RECORD_REMOVAL_REASON.Deleted &&
        records.length < command.records.length
      ) {
        discardedTrashIndexRecordIds = command.records
          .map((record) => record.recordId)
          .filter((id) => !surviving.value.has(id));
      }
    }

    const canRestoreSelfLinks =
      selfLinkFieldIds.size > 0 && Boolean(this.tableRecordRepository.restoreSelfReferentialLinks);
    const localDeferredSelfLinks: IDeferredSelfReferentialLinkRecord[] = [];
    const deferredCollector = command.deferSelfReferentialLinks ?? localDeferredSelfLinks;

    if (
      ExecutionContextPort.isUndoRedoReplay(context) &&
      this.tableRecordRepository.listExistingRecordIds
    ) {
      const existing = await this.tableRecordRepository.listExistingRecordIds(
        context,
        table,
        records.map((record) => record.recordId)
      );
      if (existing.isErr()) {
        return err(existing.error);
      }
      if (canRestoreSelfLinks) {
        const alreadyExisting = records.filter((record) => existing.value.has(record.recordId));
        if (alreadyExisting.length > 0) {
          this.stripSelfReferentialLinks(
            alreadyExisting,
            selfLinkFieldIds,
            deferredCollector,
            true
          );
        }
      }
      records = records.filter((record) => !existing.value.has(record.recordId));
      if (records.length === 0) {
        if (!command.deferSelfReferentialLinks && localDeferredSelfLinks.length > 0) {
          const flushResult = await this.flushSelfReferentialLinks(
            context,
            table,
            localDeferredSelfLinks
          );
          if (flushResult.isErr()) {
            return err(flushResult.error);
          }
          return ok(RestoreRecordsResult.create(0, flushResult.value));
        }
        return ok(RestoreRecordsResult.create(0, []));
      }
    }

    const pluginExecutionResult = await this.recordWritePluginRunner.prepare({
      kind: RecordWriteOperationKind.restoreMany,
      executionContext: context,
      table,
      payload: {
        recordsFieldValues: records.map((record) => new Map(Object.entries(record.fields))),
        recordCount: records.length,
      },
      isTransactionBound: false,
    });
    if (pluginExecutionResult.isErr()) {
      return err(pluginExecutionResult.error);
    }
    const pluginGuardResult = await pluginExecutionResult.value.guard();
    if (pluginGuardResult.isErr()) {
      return err(pluginGuardResult.error);
    }

    let restoredCount = 0;
    const events: IDomainEvent[] = [];
    const batchSize = resolveRestoreRecordsBatchSize(records.length);
    const batches = [...this.restoreRecordBatches(records, batchSize)];
    const useSingleBatchAtomicSelfLinks =
      canRestoreSelfLinks &&
      !command.deferSelfReferentialLinks &&
      batches.length === 1 &&
      localDeferredSelfLinks.length === 0;
    const useMultiPhaseSelfLinks = canRestoreSelfLinks && !useSingleBatchAtomicSelfLinks;

    for (const batch of batches) {
      const batchDeferred: IDeferredSelfReferentialLinkRecord[] = [];
      const phase1Batch = canRestoreSelfLinks
        ? this.stripSelfReferentialLinks(
            batch,
            selfLinkFieldIds,
            batchDeferred,
            useMultiPhaseSelfLinks
          )
        : batch;
      if (useMultiPhaseSelfLinks && batchDeferred.length > 0) {
        deferredCollector.push(...batchDeferred);
      }
      const builtRecords = this.buildTableRecords(table, phase1Batch);
      if (builtRecords.isErr()) {
        return err(builtRecords.error);
      }

      const restoreRecordsById = this.buildRestoreRecordsById(phase1Batch, command);
      const deferredIdSet = useMultiPhaseSelfLinks
        ? new Set(batchDeferred.map((entry) => entry.recordId))
        : undefined;
      const cleanupTrashRecordIds = deferredIdSet
        ? batch.map((record) => record.recordId).filter((recordId) => !deferredIdSet.has(recordId))
        : batch.map((record) => record.recordId);
      const hasAtomicSelfLinks =
        useSingleBatchAtomicSelfLinks &&
        batchDeferred.length > 0 &&
        Boolean(this.tableRecordRepository.restoreSelfReferentialLinks);
      const tableRecordRepository = this.tableRecordRepository;
      const committed = await this.domainWriteTransaction.execute(
        context,
        async (transactionContext) => {
          const insertResult = await tableRecordRepository.insertMany(
            transactionContext,
            table,
            builtRecords.value,
            {
              restoreRecordsById,
              ...(cleanupTrashRecordIds.length > 0 ? { cleanupTrashRecordIds } : {}),
              ...(discardedTrashIndexRecordIds ? { discardedTrashIndexRecordIds } : {}),
              ...(command.cleanupAttachmentRefs
                ? { cleanupAttachmentRefRecordIds: batch.map((record) => record.recordId) }
                : {}),
              ...(hasAtomicSelfLinks ? { skipComputedUpdates: true } : {}),
            }
          );
          if (insertResult.isErr()) {
            return err(insertResult.error);
          }

          let eventBatch = phase1Batch;
          if (hasAtomicSelfLinks && tableRecordRepository.restoreSelfReferentialLinks) {
            const parsedDeferred = this.parseDeferredSelfLinkRecords(batchDeferred);
            if (parsedDeferred.isErr()) {
              return err(parsedDeferred.error);
            }
            const linkResult = await tableRecordRepository.restoreSelfReferentialLinks(
              transactionContext,
              table,
              parsedDeferred.value,
              {
                atomicInsertRecords: builtRecords.value,
              }
            );
            if (linkResult.isErr()) {
              return err(linkResult.error);
            }
            eventBatch = this.reconcilePhase1BatchWithRestoredLinks(
              phase1Batch,
              linkResult.value,
              selfLinkFieldIds
            );
          } else if (insertResult.value.computedChangesByRecord?.size) {
            eventBatch = this.mergeComputedChangesIntoEventBatch(
              phase1Batch,
              insertResult.value.computedChangesByRecord
            );
          }

          return ok(
            domainWrite.fromEvents(undefined, this.buildBatchCreatedEvents(table, eventBatch), {
              tables: [table],
            })
          );
        }
      );
      if (committed.isErr()) {
        return err(committed.error);
      }
      discardedTrashIndexRecordIds = undefined;

      restoredCount += builtRecords.value.length;
      events.push(...committed.value.events);
    }

    if (
      useMultiPhaseSelfLinks &&
      !command.deferSelfReferentialLinks &&
      localDeferredSelfLinks.length > 0
    ) {
      const flushResult = await this.flushSelfReferentialLinks(
        context,
        table,
        localDeferredSelfLinks
      );
      if (flushResult.isErr()) {
        return err(flushResult.error);
      }
      events.push(...flushResult.value);
    }

    return ok(RestoreRecordsResult.create(restoredCount, events));
  }

  private collectSelfReferentialLinkFieldIds(table: Table): ReadonlySet<string> {
    return new Set(
      table
        .getFields()
        .filter(
          (field): field is LinkField =>
            field instanceof LinkField && field.foreignTableId().equals(table.id())
        )
        .map((field) => field.id().toString())
    );
  }

  private pickSelfReferentialLinks(
    fields: Readonly<Record<string, unknown>>,
    selfLinkFieldIds: ReadonlySet<string>
  ): Record<string, unknown> {
    const picked: Record<string, unknown> = {};
    for (const [fieldId, value] of Object.entries(fields)) {
      if (selfLinkFieldIds.has(fieldId) && value !== null && value !== undefined) {
        picked[fieldId] = value;
      }
    }
    return picked;
  }

  private stripSelfReferentialLinks(
    batch: ReadonlyArray<RestoreRecordInput>,
    selfLinkFieldIds: ReadonlySet<string>,
    collector: IDeferredSelfReferentialLinkRecord[],
    cleanupTrashInPhase2: boolean
  ): ReadonlyArray<RestoreRecordInput> {
    return batch.map((record) => {
      const extractedSelfLinks: Record<string, unknown> = {};
      const strippedFields: Record<string, unknown> = {};
      let hasSelfLink = false;

      for (const [fieldId, value] of Object.entries(record.fields)) {
        if (selfLinkFieldIds.has(fieldId)) {
          if (value !== null && value !== undefined) {
            extractedSelfLinks[fieldId] = value;
            hasSelfLink = true;
          }
          continue;
        }
        strippedFields[fieldId] = value;
      }

      if (!hasSelfLink) {
        return record;
      }

      collector.push({
        recordId: record.recordId,
        fields: extractedSelfLinks,
        ...(cleanupTrashInPhase2 ? { cleanupTrash: true } : {}),
      });
      return {
        ...record,
        fields: strippedFields,
      };
    });
  }

  private parseDeferredSelfLinkRecords(
    deferredRecords: ReadonlyArray<IDeferredSelfReferentialLinkRecord>
  ): Result<
    ReadonlyArray<{
      readonly recordId: RecordId;
      readonly fields: Readonly<Record<string, unknown>>;
    }>,
    DomainError
  > {
    const parsedRecords: Array<{
      readonly recordId: RecordId;
      readonly fields: Readonly<Record<string, unknown>>;
    }> = [];
    for (const entry of deferredRecords) {
      const recordId = RecordId.create(entry.recordId);
      if (recordId.isErr()) {
        return err(recordId.error);
      }
      parsedRecords.push({
        recordId: recordId.value,
        fields: entry.fields,
      });
    }
    return ok(parsedRecords);
  }

  private reconcilePhase1BatchWithRestoredLinks(
    phase1Batch: ReadonlyArray<RestoreRecordInput>,
    restoredLinks: ReadonlyArray<TableRecordRepositoryPort.RestoredSelfReferentialLinkRecord>,
    selfLinkFieldIds: ReadonlySet<string>
  ): ReadonlyArray<RestoreRecordInput> {
    const restoredById = new Map<string, Record<string, unknown>>();
    for (const entry of restoredLinks) {
      const reconciledFields: Record<string, unknown> = {};
      for (const change of entry.changes) {
        if (
          selfLinkFieldIds.has(change.fieldId) &&
          change.newValue !== null &&
          change.newValue !== undefined
        ) {
          reconciledFields[change.fieldId] = change.newValue;
        }
      }
      if (entry.computedChanges) {
        for (const [fieldId, value] of entry.computedChanges) {
          reconciledFields[fieldId] = value;
        }
      }
      if (Object.keys(reconciledFields).length > 0) {
        restoredById.set(entry.recordId, reconciledFields);
      }
    }
    if (restoredById.size === 0) {
      return phase1Batch;
    }
    return phase1Batch.map((record) => {
      const applied = restoredById.get(record.recordId);
      if (!applied) {
        return record;
      }
      return {
        ...record,
        fields: {
          ...record.fields,
          ...applied,
        },
      };
    });
  }

  private mergeComputedChangesIntoEventBatch(
    phase1Batch: ReadonlyArray<RestoreRecordInput>,
    computedChangesByRecord: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): ReadonlyArray<RestoreRecordInput> {
    return phase1Batch.map((record) => {
      const computedFields = computedChangesByRecord.get(record.recordId);
      if (!computedFields || computedFields.size === 0) {
        return record;
      }
      const nextFields = { ...record.fields };
      for (const [fieldId, value] of computedFields) {
        nextFields[fieldId] = value;
      }
      return {
        ...record,
        fields: nextFields,
      };
    });
  }

  private async flushSelfReferentialLinks(
    context: ExecutionContextPort.IExecutionContext,
    table: Table,
    deferredRecords: ReadonlyArray<IDeferredSelfReferentialLinkRecord>
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const restoreLinks = this.tableRecordRepository.restoreSelfReferentialLinks;
    const actionableRecords = deferredRecords.filter(
      (entry) => Object.keys(entry.fields).length > 0 || entry.cleanupTrash
    );
    if (!restoreLinks || actionableRecords.length === 0) {
      return ok([]);
    }

    const parsedResult = this.parseDeferredSelfLinkRecords(actionableRecords);
    if (parsedResult.isErr()) {
      return err(parsedResult.error);
    }
    const parsedRecords = parsedResult.value;
    const flushEvents: IDomainEvent[] = [];

    for (
      let offset = 0;
      offset < parsedRecords.length;
      offset += DEFAULT_RESTORE_SELF_LINK_BATCH_SIZE
    ) {
      const batch = parsedRecords.slice(offset, offset + DEFAULT_RESTORE_SELF_LINK_BATCH_SIZE);
      const cleanupTrashRecordIds = actionableRecords
        .slice(offset, offset + DEFAULT_RESTORE_SELF_LINK_BATCH_SIZE)
        .filter((entry) => entry.cleanupTrash)
        .map((entry) => entry.recordId);
      const txResult = await this.domainWriteTransaction.execute(
        context,
        async (transactionContext) => {
          const linkResult = await restoreLinks.call(
            this.tableRecordRepository,
            transactionContext,
            table,
            batch,
            cleanupTrashRecordIds.length > 0 ? { cleanupTrashRecordIds } : undefined
          );
          if (linkResult.isErr()) {
            return err(linkResult.error);
          }
          const updates: RecordUpdateDTO[] = linkResult.value
            .filter((record) => record.changes.length > 0)
            .map((record) => ({
              recordId: record.recordId,
              oldVersion: record.oldVersion,
              newVersion: record.newVersion,
              changes: record.changes.map((change) => ({
                fieldId: change.fieldId,
                oldValue: change.oldValue,
                newValue: change.newValue,
              })),
            }));
          const batchEvents: IDomainEvent[] =
            updates.length > 0
              ? [
                  RecordsBatchUpdated.create({
                    tableId: table.id(),
                    baseId: table.baseId(),
                    updates,
                    source: 'computed',
                  }),
                ]
              : [];
          return ok(
            batchEvents.length > 0
              ? domainWrite.fromEvents(undefined, batchEvents, { tables: [table] })
              : domainWrite.unchanged(undefined)
          );
        }
      );
      if (txResult.isErr()) {
        return err(txResult.error);
      }
      flushEvents.push(...txResult.value.events);
    }

    return ok(flushEvents);
  }

  private buildTableRecords(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>
  ): Result<ReadonlyArray<TableRecord>, DomainError> {
    const records: TableRecord[] = [];

    for (const record of batch) {
      const recordId = RecordId.create(record.recordId);
      if (recordId.isErr()) {
        return err(recordId.error);
      }

      const fieldValues: Array<{ fieldId: FieldId; value: TableRecordCellValue }> = [];
      for (const [fieldIdRaw, rawValue] of Object.entries(record.fields)) {
        const fieldId = FieldId.create(fieldIdRaw);
        if (fieldId.isErr()) {
          return err(fieldId.error);
        }

        const cellValue = TableRecordCellValue.create(rawValue);
        if (cellValue.isErr()) {
          return err(cellValue.error);
        }

        fieldValues.push({ fieldId: fieldId.value, value: cellValue.value });
      }

      const tableRecord = TableRecord.create({
        id: recordId.value,
        tableId: table.id(),
        fieldValues,
      });
      if (tableRecord.isErr()) {
        return err(tableRecord.error);
      }

      records.push(tableRecord.value);
    }

    return ok(records);
  }

  private buildRestoreRecordsById(
    batch: ReadonlyArray<RestoreRecordInput>,
    command: RestoreRecordsCommand
  ) {
    return new Map(
      batch.map((record) => [
        record.recordId,
        {
          ...(record.version !== undefined ? { version: record.version } : {}),
          ...(command.trustedCreatedActorsByRecordId
            ? {
                createdByActor: command.trustedCreatedActorsByRecordId.get(record.recordId) ?? null,
              }
            : {}),
          ...(record.orders ? { orders: record.orders } : {}),
          ...(record.defaultOrder !== undefined ? { defaultOrder: record.defaultOrder } : {}),
          ...(record.autoNumber !== undefined ? { autoNumber: record.autoNumber } : {}),
          ...(record.createdTime ? { createdTime: record.createdTime } : {}),
          ...(record.createdBy ? { createdBy: record.createdBy } : {}),
          ...(record.lastModifiedTime ? { lastModifiedTime: record.lastModifiedTime } : {}),
          ...(record.lastModifiedBy ? { lastModifiedBy: record.lastModifiedBy } : {}),
          ...(record.extraColumnValues ? { extraColumnValues: record.extraColumnValues } : {}),
        },
      ])
    );
  }

  private buildEventRecords(records: ReadonlyArray<RestoreRecordInput>): RecordValuesDTO[] {
    return records.map((record) => {
      const fields: RecordFieldValueDTO[] = Object.entries(record.fields).map(
        ([fieldId, value]) => ({
          fieldId,
          value,
        })
      );

      return { recordId: record.recordId, fields, orders: record.orders };
    });
  }

  private buildBatchCreatedEvents(
    table: Table,
    batch: ReadonlyArray<RestoreRecordInput>
  ): ReadonlyArray<IDomainEvent> {
    const eventRecords = this.buildEventRecords(batch);
    if (!eventRecords.length) {
      return [];
    }

    return [
      RecordsBatchCreated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        records: eventRecords,
        source: { type: 'restore' },
      }),
    ];
  }

  private *restoreRecordBatches(
    records: ReadonlyArray<RestoreRecordInput>,
    batchSize: number
  ): Iterable<ReadonlyArray<RestoreRecordInput>> {
    const normalizedBatchSize = Math.max(1, batchSize);
    for (let index = 0; index < records.length; index += normalizedBatchSize) {
      yield records.slice(index, index + normalizedBatchSize);
    }
  }
}
