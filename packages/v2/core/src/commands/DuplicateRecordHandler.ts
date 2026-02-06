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
import { domainError, isNotFoundError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordCreateConstraintService } from '../ports/RecordCreateConstraintService';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { RecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { DuplicateRecordCommand } from './DuplicateRecordCommand';

export class DuplicateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: Map<string, string>,
    readonly computedChanges?: ReadonlyMap<string, unknown>
  ) {}

  static create(
    record: TableRecord,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: Map<string, string> = new Map(),
    computedChanges?: ReadonlyMap<string, unknown>
  ): DuplicateRecordResult {
    return new DuplicateRecordResult(record, [...events], fieldKeyMapping, computedChanges);
  }
}

@CommandHandler(DuplicateRecordCommand)
@injectable()
export class DuplicateRecordHandler
  implements ICommandHandler<DuplicateRecordCommand, DuplicateRecordResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
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
    command: DuplicateRecordCommand
  ): Promise<Result<DuplicateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<DuplicateRecordResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 2. Fetch source record
      const sourceRecord = yield* (
        await handler.tableRecordQueryRepository.findOne(context, table, command.recordId, {
          mode: 'stored',
        })
      ).mapErr((error: DomainError) =>
        isNotFoundError(error)
          ? domainError.notFound({ code: 'record.not_found', message: 'Record not found' })
          : error
      );

      // 3. Run create constraints before inserting new record
      yield* await handler.recordCreateConstraintService.checkCreate(context, command.tableId, 1);

      // 4. Extract non-computed field values from source record
      const fieldValues = new Map<string, unknown>();
      const fields = table.getFields();

      for (const field of fields) {
        // Skip computed fields - they will be recalculated
        if (field.computed().toBoolean()) {
          continue;
        }

        const fieldId = field.id().toString();
        const value = sourceRecord.fields[fieldId];

        // Only copy non-null/undefined values
        if (value !== null && value !== undefined) {
          fieldValues.set(fieldId, value);
        }
      }

      // 5. Execute side effects on field values
      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        table,
        [fieldValues],
        false // typecast = false, values are already in correct format
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      // 6. Create the record (validates and applies field values internally)
      const createResult = yield* tableForCreate.createRecord(fieldValues, {
        typecast: false,
      });

      // 7. Resolve values that require external lookups (user/link)
      let record = createResult.record;
      if (createResult.mutateSpec) {
        const needsResolution = yield* handler.recordMutationSpecResolver.needsResolution(
          createResult.mutateSpec
        );
        if (needsResolution) {
          const resolvedSpec = yield* await handler.recordMutationSpecResolver.resolveAndReplace(
            context,
            createResult.mutateSpec
          );
          record = yield* resolvedSpec.mutate(record);
        }
      }

      // 8. Persist the record within a transaction
      const transactionResult = await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<RecordMutationResult, DomainError>(async function* () {
            if (tableUpdateResult) {
              yield* await handler.tableUpdateFlow.execute(
                transactionContext,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
            }
            const result = yield* await handler.tableRecordRepository.insert(
              transactionContext,
              tableForCreate,
              record,
              command.order ? { order: command.order } : undefined
            );
            return ok(result);
          });
        }
      );
      const mutationResult = yield* transactionResult;

      // 9. Pull and publish events
      const events = tableForCreate.pullDomainEvents();
      yield* await handler.eventBus.publishMany(context, events);

      const recordFields: Record<string, unknown> = {};
      for (const entry of record.fields().entries()) {
        recordFields[entry.fieldId.toString()] = entry.value.toValue();
      }

      yield* await handler.undoRedoService.recordEntry(context, table.id(), {
        undoCommand: {
          type: 'DeleteRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            recordIds: [record.id().toString()],
          },
        },
        redoCommand: {
          type: 'RestoreRecords',
          version: 1,
          payload: {
            tableId: table.id().toString(),
            records: [
              {
                recordId: record.id().toString(),
                fields: recordFields,
              },
            ],
          },
        },
      });

      // 10. Build field key mapping for response transformation (using field ID)
      const fieldKeyMapping = new Map<string, string>();
      for (const field of tableForCreate.getFields()) {
        const fieldId = field.id().toString();
        const key = FieldKeyResolverService.getFieldKey(field, FieldKeyType.Id);
        fieldKeyMapping.set(fieldId, key);
      }

      return ok(
        DuplicateRecordResult.create(
          record,
          events,
          fieldKeyMapping,
          mutationResult?.computedChanges
        )
      );
    });
  }
}
