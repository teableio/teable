import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { requireRecordUpdateSnapshot } from '../application/services/RecordMutationSnapshotContract';
import { RecordWritePluginRunner } from '../application/services/RecordWritePluginRunner';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, isNotFoundError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { ButtonClicked } from '../domain/table/events/ButtonClicked';
import type { RecordFieldChangeDTO } from '../domain/table/events/RecordFieldValuesDTO';
import { RecordUpdated } from '../domain/table/events/RecordUpdated';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import type { ButtonClickPlan } from '../domain/table/methods/createButtonClickPlan';
import { RecordConditionSpecBuilder } from '../domain/table/records/specs/RecordConditionSpecBuilder';
import { TableRecord } from '../domain/table/records/TableRecord';
import { Table } from '../domain/table/Table';
import * as ButtonClickWorkflowServicePort from '../ports/ButtonClickWorkflowService';
import * as EventBusPort from '../ports/EventBus';
import { IExecutionContext } from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import {
  buildSanitizedRecordConditionSpec,
  replaceCurrentUserTagInFilter,
} from '../queries/RecordFilterMapper';
import { ClickButtonCommand } from './ClickButtonCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { toTableRecord } from './shared/toTableRecord';

export class ClickButtonResult {
  private constructor(
    readonly tableId: string,
    readonly fieldId: string,
    readonly runId: string,
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(
    tableId: string,
    fieldId: string,
    runId: string,
    record: TableRecord,
    events: ReadonlyArray<IDomainEvent>
  ): ClickButtonResult {
    return new ClickButtonResult(tableId, fieldId, runId, record, [...events]);
  }
}

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

@CommandHandler(ClickButtonCommand)
@injectable()
export class ClickButtonHandler implements ICommandHandler<ClickButtonCommand, ClickButtonResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.buttonClickWorkflowService)
    private readonly buttonClickWorkflowService: ButtonClickWorkflowServicePort.IButtonClickWorkflowService,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: ClickButtonCommand
  ): Promise<Result<ClickButtonResult, DomainError>> {
    const handler = this;
    return safeTry<ClickButtonResult, DomainError>(async function* () {
      const tableSpecBuilder = Table.specs().byId(command.tableId);
      if (command.shareScope) tableSpecBuilder.withViewId(command.shareScope.viewId);
      const tableSpec = yield* tableSpecBuilder.build();
      const table = yield* (await handler.tableRepository.findOne(context, tableSpec)).mapErr(
        (error) => {
          if (!isNotFoundError(error)) return error;
          return command.shareScope
            ? domainError.notFound({
                code: 'view.not_found',
                message: `View not found: ${command.shareScope.viewId.toString()}`,
              })
            : domainError.notFound({
                code: 'table.not_found',
                message: `Table not found: ${command.tableId.toString()}`,
              });
        }
      );
      const plan = yield* table.createButtonClickPlan({
        fieldId: command.fieldId,
        shareScope: command.shareScope,
      });
      const currentRecord = yield* await handler.loadCurrentRecord(context, table, command, plan);
      const currentRecordEntity = yield* toTableRecord(table, currentRecord);
      const currentValue = currentRecord.fields[command.fieldId.toString()];
      const recordUpdate = yield* plan.click(table, command.recordId, currentValue);
      const nextValue = recordUpdate.record.fields().get(command.fieldId)?.toValue();
      const fieldValues = new Map<string, unknown>([[command.fieldId.toString(), nextValue]]);

      const pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
        kind: RecordWriteOperationKind.updateOne,
        executionContext: context,
        table,
        payload: {
          recordId: command.recordId,
          fieldValues,
          fieldKeyType: FieldKeyType.Id,
          typecast: false,
        },
        isTransactionBound: false,
      });
      yield* await pluginExecution.guard();
      const pluginRecordSpec = yield* pluginExecution.getRecordSpec();
      if (pluginRecordSpec && !pluginRecordSpec.isSatisfiedBy(currentRecordEntity)) {
        return err(buildScopedUpdateForbiddenError(table.id().toString()));
      }
      const allowedFieldIds =
        yield* pluginExecution.getUpdateFieldIdsForRecord(currentRecordEntity);
      if (allowedFieldIds && !allowedFieldIds.has(command.fieldId.toString())) {
        return err(
          domainError.forbidden({
            code: 'record_write_plugin.update_fields_forbidden',
            message: 'Button Field is outside the allowed update scope.',
            details: {
              operation: RecordWriteOperationKind.updateOne,
              tableId: table.id().toString(),
              deniedFieldIds: [command.fieldId.toString()],
            },
          })
        );
      }

      const mutation = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) =>
          safeTry<TableRecordRepositoryPort.RecordMutationResult, DomainError>(async function* () {
            yield* await pluginExecution.beforePersist(transactionContext);
            const result = yield* await handler.tableRecordRepository.updateOne(
              transactionContext,
              table,
              command.recordId,
              recordUpdate.mutateSpec,
              { expectedVersion: currentRecord.version }
            );
            if (result.mutationApplied === false) {
              return err(
                domainError.conflict({
                  code: 'button.concurrent_click_conflict',
                  message: 'Button was changed by another request; retry the click.',
                  details: {
                    recordId: command.recordId.toString(),
                    expectedVersion: currentRecord.version,
                  },
                })
              );
            }
            return ok(result);
          })
      );

      const snapshot = yield* requireRecordUpdateSnapshot(
        {
          operation: 'update',
          tableId: table.id().toString(),
          recordId: command.recordId.toString(),
        },
        mutation.updateSnapshot
      );
      const oldValue = snapshot.previous.fields[command.fieldId.toString()];
      const newValue = snapshot.current.fields[command.fieldId.toString()];
      const changes: RecordFieldChangeDTO[] = [
        {
          fieldId: command.fieldId.toString(),
          oldValue,
          newValue,
        },
      ];
      const count =
        newValue != null && typeof newValue === 'object' && !Array.isArray(newValue)
          ? Number((newValue as { count?: unknown }).count) || 0
          : 0;
      const buttonClicked = ButtonClicked.create({
        tableId: table.id(),
        baseId: table.baseId(),
        recordId: command.recordId,
        fieldId: command.fieldId,
        count,
        workflowId: plan.workflowId(),
      });
      const events: IDomainEvent[] = [
        RecordUpdated.create({
          tableId: table.id(),
          baseId: table.baseId(),
          recordId: command.recordId,
          oldVersion: snapshot.oldVersion,
          newVersion: snapshot.newVersion,
          changes,
          source: 'user',
        }),
        buttonClicked,
      ];
      yield* await handler.eventBus.publishMany(context, events);
      yield* await handler.undoRedoStackService.appendButtonValueUpdateFromSnapshot(
        toUndoRedoStackAppendContext(context),
        {
          tableId: table.id(),
          recordId: command.recordId,
          snapshot,
          fieldId: command.fieldId.toString(),
        }
      );
      await pluginExecution.afterCommit();
      const workflowResult = yield* await handler.buttonClickWorkflowService.trigger(
        context,
        buttonClicked
      );

      const responseRecord = yield* TableRecord.fromRawFieldValues({
        id: command.recordId.toString(),
        tableId: table.id(),
        fields: { [command.fieldId.toString()]: newValue },
      });
      return ok(
        ClickButtonResult.create(
          table.id().toString(),
          command.fieldId.toString(),
          workflowResult.runId,
          responseRecord,
          events
        )
      );
    });
  }

  private async loadCurrentRecord(
    context: IExecutionContext,
    table: Table,
    command: ClickButtonCommand,
    plan: ButtonClickPlan
  ): Promise<Result<TableRecordReadModel, DomainError>> {
    if (!command.shareScope) {
      return this.tableRecordQueryRepository.findOne(context, table, command.recordId, {
        mode: 'stored',
      });
    }

    const filter = replaceCurrentUserTagInFilter(
      table,
      plan.viewFilter(),
      context.actorId.toString()
    );
    const viewCondition = buildSanitizedRecordConditionSpec(table, filter);
    if (viewCondition.isErr()) return err(viewCondition.error);
    const specBuilder = RecordConditionSpecBuilder.create().recordId(command.recordId);
    if (viewCondition.value) specBuilder.addConditionSpec(viewCondition.value);
    const spec = specBuilder.build();
    if (spec.isErr()) return err(spec.error);
    const result = await this.tableRecordQueryRepository.find(context, table, spec.value, {
      mode: 'stored',
      includeTotal: false,
    });
    if (result.isErr()) return err(result.error);
    const record = result.value.records[0];
    if (record) return ok(record);
    return err(
      domainError.forbidden({
        code: 'button.shared_record_forbidden',
        message: 'Record is outside the shared View scope.',
        details: { recordId: command.recordId.toString() },
      })
    );
  }
}
