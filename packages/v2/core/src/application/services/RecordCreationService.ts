import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { Table } from '../../domain/table/Table';
import type { RecordCreateSource } from '../../domain/table/events/RecordFieldValuesDTO';
import { FieldKeyType } from '../../domain/table/fields/FieldKeyType';
import type { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import * as EventBusPort from '../../ports/EventBus';
import * as ExecutionContextPort from '../../ports/ExecutionContext';
import { IRecordCreateConstraintService } from '../../ports/RecordCreateConstraintService';
import type { RecordMutationResult } from '../../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import { FieldKeyResolverService } from './FieldKeyResolverService';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from './RecordWriteSideEffectService';
import { TableUpdateFlow } from './TableUpdateFlow';
import { UndoRedoService } from './UndoRedoService';

export interface IRecordCreationInput {
  table: Table;
  fieldValues: ReadonlyMap<string, unknown>;
  fieldKeyType: FieldKeyType;
  typecast: boolean;
  source: RecordCreateSource;
  order?: RecordInsertOrder;
}

export interface IRecordCreationResult {
  record: TableRecord;
  events: ReadonlyArray<IDomainEvent>;
  fieldKeyMapping: Map<string, string>;
  computedChanges?: ReadonlyMap<string, unknown>;
}

@injectable()
export class RecordCreationService {
  constructor(
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.recordMutationSpecResolverService)
    private readonly recordMutationSpecResolver: RecordMutationSpecResolverService,
    @inject(v2CoreTokens.recordCreateConstraintService)
    private readonly recordCreateConstraintService: IRecordCreateConstraintService,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoService: UndoRedoService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async create(
    context: ExecutionContextPort.IExecutionContext,
    input: IRecordCreationInput
  ): Promise<Result<IRecordCreationResult, DomainError>> {
    const service = this;

    return safeTry<IRecordCreationResult, DomainError>(async function* () {
      yield* await service.recordCreateConstraintService.checkCreate(context, input.table.id(), 1);

      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        input.table,
        Object.fromEntries(input.fieldValues),
        input.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));

      const sideEffectResult = yield* service.recordWriteSideEffectService.execute(
        input.table,
        [resolvedFieldValues],
        input.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      const tracer = context.tracer;
      const createRecordSpan = tracer?.startSpan('teable.RecordCreationService.createRecord');
      const createResult = yield* tableForCreate.createRecord(resolvedFieldValues, {
        typecast: input.typecast,
        source: input.source,
      });

      let record = createResult.record;
      if (createResult.mutateSpec) {
        const needsResolution = yield* service.recordMutationSpecResolver.needsResolution(
          createResult.mutateSpec
        );
        if (needsResolution) {
          const resolvedSpec = yield* await service.recordMutationSpecResolver.resolveAndReplace(
            context,
            createResult.mutateSpec
          );
          record = yield* resolvedSpec.mutate(record);
        }
      }

      let mutationResult: RecordMutationResult | undefined;
      try {
        const runTransaction = () =>
          service.unitOfWork.withTransaction(context, async (transactionContext) => {
            return safeTry<RecordMutationResult, DomainError>(async function* () {
              if (tableUpdateResult) {
                yield* await service.tableUpdateFlow.execute(
                  transactionContext,
                  { table: input.table },
                  () => ok(tableUpdateResult),
                  { publishEvents: false }
                );
              }
              const result = yield* await service.tableRecordRepository.insert(
                transactionContext,
                tableForCreate,
                record,
                input.order ? { order: input.order } : undefined
              );
              return ok(result);
            });
          });
        const transactionResult =
          tracer && createRecordSpan
            ? await tracer.withSpan(createRecordSpan, runTransaction)
            : await runTransaction();
        if (transactionResult.isErr()) {
          createRecordSpan?.recordError(transactionResult.error.toString());
        }
        mutationResult = yield* transactionResult;
      } finally {
        createRecordSpan?.end();
      }

      const events = tableForCreate.pullDomainEvents();
      yield* await service.eventBus.publishMany(context, events);

      const recordFields: Record<string, unknown> = {};
      for (const entry of record.fields().entries()) {
        recordFields[entry.fieldId.toString()] = entry.value.toValue();
      }

      yield* await service.undoRedoService.recordEntry(context, input.table.id(), {
        undoCommand: {
          type: 'DeleteRecords',
          version: 1,
          payload: {
            tableId: input.table.id().toString(),
            recordIds: [record.id().toString()],
          },
        },
        redoCommand: {
          type: 'RestoreRecords',
          version: 1,
          payload: {
            tableId: input.table.id().toString(),
            records: [
              {
                recordId: record.id().toString(),
                fields: recordFields,
              },
            ],
          },
        },
      });

      const fieldKeyMapping = new Map<string, string>();
      if (input.fieldKeyType !== FieldKeyType.Id) {
        for (const field of tableForCreate.getFields()) {
          const fieldId = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, input.fieldKeyType);
          fieldKeyMapping.set(fieldId, key);
        }
      }

      return ok({
        record,
        events,
        fieldKeyMapping,
        computedChanges: mutationResult?.computedChanges,
      });
    });
  }
}
