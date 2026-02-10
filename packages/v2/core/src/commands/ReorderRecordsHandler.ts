import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { IRecordOrderCalculator } from '../ports/RecordOrderCalculator';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
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
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ReorderRecordsCommand
  ): Promise<Result<ReorderRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<ReorderRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      // Validate view exists
      yield* table.getView(command.order.viewId);

      let orderValues: ReadonlyArray<number> = [];
      const ordersByRecordId: Record<string, number> = {};
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

      orderValues = orderResult.value;

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

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        try {
          const updateResults: RecordUpdateResult[] = [];

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

          return ok(undefined);
        } catch (error) {
          return err(
            domainError.unexpected({
              message: error instanceof Error ? error.message : 'Failed to reorder records',
              code: 'record.reorder_failed',
            })
          );
        }
      });

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
      yield* await handler.eventBus.publishMany(context, events);

      return ok(
        ReorderRecordsResult.create(command.recordIds.map((recordId) => recordId.toString()))
      );
    });
  }
}
