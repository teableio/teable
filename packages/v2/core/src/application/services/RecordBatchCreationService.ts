import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  buildOperationBatchMutation,
  withBatchMutation,
} from '../../commands/shared/batchMutationOrchestration';
import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { RecordCreated, isRecordCreatedEvent } from '../../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../../domain/table/events/RecordsBatchCreated';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../../domain/table/records/RecordCreateResult';
import type { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../../ports/RecordWritePlugin';
import { ITableRecordRepository } from '../../ports/TableRecordRepository';
import type {
  BatchRecordMutationResult,
  RecordStoredSnapshot,
} from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import type { UndoRedoCommandLeafData } from '../../ports/UndoRedoStore';
import { createUndoRedoCommand } from '../../ports/UndoRedoStore';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import {
  type IForeignTableLoaderService,
  NullForeignTableLoaderService,
} from './ForeignTableLoaderService';
import { type IRecordChangedValueDecoratorService } from './RecordChangedValueDecoratorService';
import { mergeRecordFieldValues } from './recordEventFieldValues';
import {
  requireStoredRecordSnapshots,
  toUndoRedoRestoreRecords,
} from './RecordMutationSnapshotContract';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from './RecordWritePluginRunner';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from './RecordWriteUndoRedoPlanService';
import { TableUpdateFlow } from './TableUpdateFlow';

export interface IRecordBatchCreationInput {
  readonly table: Table;
  readonly recordsFieldValues: ReadonlyArray<ReadonlyMap<string, unknown>>;
  readonly fieldKeyType: FieldKeyType;
  readonly typecast: boolean;
  readonly order?: RecordInsertOrder;
  readonly isTransactionBound: boolean;
}

export interface IRecordBatchCreationResult {
  readonly records: ReadonlyArray<TableRecord>;
  readonly events: ReadonlyArray<IDomainEvent>;
  readonly fieldKeyMapping: FieldKeyMapping;
  readonly computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>;
  readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly afterCommit: () => Promise<void>;
}

@injectable()
export class RecordBatchCreationService {
  constructor(
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordChangedValueDecoratorService)
    private readonly recordChangedValueDecoratorService: IRecordChangedValueDecoratorService,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.recordWriteUndoRedoPlanService)
    private readonly recordWriteUndoRedoPlanService: RecordWriteUndoRedoPlanService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: IForeignTableLoaderService = new NullForeignTableLoaderService()
  ) {}

  async create(
    context: IExecutionContext,
    input: IRecordBatchCreationInput
  ): Promise<Result<IRecordBatchCreationResult, DomainError>> {
    const service = this;

    return safeTry<IRecordBatchCreationResult, DomainError>(async function* () {
      const resolvedRecordsFieldValues = yield* service.resolveFieldValues(input);
      const pluginExecution = yield* await service.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.createMany,
        executionContext: context,
        table: input.table,
        payload: {
          recordsFieldValues: resolvedRecordsFieldValues,
          fieldKeyType: input.fieldKeyType,
          typecast: input.typecast,
          order: input.order,
          recordCount: resolvedRecordsFieldValues.length,
        },
        isTransactionBound: input.isTransactionBound,
      });
      yield* await pluginExecution.guard();

      const sideEffectResult = yield* service.recordWriteSideEffectService.execute(
        context,
        input.table,
        resolvedRecordsFieldValues,
        input.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const sideEffectUndoRedoPlan =
        yield* await service.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
          context,
          input.table,
          tableForCreate,
          sideEffectResult.effects
        );

      const {
        records: createdRecords,
        fieldKeyMapping,
        mutateSpecs,
      } = yield* tableForCreate.createRecords(resolvedRecordsFieldValues, {
        typecast: input.typecast,
      });
      const records = yield* await service.resolveCreatedRecords(
        context,
        createdRecords,
        mutateSpecs,
        input.typecast
      );

      let tableEvents: ReadonlyArray<IDomainEvent> = [];
      const tableUpdateResult = sideEffectResult.updateResult;
      if (tableUpdateResult) {
        const tableFlowResult = yield* await service.tableUpdateFlow.execute(
          context,
          { table: input.table },
          () => ok(tableUpdateResult),
          { publishEvents: false }
        );
        tableEvents = tableFlowResult.events;
      }

      const batchMutation = buildOperationBatchMutation(context, records.length);
      const contextWithBatchMutation = withBatchMutation(context, batchMutation);

      yield* await pluginExecution.beforePersist(contextWithBatchMutation);
      const fillLinkTitleForeignTables = input.typecast
        ? yield* await service.foreignTableLoaderService.loadForLinkTitleFill(
            contextWithBatchMutation,
            mutateSpecs
          )
        : new Map();
      const mutationResult = yield* await service.tableRecordRepository.insertMany(
        contextWithBatchMutation,
        tableForCreate,
        records,
        {
          ...(input.order ? { order: input.order } : {}),
          ...(input.typecast ? { fillLinkTitles: true } : {}),
          ...(fillLinkTitleForeignTables.size > 0 ? { fillLinkTitleForeignTables } : {}),
        }
      );

      const decoratedChangedFieldsByRecord =
        yield* await service.recordChangedValueDecoratorService.decorateChangedFieldsByRecord(
          tableForCreate,
          mutationResult.changedFieldsByRecord
        );
      const aggregateEvents = service.aggregateCreatedEvents(
        tableForCreate,
        {
          ...mutationResult,
          changedFieldsByRecord: decoratedChangedFieldsByRecord,
        },
        tableForCreate.pullDomainEvents(),
        batchMutation
      );
      const recordSnapshotsResult = await service.buildRecordSnapshots(
        context,
        tableForCreate,
        records,
        mutationResult
      );
      if (recordSnapshotsResult.isErr()) {
        return err(recordSnapshotsResult.error);
      }
      const storedSnapshots = recordSnapshotsResult.value;
      const recordSnapshots = toUndoRedoRestoreRecords(storedSnapshots);

      return ok({
        records,
        events: [...tableEvents, ...aggregateEvents],
        fieldKeyMapping: service.buildExtendedFieldKeyMapping(
          tableForCreate,
          input.fieldKeyType,
          fieldKeyMapping
        ),
        computedChangesByRecord: mutationResult.computedChangesByRecord,
        undoCommands: [
          createUndoRedoCommand('DeleteRecords', {
            tableId: input.table.id().toString(),
            recordIds: recordSnapshots.map((snapshot) => snapshot.recordId),
          }),
          ...sideEffectUndoRedoPlan.undoCommands,
        ],
        redoCommands: [
          ...sideEffectUndoRedoPlan.redoCommands,
          createUndoRedoCommand('RestoreRecords', {
            tableId: input.table.id().toString(),
            records: recordSnapshots,
          }),
        ],
        afterCommit: async () => {
          await pluginExecution.afterCommit();
        },
      });
    });
  }

  private resolveFieldValues(
    input: IRecordBatchCreationInput
  ): Result<ReadonlyArray<ReadonlyMap<string, unknown>>, DomainError> {
    const resolvedRecordsFieldValues: Array<ReadonlyMap<string, unknown>> = [];
    for (const recordFieldValues of input.recordsFieldValues) {
      const resolvedFields = FieldKeyResolverService.resolveFieldKeys(
        input.table,
        Object.fromEntries(recordFieldValues),
        input.fieldKeyType
      );
      if (resolvedFields.isErr()) {
        return err(resolvedFields.error);
      }
      resolvedRecordsFieldValues.push(new Map(Object.entries(resolvedFields.value)));
    }
    return ok(resolvedRecordsFieldValues);
  }

  private async resolveCreatedRecords(
    context: IExecutionContext,
    records: ReadonlyArray<TableRecord>,
    mutateSpecs: ReadonlyArray<ICellValueSpec | null>,
    typecast: boolean
  ): Promise<Result<ReadonlyArray<TableRecord>, DomainError>> {
    if (!typecast) {
      return ok(records);
    }

    const resolveManyResult = await this.recordMutationSpecResolver.resolveAndReplaceMany(
      context,
      mutateSpecs
    );
    if (resolveManyResult.isErr()) {
      return err(resolveManyResult.error);
    }

    const resolvedRecords: TableRecord[] = [];
    for (let index = 0; index < records.length; index++) {
      let record = records[index]!;
      const mutateSpec = resolveManyResult.value[index] ?? null;
      if (mutateSpec) {
        const mutateResult = mutateSpec.mutate(record);
        if (mutateResult.isErr()) {
          return err(mutateResult.error);
        }
        record = mutateResult.value;
      }
      resolvedRecords.push(record);
    }

    return ok(resolvedRecords);
  }

  private aggregateCreatedEvents(
    table: Table,
    mutationResult: BatchRecordMutationResult,
    rawEvents: ReadonlyArray<IDomainEvent>,
    orchestration?: IExecutionContext['batchMutation']
  ): ReadonlyArray<IDomainEvent> {
    const recordCreatedEvents: RecordCreated[] = [];
    const otherEvents: IDomainEvent[] = [];

    for (const event of rawEvents) {
      if (isRecordCreatedEvent(event)) {
        const recordId = event.recordId.toString();
        const recordFieldChanges = new Map<string, unknown>();
        for (const [fieldId, value] of mutationResult.changedFieldsByRecord?.get(recordId) ?? []) {
          recordFieldChanges.set(fieldId, value);
        }
        for (const [fieldId, value] of mutationResult.computedChangesByRecord?.get(recordId) ??
          []) {
          recordFieldChanges.set(fieldId, value);
        }
        const mergedRecordFieldChanges =
          recordFieldChanges.size > 0 ? recordFieldChanges : undefined;
        recordCreatedEvents.push(
          RecordCreated.create({
            tableId: event.tableId,
            baseId: event.baseId,
            recordId: event.recordId,
            fieldValues: mergeRecordFieldValues(event.fieldValues, mergedRecordFieldChanges),
            source: event.source,
          })
        );
      } else {
        otherEvents.push(event);
      }
    }

    if (recordCreatedEvents.length <= 1) {
      return [...recordCreatedEvents, ...otherEvents];
    }

    const source = recordCreatedEvents[0]?.source ?? { type: 'user' };
    return [
      RecordsBatchCreated.create({
        tableId: table.id(),
        baseId: table.baseId(),
        records: recordCreatedEvents.map((event) => ({
          recordId: event.recordId.toString(),
          fields: event.fieldValues,
          orders: mutationResult.recordOrders?.get(event.recordId.toString()),
        })),
        source,
        orchestration,
      }),
      ...otherEvents,
    ];
  }

  private async buildRecordSnapshots(
    _context: IExecutionContext,
    table: Table,
    records: ReadonlyArray<TableRecord>,
    mutationResult: BatchRecordMutationResult
  ): Promise<Result<ReadonlyArray<RecordStoredSnapshot>, DomainError>> {
    const storedSnapshotsResult = requireStoredRecordSnapshots(
      {
        operation: 'create',
        tableId: table.id().toString(),
        expectedCount: records.length,
      },
      mutationResult.recordSnapshots
    );
    if (storedSnapshotsResult.isErr()) {
      return err(storedSnapshotsResult.error);
    }

    return ok(storedSnapshotsResult.value);
  }

  private buildExtendedFieldKeyMapping(
    table: Table,
    fieldKeyType: FieldKeyType,
    fieldKeyMapping: FieldKeyMapping
  ): FieldKeyMapping {
    if (fieldKeyType === FieldKeyType.Id) {
      return new Map(fieldKeyMapping);
    }

    const extendedFieldKeyMapping: FieldKeyMapping = new Map();
    for (const field of table.getFields()) {
      const fieldId = field.id().toString();
      extendedFieldKeyMapping.set(
        fieldId,
        FieldKeyResolverService.getFieldKey(field, fieldKeyType)
      );
    }
    return extendedFieldKeyMapping;
  }
}
