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
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordCreateConstraintService } from '../ports/RecordCreateConstraintService';
import type { RecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordCommand } from './CreateRecordCommand';

export class CreateRecordResult {
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
  ): CreateRecordResult {
    return new CreateRecordResult(record, [...events], fieldKeyMapping, computedChanges);
  }
}

@CommandHandler(CreateRecordCommand)
@injectable()
export class CreateRecordHandler
  implements ICommandHandler<CreateRecordCommand, CreateRecordResult>
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
    command: CreateRecordCommand
  ): Promise<Result<CreateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<CreateRecordResult, DomainError>(async function* () {
      // 1. Get the table
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // Run create constraints before inserting new record
      yield* await handler.recordCreateConstraintService.checkCreate(context, command.tableId, 1);

      // Resolve field keys to field IDs if using name or dbFieldName
      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        table,
        Object.fromEntries(command.fieldValues),
        command.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));

      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        table,
        [resolvedFieldValues],
        command.typecast
      );
      const tableForCreate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      // 2. Create the record (validates and applies field values internally)
      const tracer = context.tracer;
      const createRecordSpan = tracer?.startSpan('teable.CreateRecordHandler.createRecord');
      const createResult = yield* tableForCreate.createRecord(resolvedFieldValues, {
        typecast: command.typecast,
      });

      // 3. Resolve values that require external lookups (user/link)
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
          // Re-apply the resolved spec to get the correct record values
          record = yield* resolvedSpec.mutate(record);
        }
      }

      let mutationResult: RecordMutationResult | undefined;
      try {
        const runTransaction = () =>
          handler.unitOfWork.withTransaction(context, async (transactionContext) => {
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

      // 4. Pull events from Table aggregate root and publish
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

      // 5. Build field key mapping for response transformation
      const fieldKeyMapping = new Map<string, string>();
      if (command.fieldKeyType !== FieldKeyType.Id) {
        for (const field of tableForCreate.getFields()) {
          const fieldId = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, command.fieldKeyType);
          fieldKeyMapping.set(fieldId, key);
        }
      }

      return ok(
        CreateRecordResult.create(record, events, fieldKeyMapping, mutationResult?.computedChanges)
      );
    });
  }
}
