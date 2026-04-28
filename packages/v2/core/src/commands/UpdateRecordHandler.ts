import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldKeyResolverService } from '../application/services/FieldKeyResolverService';
import {
  type IForeignTableLoaderService,
  NullForeignTableLoaderService,
} from '../application/services/ForeignTableLoaderService';
import { type IRecordChangedValueDecoratorService } from '../application/services/RecordChangedValueDecoratorService';
import { requireRecordUpdateSnapshot } from '../application/services/RecordMutationSnapshotContract';
import { RecordMutationSpecResolverService } from '../application/services/RecordMutationSpecResolverService';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { RecordWriteUndoRedoPlanService } from '../application/services/RecordWriteUndoRedoPlanService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { RecordFieldChangeDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import { RecordUpdateResult as SingleRecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { RecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { composeUndoRedoCommands, createUndoRedoCommand } from '../ports/UndoRedoStore';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { toTableRecord } from './shared/toTableRecord';
import { UpdateRecordCommand } from './UpdateRecordCommand';
const buildScopedUpdateForbiddenError = (tableId: string) =>
  domainError.forbidden({
    code: 'record_write_plugin.scope_forbidden',
    message: 'Record write target includes rows outside the allowed scope.',
    details: {
      operation: RecordWriteOperationKind.updateOne,
      tableId,
      requestedRecordCount: 1,
      authorizedRecordCount: 0,
    },
  });

const areFieldValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) {
    return true;
  }

  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
};

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
    @inject(v2CoreTokens.recordOrderCalculator)
    private readonly recordOrderCalculator: IRecordOrderCalculator,
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
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: IForeignTableLoaderService = new NullForeignTableLoaderService()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: UpdateRecordCommand
  ): Promise<Result<UpdateRecordResult, DomainError>> {
    const handler = this;
    return safeTry<UpdateRecordResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      // Resolve field keys using FieldKeyResolverService (supports id/name/dbFieldName)
      // When fieldKeyType='id', keys are returned as-is; table.updateRecord will do intelligent lookup
      const updateRecordSpan = context.tracer?.startSpan('teable.UpdateRecordHandler.updateRecord');
      const resolvedFields = yield* FieldKeyResolverService.resolveFieldKeys(
        table,
        Object.fromEntries(command.fieldValues),
        command.fieldKeyType
      );
      const resolvedFieldValues = new Map(Object.entries(resolvedFields));
      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateOne,
        executionContext: context,
        table,
        payload: {
          recordId: command.recordId,
          fieldValues: resolvedFieldValues,
          fieldKeyType: command.fieldKeyType,
          typecast: command.typecast,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const pluginRecordSpec = yield* pluginExecution.getRecordSpec();

      // Query the current record after plugin guard passes to capture old values and row order.
      const currentRecord = yield* await handler.tableRecordQueryRepository.findOne(
        context,
        table,
        command.recordId,
        { mode: 'stored', includeOrders: true }
      );
      if (pluginRecordSpec) {
        const currentRecordEntity = yield* toTableRecord(table, currentRecord);
        if (!pluginRecordSpec.isSatisfiedBy(currentRecordEntity)) {
          return err(buildScopedUpdateForbiddenError(table.id().toString()));
        }
      }

      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        context,
        table,
        [resolvedFieldValues],
        command.typecast
      );
      const tableForUpdate = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;
      const sideEffectUndoRedoPlan =
        yield* await handler.recordWriteUndoRedoPlanService.captureSelectOptionSideEffects(
          context,
          table,
          tableForUpdate,
          sideEffectResult.effects
        );

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
          return safeTry<
            {
              mutation: RecordMutationResult;
              tableEvents: ReadonlyArray<IDomainEvent>;
              previousOrder?: number;
              nextOrder?: number;
            },
            DomainError
          >(async function* () {
            let tableEvents: ReadonlyArray<IDomainEvent> = [];
            if (tableUpdateResult) {
              const tableFlowResult = yield* await handler.tableUpdateFlow.execute(
                transactionContext,
                { table },
                () => ok(tableUpdateResult),
                { publishEvents: false }
              );
              tableEvents = tableFlowResult.events;
            }
            yield* await pluginExecution.beforePersist(transactionContext);
            const fillLinkTitleForeignTables = command.typecast
              ? yield* await handler.foreignTableLoaderService.loadForLinkTitleFill(
                  transactionContext,
                  [recordUpdateResult.mutateSpec ?? null]
                )
              : new Map();
            const mutation = yield* await handler.tableRecordRepository.updateOne(
              transactionContext,
              tableForUpdate,
              command.recordId,
              mutateSpec,
              {
                ...(command.typecast ? { fillLinkTitles: true } : {}),
                ...(fillLinkTitleForeignTables.size > 0 ? { fillLinkTitleForeignTables } : {}),
              }
            );

            let previousOrder: number | undefined;
            let nextOrder: number | undefined;

            if (command.order) {
              const viewId = command.order.viewId;
              const viewIdText = viewId.toString();
              previousOrder = currentRecord.orders?.[viewIdText] ?? currentRecord.autoNumber;

              const orderValuesResult = await handler.recordOrderCalculator.calculateOrders(
                transactionContext,
                tableForUpdate,
                viewId,
                command.order.anchorId,
                command.order.position,
                1
              );
              if (orderValuesResult.isErr()) {
                return err(orderValuesResult.error);
              }

              nextOrder = orderValuesResult.value[0];
              if (previousOrder !== nextOrder) {
                const orderOnlyRecord = yield* TableRecord.create({
                  id: command.recordId,
                  tableId: table.id(),
                  fieldValues: [],
                });
                const orderUpdate = SingleRecordUpdateResult.create(
                  orderOnlyRecord,
                  new SetRowOrderValueSpec(viewId, nextOrder)
                );
                const persistOrderResult = await handler.tableRecordRepository.updateManyStream(
                  transactionContext,
                  tableForUpdate,
                  (function* () {
                    yield ok([orderUpdate]);
                  })()
                );
                if (persistOrderResult.isErr()) {
                  return err(persistOrderResult.error);
                }
              }
            }

            return ok({ mutation, tableEvents, previousOrder, nextOrder });
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
      const mutationApplied = mutationResult.mutation.mutationApplied !== false;
      const changedFieldValues = new Map<string, unknown>(
        mutationResult.mutation.changedFields ?? []
      );
      if (mutationApplied) {
        for (const entry of updatedRecord.fields().entries()) {
          const fieldId = entry.fieldId.toString();
          const newValue = entry.value.toValue();
          if (!areFieldValuesEqual(currentRecord.fields[fieldId], newValue)) {
            changedFieldValues.set(fieldId, newValue);
          }
        }
      }
      const updatedFieldValues =
        yield* await handler.recordChangedValueDecoratorService.decorateChangedFields(
          tableForUpdate,
          changedFieldValues.size > 0 ? changedFieldValues : undefined,
          currentRecord.fields
        );
      for (const [fieldId, newValue] of updatedFieldValues ?? new Map<string, unknown>()) {
        if (areFieldValuesEqual(currentRecord.fields[fieldId], newValue)) {
          continue;
        }
        changes.push({
          fieldId,
          oldValue: currentRecord.fields[fieldId],
          newValue,
        });
      }
      // 3. Create and publish RecordUpdated event
      // Use the actual version from the current record for ShareDB sync
      const oldVersion = currentRecord.version;
      const newVersion = oldVersion + 1;
      const events: IDomainEvent[] = [...mutationResult.tableEvents];
      if (changes.length > 0) {
        events.push(
          RecordUpdated.create({
            tableId: table.id(),
            baseId: table.baseId(),
            recordId: command.recordId,
            oldVersion,
            newVersion,
            changes,
            source: 'user',
          })
        );
      }

      if (command.order && mutationResult.previousOrder !== mutationResult.nextOrder) {
        events.push(
          RecordReordered.create({
            tableId: table.id(),
            baseId: table.baseId(),
            viewId: command.order.viewId,
            recordIds: [command.recordId],
            ordersByRecordId: {
              [command.recordId.toString()]: mutationResult.nextOrder as number,
            },
            previousOrdersByRecordId:
              mutationResult.previousOrder !== undefined
                ? {
                    [command.recordId.toString()]: mutationResult.previousOrder,
                  }
                : {},
          })
        );
      }
      yield* await handler.eventBus.publishMany(context, events);

      const orderUndoCommands =
        command.order && mutationResult.previousOrder !== mutationResult.nextOrder
          ? [
              createUndoRedoCommand('ApplyRecordOrders', {
                tableId: table.id().toString(),
                viewId: command.order.viewId.toString(),
                records: [
                  {
                    recordId: command.recordId.toString(),
                    ...(mutationResult.previousOrder !== undefined
                      ? { order: mutationResult.previousOrder }
                      : {}),
                  },
                ],
              }),
            ]
          : [];
      const orderRedoCommands =
        command.order && mutationResult.previousOrder !== mutationResult.nextOrder
          ? [
              createUndoRedoCommand('ApplyRecordOrders', {
                tableId: table.id().toString(),
                viewId: command.order.viewId.toString(),
                records: [
                  {
                    recordId: command.recordId.toString(),
                    ...(mutationResult.nextOrder !== undefined
                      ? { order: mutationResult.nextOrder }
                      : {}),
                  },
                ],
              }),
            ]
          : [];

      if (changes.length > 0) {
        const updateSnapshotResult = requireRecordUpdateSnapshot(
          {
            operation: 'update',
            tableId: table.id().toString(),
            recordId: command.recordId.toString(),
          },
          mutationResult.mutation.updateSnapshot
        );
        if (updateSnapshotResult.isErr()) {
          return err(updateSnapshotResult.error);
        }
        yield* await handler.undoRedoStackService.appendRecordUpdateFromSnapshot(
          toUndoRedoStackAppendContext(context),
          {
            tableId: table.id(),
            recordId: command.recordId,
            snapshot: updateSnapshotResult.value,
            fieldIds: changes.map((change) => change.fieldId),
            undoCommandsAfter: [...sideEffectUndoRedoPlan.undoCommands, ...orderUndoCommands],
            redoCommandsBefore: [...sideEffectUndoRedoPlan.redoCommands, ...orderRedoCommands],
          }
        );
      } else if (
        sideEffectUndoRedoPlan.undoCommands.length > 0 ||
        sideEffectUndoRedoPlan.redoCommands.length > 0 ||
        orderUndoCommands.length > 0 ||
        orderRedoCommands.length > 0
      ) {
        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          table.id(),
          {
            undoCommand: composeUndoRedoCommands([
              ...sideEffectUndoRedoPlan.undoCommands,
              ...orderUndoCommands,
            ]),
            redoCommand: composeUndoRedoCommands([
              ...sideEffectUndoRedoPlan.redoCommands,
              ...orderRedoCommands,
            ]),
          }
        );
      }
      await pluginExecution.afterCommit();

      const mergedRecord = yield* TableRecord.fromRawFieldValues({
        id: command.recordId.toString(),
        tableId: table.id(),
        fields: {
          ...Object.fromEntries(
            Object.entries(currentRecord.fields).filter(
              ([, value]) => value !== null && value !== undefined
            )
          ),
          ...Object.fromEntries(
            updatedRecord
              .fields()
              .entries()
              .map((entry) => [entry.fieldId.toString(), entry.value.toValue()])
          ),
          ...(updatedFieldValues ? Object.fromEntries(updatedFieldValues) : {}),
        },
      });

      return ok(
        UpdateRecordResult.create(
          mergedRecord,
          events,
          extendedFieldKeyMapping,
          mutationResult.mutation.computedChanges
        )
      );
    });
  }
}
