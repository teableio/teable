import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { FieldOperationPluginRunner } from '../application/services/FieldOperationPluginRunner';
import {
  collectFieldCreationAddSideEffects,
  prepareFieldAddSideEffectPlugins,
} from '../application/services/FieldOperationSideEffectPluginSupport';
import { FieldUndoRedoSnapshotService } from '../application/services/FieldUndoRedoSnapshotService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import type { Field } from '../domain/table/fields/Field';
import { Table as TableAggregate, type Table } from '../domain/table/Table';
import { ViewId } from '../domain/table/views/ViewId';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { FieldOperationKind, FieldOperationTargetKind } from '../ports/FieldOperationPlugin';
import * as TableRepositoryPort from '../ports/TableRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TeableSpanAttributes, createTeableSpanAttributes, type ISpan } from '../ports/Tracer';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import type { ResolvedTableFieldInput } from '../schemas/field';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateFieldCommand } from './CreateFieldCommand';
import { parseTableFieldSpec, resolveTableFieldInputName } from './TableFieldSpecs';

export class CreateFieldResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): CreateFieldResult {
    return new CreateFieldResult(table, [...events]);
  }
}

const withCreateFieldSpan = async <T>(
  context: ExecutionContextPort.IExecutionContext,
  operation: string,
  callback: () => T | Promise<T>,
  extra: Record<string, string | number | boolean> = {}
): Promise<T> => {
  const tracer = context.tracer;
  let span: ISpan | undefined;
  try {
    span = tracer?.startSpan(
      `teable.CreateFieldHandler.${operation}`,
      createTeableSpanAttributes('handler', `CreateFieldHandler.${operation}`, {
        [TeableSpanAttributes.HANDLER]: 'CreateFieldHandler',
        ...extra,
      })
    );
  } catch {
    span = undefined;
  }

  if (!span || !tracer) {
    return await callback();
  }

  return tracer.withSpan(span, async () => {
    try {
      return await callback();
    } catch (error) {
      span.recordError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      span.end();
    }
  });
};

@CommandHandler(CreateFieldCommand)
@injectable()
export class CreateFieldHandler implements ICommandHandler<CreateFieldCommand, CreateFieldResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.fieldOperationPluginRunner)
    private readonly fieldOperationPluginRunner: FieldOperationPluginRunner,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.fieldUndoRedoSnapshotService)
    private readonly fieldUndoRedoSnapshotService: FieldUndoRedoSnapshotService
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateFieldCommand
  ): Promise<Result<CreateFieldResult, DomainError>> {
    const handler = this;
    return safeTry<CreateFieldResult, DomainError>(async function* () {
      const spanAttrs = {
        [TeableSpanAttributes.TABLE_ID]: command.tableId.toString(),
      };
      const foreignTableReferences = yield* await withCreateFieldSpan(
        context,
        'resolveForeignTableReferences',
        async () => command.foreignTableReferences(),
        spanAttrs
      );
      const foreignTables = yield* await withCreateFieldSpan(
        context,
        'loadForeignTables',
        () =>
          handler.foreignTableLoaderService.load(context, {
            // Foreign references may point to tables in other bases (e.g. cross-base lookup).
            references: foreignTableReferences,
          }),
        spanAttrs
      );
      const tableSpec = yield* TableAggregate.specs(command.baseId).byId(command.tableId).build();
      const preloadedTable = command.preloadedTable;
      let table =
        preloadedTable?.baseId().toString() === command.baseId.toString() &&
        preloadedTable.id().toString() === command.tableId.toString()
          ? preloadedTable
          : undefined;
      if (!table) {
        table = yield* await handler.tableRepository.findOne(context, tableSpec);
      }
      const domainContext = ExecutionContextPort.getDomainContext(context);
      const existingNames = table.getFields().map((field) => field.name().toString());
      const resolvedField = yield* await withCreateFieldSpan(
        context,
        'resolveTableFieldInputName',
        async () =>
          resolveTableFieldInputName(command.field, existingNames, {
            t: context.$t,
            hostTable: table,
            foreignTables,
          }),
        spanAttrs
      );
      const normalizedField = await withCreateFieldSpan(
        context,
        'populateLinkLookupFieldId',
        async () => handler.populateLinkLookupFieldId(resolvedField, foreignTables),
        spanAttrs
      );
      const field = yield* await withCreateFieldSpan(
        context,
        'parseTableFieldSpec',
        async () =>
          parseTableFieldSpec(normalizedField, {
            isPrimary: false,
            executionContext: context,
          })
            .andThen((spec) =>
              spec.createField({ baseId: command.baseId, tableId: command.tableId })
            )
            .andThen((field) => {
              if (!normalizedField.dbFieldName) {
                return ok(field);
              }

              return DbFieldName.rehydrate(normalizedField.dbFieldName)
                .andThen((dbFieldName) => field.setDbFieldName(dbFieldName))
                .map(() => field);
            }),
        spanAttrs
      );
      const plannedSideEffects = yield* await withCreateFieldSpan(
        context,
        'collectFieldCreationAddSideEffects',
        () => collectFieldCreationAddSideEffects(table, [field], foreignTables, domainContext),
        {
          ...spanAttrs,
          [TeableSpanAttributes.FIELD_ID]: field.id().toString(),
        }
      );
      const basePluginContext = {
        kind: FieldOperationKind.create,
        executionContext: context,
        table,
        target: {
          kind: FieldOperationTargetKind.direct,
          sourceOperation: FieldOperationKind.create,
          sourceTable: table,
        },
        payload: {
          field: normalizedField,
          candidateField: field,
          order: command.order,
          foreignTables,
          domainContext,
        },
        isTransactionBound: false,
      } as const;
      const pluginExecution =
        yield* await handler.fieldOperationPluginRunner.prepare(basePluginContext);
      const sideEffectPluginExecution = yield* await prepareFieldAddSideEffectPlugins({
        runner: handler.fieldOperationPluginRunner,
        executionContext: context,
        sourceOperation: FieldOperationKind.create,
        sourceTable: table,
        foreignTables,
        domainContext,
        sideEffects: plannedSideEffects,
      });
      yield* await pluginExecution.guard();
      yield* await sideEffectPluginExecution.guard();
      const createdField: Field = field;
      const updateResult = yield* await handler.tableUpdateFlow.execute(
        context,
        { table },
        (table) => {
          const addFieldOptions = {
            foreignTables,
            domainContext,
          };
          if (!command.order) {
            const currentViewId = command.viewId;
            if (currentViewId) {
              return ViewId.create(currentViewId).andThen((viewId) =>
                table.update((mutator) =>
                  mutator.addField(field, { ...addFieldOptions, targetViewId: viewId })
                )
              );
            }
            return table.update((mutator) => mutator.addField(field, addFieldOptions));
          }

          const order = command.order;
          return ViewId.create(order.viewId).andThen((viewId) =>
            table.update((mutator) =>
              mutator.addField(field, {
                ...addFieldOptions,
                viewOrder: {
                  viewId,
                  order: order.orderIndex,
                },
              })
            )
          );
        },
        {
          hooks: {
            prepare: async (transactionContext, updatedTable) => {
              const beforePersistResult = await pluginExecution.beforePersist(transactionContext, {
                ...basePluginContext,
                executionContext: transactionContext,
                table: updatedTable,
                result: {
                  createdField,
                },
                isTransactionBound: true,
              });
              if (beforePersistResult.isErr()) {
                return err(beforePersistResult.error);
              }

              const sideEffectBeforePersistResult =
                await sideEffectPluginExecution.beforePersist(transactionContext);
              if (sideEffectBeforePersistResult.isErr()) {
                return err(sideEffectBeforePersistResult.error);
              }

              const previewResult = await handler.fieldCreationSideEffectService.preview({
                table: updatedTable,
                fields: [createdField],
                foreignTables,
                domainContext,
              });

              return previewResult.map(() => []);
            },
            afterPersist: async (transactionContext, updatedTable) =>
              safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
                if (!createdField)
                  return err(domainError.unexpected({ message: 'Field not created' }));
                const sideEffectExecuteResult =
                  await handler.fieldCreationSideEffectService.execute(transactionContext, {
                    table: updatedTable,
                    fields: [createdField],
                    foreignTables,
                    domainContext,
                  });
                const sideEffectResult = yield* sideEffectExecuteResult;

                return ok(sideEffectResult.events);
              }),
          },
        }
      );
      if (!createdField) {
        return err(domainError.unexpected({ message: 'Field not created' }));
      }

      if (handler.shouldCaptureUndoRedo(context)) {
        const snapshot = yield* await withCreateFieldSpan(
          context,
          'captureUndoRedoSnapshot',
          () =>
            handler.fieldUndoRedoSnapshotService.capture(
              context,
              updateResult.table,
              createdField.id()
            ),
          {
            ...spanAttrs,
            [TeableSpanAttributes.FIELD_ID]: createdField.id().toString(),
          }
        );
        yield* await withCreateFieldSpan(
          context,
          'appendUndoRedoEntry',
          () =>
            handler.undoRedoStackService.appendEntry(
              toUndoRedoStackAppendContext(context),
              updateResult.table.id(),
              {
                undoCommand: createUndoRedoCommand('DeleteField', {
                  baseId: command.baseId.toString(),
                  tableId: command.tableId.toString(),
                  fieldId: createdField.id().toString(),
                }),
                redoCommand: createUndoRedoCommand('ApplyFieldSnapshot', {
                  baseId: command.baseId.toString(),
                  tableId: command.tableId.toString(),
                  snapshot,
                }),
              }
            ),
          {
            ...spanAttrs,
            [TeableSpanAttributes.FIELD_ID]: createdField.id().toString(),
          }
        );
      }
      await pluginExecution.afterCommit({
        ...basePluginContext,
        table: updateResult.table,
        result: {
          createdField,
        },
      });
      await sideEffectPluginExecution.afterCommit();

      return ok(CreateFieldResult.create(updateResult.table, updateResult.events));
    });
  }

  private shouldCaptureUndoRedo(context: ExecutionContextPort.IExecutionContext): boolean {
    return Boolean(context.windowId) && context.undoRedo?.mode == null;
  }

  private populateLinkLookupFieldId(
    field: ResolvedTableFieldInput,
    foreignTables: ReadonlyArray<Table>
  ): ResolvedTableFieldInput {
    if (field.type !== 'link' || field.options.lookupFieldId != null) {
      return field;
    }

    const foreignTable = foreignTables.find(
      (table) => table.id().toString() === field.options.foreignTableId
    );
    if (!foreignTable) {
      return field;
    }

    return {
      ...field,
      options: {
        ...field.options,
        lookupFieldId: foreignTable.primaryFieldId().toString(),
      },
    };
  }
}
