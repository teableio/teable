import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import { UndoRedoService } from '../application/services/UndoRedoService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DomainEventName } from '../domain/shared/DomainEventName';
import type { RecordCreated } from '../domain/table/events/RecordCreated';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordCreateConstraintService } from '../ports/RecordCreateConstraintService';
import type { BatchRecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import type { RecordFieldValues } from './CreateRecordCommand';
import { CreateRecordsCommand } from './CreateRecordsCommand';

export class CreateRecordsResult {
  private constructor(
    readonly records: ReadonlyArray<TableRecord>,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: FieldKeyMapping,
    readonly computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ) {}

  static create(
    records: ReadonlyArray<TableRecord>,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: FieldKeyMapping = new Map(),
    computedChangesByRecord?: ReadonlyMap<string, ReadonlyMap<string, unknown>>
  ): CreateRecordsResult {
    return new CreateRecordsResult(
      [...records],
      [...events],
      fieldKeyMapping,
      computedChangesByRecord
    );
  }
}

@CommandHandler(CreateRecordsCommand)
@injectable()
export class CreateRecordsHandler
  implements ICommandHandler<CreateRecordsCommand, CreateRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
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

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordsCommand
  ): Promise<Result<CreateRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordsResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // Run create constraints before inserting new records
      yield* await handler.recordCreateConstraintService.checkCreate(
        context,
        command.tableId,
        command.recordsFieldValues.length
      );

      // Resolve field keys to field IDs if using name or dbFieldName
      const resolvedRecordsFieldValues: RecordFieldValues[] = [];
      for (const recordFieldValues of command.recordsFieldValues) {
        const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
          table,
          Object.fromEntries(recordFieldValues),
          command.fieldKeyType
        );
        resolvedRecordsFieldValues.push(new Map(Object.entries(resolvedFields)));
      }

      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        table,
        resolvedRecordsFieldValues,
        command.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      // 2. Create all records (validates and applies field values internally)
      const {
        records: createdRecords,
        fieldKeyMapping,
        mutateSpecs,
      } = yield* tableForCreate.createRecords(resolvedRecordsFieldValues, {
        typecast: command.typecast,
      });

      // 3. Resolve values that require external lookups (user/link)
      const records: TableRecord[] = [];
      for (let i = 0; i < createdRecords.length; i++) {
        let record = createdRecords[i]!;
        const mutateSpec = mutateSpecs[i];
        if (mutateSpec) {
          const needsResolution =
            yield* handler.recordMutationSpecResolver.needsResolution(mutateSpec);
          if (needsResolution) {
            const resolvedSpec = yield* await handler.recordMutationSpecResolver.resolveAndReplace(
              context,
              mutateSpec
            );
            // Re-apply the resolved spec to get the correct record values
            record = yield* resolvedSpec.mutate(record);
          }
        }
        records.push(record);
      }

      // Build extended field key mapping that includes all fields (including computed fields)
      // This ensures computed field values can be keyed by field name when fieldKeyType is 'name'
      let extendedFieldKeyMapping: FieldKeyMapping = new Map(fieldKeyMapping);
      if (command.fieldKeyType !== FieldKeyType.Id) {
        extendedFieldKeyMapping = new Map();
        for (const field of tableForCreate.getFields()) {
          const fieldIdStr = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, command.fieldKeyType);
          extendedFieldKeyMapping.set(fieldIdStr, key);
        }
      }

      // 4. Persist all records within a transaction
      const mutationResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<BatchRecordMutationResult, DomainError>(async function* () {
            if (tableUpdateResult) {
              yield* await handler.tableUpdateFlow.execute(
                transactionContext,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
            }
            const result = yield* await handler.tableRecordRepository.insertMany(
              transactionContext,
              tableForCreate,
              records,
              command.order ? { order: command.order } : undefined
            );
            return ok(result);
          });
        }
      );

      // 5. Pull events from Table aggregate root and aggregate RecordCreated events
      const rawEvents = tableForCreate.pullDomainEvents();

      // Aggregate multiple RecordCreated events into a single RecordsBatchCreated event
      const recordCreatedEvents: RecordCreated[] = [];
      const otherEvents: IDomainEvent[] = [];

      for (const event of rawEvents) {
        if (event.name.equals(DomainEventName.recordCreated())) {
          recordCreatedEvents.push(event as RecordCreated);
        } else {
          otherEvents.push(event);
        }
      }

      let events: IDomainEvent[];
      if (recordCreatedEvents.length > 1) {
        const source = recordCreatedEvents[0]?.source ?? { type: 'user' };
        // Aggregate multiple RecordCreated events into a single RecordsBatchCreated event
        const batchEvent = RecordsBatchCreated.create({
          tableId: tableForCreate.id(),
          baseId: tableForCreate.baseId(),
          records: recordCreatedEvents.map((e) => ({
            recordId: e.recordId.toString(),
            fields: e.fieldValues,
            orders: mutationResult.recordOrders?.get(e.recordId.toString()),
          })),
          source,
        });
        events = [batchEvent, ...otherEvents];
      } else {
        // Keep single RecordCreated event as-is
        events = rawEvents;
      }

      yield* await handler.eventBus.publishMany(context, events);

      const recordSnapshots = records.map((record) => {
        const fields: Record<string, unknown> = {};
        for (const entry of record.fields().entries()) {
          fields[entry.fieldId.toString()] = entry.value.toValue();
        }
        return {
          recordId: record.id().toString(),
          fields,
        };
      });

      yield* await handler.undoRedoService.recordEntry(context, table.id(), {
        undoCommand: {
          type: 'DeleteRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            recordIds: recordSnapshots.map((snapshot) => snapshot.recordId),
          },
        },
        redoCommand: {
          type: 'RestoreRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            records: recordSnapshots,
          },
        },
      });

      return ok(
        CreateRecordsResult.create(
          records,
          events,
          extendedFieldKeyMapping,
          mutationResult.computedChangesByRecord
        )
      );
    });
  }
}
