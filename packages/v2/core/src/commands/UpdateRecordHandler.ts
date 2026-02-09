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
import type { RecordFieldChangeDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { RecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { UpdateRecordCommand } from './UpdateRecordCommand';

export class UpdateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: FieldKeyMapping,
    readonly computedChanges?: ReadonlyMap<string, unknown>
  ) {}

  static create(
    record: TableRecord,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: FieldKeyMapping = new Map(),
    computedChanges?: ReadonlyMap<string, unknown>
  ): UpdateRecordResult {
    return new UpdateRecordResult(record, [...events], fieldKeyMapping, computedChanges);
  }
}

@CommandHandler(UpdateRecordCommand)
@injectable()
export class UpdateRecordHandler
  implements ICommandHandler<UpdateRecordCommand, UpdateRecordResult>
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
    command: UpdateRecordCommand
  ): Promise<Result<UpdateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateRecordResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // 1. Query the current record to get old values
      const currentRecord = yield* await handler.tableRecordQueryRepository.findOne(
        context,
        table,
        command.recordId,
        { mode: 'stored' }
      );

      // Resolve field keys using FieldKeyResolverService (supports id/name/dbFieldName)
      // When fieldKeyType='id', keys are returned as-is; table.updateRecord will do intelligent lookup
      const updateRecordSpan = context.tracer?.startSpan('teable.UpdateRecordHandler.updateRecord');
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
      const tableForUpdate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      // table.updateRecord internally uses FieldByKeySpec for intelligent field lookup
      // and returns fieldKeyMapping (fieldId -> originalKey)
      const recordUpdateResult = yield* tableForUpdate.updateRecord(
        command.recordId,
        resolvedFieldValues,
        {
          typecast: command.typecast,
        }
      );
      updateRecordSpan?.end();

      // Resolve values that require external lookups (user/link)
      let mutateSpec = recordUpdateResult.mutateSpec;
      let updatedRecord = recordUpdateResult.record;
      if (mutateSpec) {
        const needsResolution =
          yield* handler.recordMutationSpecResolver.needsResolution(mutateSpec);
        if (needsResolution) {
          mutateSpec = yield* await handler.recordMutationSpecResolver.resolveAndReplace(
            context,
            mutateSpec
          );
          updatedRecord = yield* mutateSpec.mutate(updatedRecord);
        }
      }

      const mutationResult = yield* await handler.unitOfWork.withTransaction(
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
            const result = yield* await handler.tableRecordRepository.updateOne(
              transactionContext,
              tableForUpdate,
              command.recordId,
              mutateSpec
            );
            return ok(result);
          });
        }
      );

      // Build extended field key mapping that includes all fields (including computed fields)
      // This ensures computed field values can be keyed by field name when fieldKeyType is 'name'
      const extendedFieldKeyMapping = new Map(recordUpdateResult.fieldKeyMapping);
      if (command.fieldKeyType !== FieldKeyType.Id) {
        for (const field of table.getFields()) {
          const fieldIdStr = field.id().toString();
          const key = FieldKeyResolverService.getFieldKey(field, command.fieldKeyType);
          extendedFieldKeyMapping.set(fieldIdStr, key);
        }
      }

      // 2. Build changes array with old/new values (need to resolve field keys to IDs for event)
      const changes: RecordFieldChangeDTO[] = [];
      for (const [fieldId] of recordUpdateResult.fieldKeyMapping) {
        changes.push({
          fieldId,
          oldValue: currentRecord.fields[fieldId],
          newValue: resolvedFieldValues.get(fieldId),
        });
      }

      // 3. Create and publish RecordUpdated event
      // Use the actual version from the current record for ShareDB sync
      const oldVersion = currentRecord.version;
      const newVersion = oldVersion + 1;
      const events: IDomainEvent[] = [
        RecordUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordId: command.recordId,
          oldVersion,
          newVersion,
          changes,
          source: 'user',
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const change of changes) {
        oldValues[change.fieldId] = change.oldValue;
        newValues[change.fieldId] = change.newValue;
      }

      yield* await handler.undoRedoService.recordUpdateRecord(context, {
        tableId: table.id(),
        recordId: command.recordId,
        oldValues,
        newValues,
        recordVersionBefore: oldVersion,
        recordVersionAfter: newVersion,
      });

      return ok(
        UpdateRecordResult.create(
          updatedRecord,
          events,
          extendedFieldKeyMapping,
          mutationResult.computedChanges
        )
      );
    });
  }
}
