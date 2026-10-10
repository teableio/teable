import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import {
  toUndoRedoStackAppendContext,
  UndoRedoStackService,
} from '../application/services/UndoRedoStackService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { domainWrite, type IDomainWriteTransaction } from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { createUndoRedoCommand } from '../ports/UndoRedoStore';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ReorderRecordsCommand } from './ReorderRecordsCommand';

export class ReorderRecordsResult {
  private constructor(readonly updatedRecordIds: ReadonlyArray<string>) {}

  static create(updatedRecordIds: ReadonlyArray<string>): ReorderRecordsResult {
    return new ReorderRecordsResult([...updatedRecordIds]);
  }
}

@CommandHandler(ReorderRecordsCommand)
@injectable()
export class ReorderRecordsHandler
  implements ICommandHandler<ReorderRecordsCommand, ReorderRecordsResult>
{
  private static readonly UPDATE_BATCH_SIZE = 500;
  private static *buildBatches(
    updates: ReadonlyArray<RecordUpdateResult>
  ): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    for (let i = 0; i < updates.length; i += ReorderRecordsHandler.UPDATE_BATCH_SIZE) {
      yield ok(updates.slice(i, i + ReorderRecordsHandler.UPDATE_BATCH_SIZE));
    }
  }

  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.recordOrderCalculator)
    private readonly recordOrderCalculator: IRecordOrderCalculator,
    @inject(v2CoreTokens.undoRedoService)
    private readonly undoRedoStackService: UndoRedoStackService,
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ReorderRecordsCommand
  ): Promise<Result<ReorderRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<ReorderRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      // Validate view exists
      yield* table.getView(command.order.viewId);

      const previousOrdersByRecordId: Record<string, number> = {};

      const viewIdStr = command.order.viewId.toString();

      const orderResult = await handler.recordOrderCalculator.calculateOrders(
        context,
        table,
        command.order.viewId,
        command.order.anchorId,
        command.order.position,
        command.recordIds.length
      );
      if (orderResult.isErr()) {
        return err(orderResult.error);
      }

      const orderValues = orderResult.value;

      const previousOrdersResult = await handler.tableRecordQueryRepository.find(
        context,
        table,
        RecordByIdsSpec.create(command.recordIds),
        { mode: 'stored', includeOrders: true }
      );
      if (previousOrdersResult.isErr()) {
        return err(previousOrdersResult.error);
      }

      const previousOrderMap = new Map<string, number>();
      for (const record of previousOrdersResult.value.records) {
        const order = record.orders?.[viewIdStr];
        if (order !== undefined) {
          previousOrderMap.set(record.id, order);
        }
      }

      for (const recordId of command.recordIds) {
        const previousOrder = previousOrderMap.get(recordId.toString());
        if (previousOrder !== undefined) {
          previousOrdersByRecordId[recordId.toString()] = previousOrder;
        }
      }

      const committed = yield* await handler.domainWriteTransaction.execute(
        context,
        async (transactionContext) => {
          try {
            const updateResults: RecordUpdateResult[] = [];
            const ordersByRecordId: Record<string, number> = {};

            for (let i = 0; i < command.recordIds.length; i++) {
              const recordId = command.recordIds[i]!;
              const orderValue = orderValues[i]!;
              ordersByRecordId[recordId.toString()] = orderValue;

              const mutateSpec = new SetRowOrderValueSpec(command.order.viewId, orderValue);
              const recordResult = TableRecord.create({
                id: recordId,
                tableId: table.id(),
                fieldValues: [],
              });
              if (recordResult.isErr()) return err(recordResult.error);
              updateResults.push(RecordUpdateResult.create(recordResult.value, mutateSpec));
            }

            const updateResult = await handler.tableRecordRepository.updateManyStream(
              transactionContext,
              table,
              ReorderRecordsHandler.buildBatches(updateResults)
            );
            if (updateResult.isErr()) return err(updateResult.error);

            const events: IDomainEvent[] = [
              RecordReordered.create({
                tableId: table.id(),
                baseId: table.baseId(),
                viewId: command.order.viewId,
                recordIds: command.recordIds,
                ordersByRecordId,
                previousOrdersByRecordId,
              }),
            ];

            return ok(domainWrite.fromEvents({ ordersByRecordId }, events));
          } catch (error) {
            return err(
              domainError.unexpected({
                message: error instanceof Error ? error.message : 'Failed to reorder records',
                code: 'record.reorder_failed',
              })
            );
          }
        }
      );

      const ordersByRecordId = committed.value.ordersByRecordId;
      const changedOrders = command.recordIds.flatMap((recordId) => {
        const recordIdText = recordId.toString();
        const previousOrder = previousOrdersByRecordId[recordIdText];
        const nextOrder = ordersByRecordId[recordIdText];
        if (previousOrder === nextOrder) {
          return [];
        }

        return [
          {
            recordId: recordIdText,
            ...(previousOrder !== undefined ? { previousOrder } : {}),
            ...(nextOrder !== undefined ? { nextOrder } : {}),
          },
        ];
      });

      if (changedOrders.length > 0) {
        yield* await handler.undoRedoStackService.appendEntry(
          toUndoRedoStackAppendContext(context),
          table.id(),
          {
            undoCommand: createUndoRedoCommand('ApplyRecordOrders', {
              tableId: table.id().toString(),
              viewId: command.order.viewId.toString(),
              records: changedOrders.map((item) => ({
                recordId: item.recordId,
                ...(item.previousOrder !== undefined ? { order: item.previousOrder } : {}),
              })),
            }),
            redoCommand: createUndoRedoCommand('ApplyRecordOrders', {
              tableId: table.id().toString(),
              viewId: command.order.viewId.toString(),
              records: changedOrders.map((item) => ({
                recordId: item.recordId,
                ...(item.nextOrder !== undefined ? { order: item.nextOrder } : {}),
              })),
            }),
          }
        );
      }

      return ok(
        ReorderRecordsResult.create(command.recordIds.map((recordId) => recordId.toString()))
      );
    });
  }
}
