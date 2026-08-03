import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { TableQueryService } from '../application/services/TableQueryService';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { inject, injectable } from '@teable/v2-di';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { ApplyRecordOrdersCommand } from './ApplyRecordOrdersCommand';

export class ApplyRecordOrdersResult {
  private constructor(readonly updatedRecordIds: ReadonlyArray<string>) {}

  static create(updatedRecordIds: ReadonlyArray<string>): ApplyRecordOrdersResult {
    return new ApplyRecordOrdersResult([...updatedRecordIds]);
  }
}

@CommandHandler(ApplyRecordOrdersCommand)
@injectable()
export class ApplyRecordOrdersHandler
  implements ICommandHandler<ApplyRecordOrdersCommand, ApplyRecordOrdersResult>
{
  private static readonly UPDATE_BATCH_SIZE = 500;

  private static *buildBatches(
    updates: ReadonlyArray<RecordUpdateResult>
  ): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> {
    for (let i = 0; i < updates.length; i += ApplyRecordOrdersHandler.UPDATE_BATCH_SIZE) {
      yield ok(updates.slice(i, i + ApplyRecordOrdersHandler.UPDATE_BATCH_SIZE));
    }
  }

  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.tableRecordQueryRepository)
    private readonly tableRecordQueryRepository: TableRecordQueryRepositoryPort.ITableRecordQueryRepository,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyRecordOrdersCommand
  ): Promise<Result<ApplyRecordOrdersResult, DomainError>> {
    const handler = this;
    return safeTry<ApplyRecordOrdersResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);
      yield* table.getView(command.viewId);

      const recordsWithOrder = command.records.filter(
        (item): item is (typeof command.records)[number] & { order: number } =>
          typeof item.order === 'number'
      );

      if (recordsWithOrder.length === 0) {
        return ok(ApplyRecordOrdersResult.create([]));
      }

      const previousOrdersResult = await handler.tableRecordQueryRepository.find(
        context,
        table,
        RecordByIdsSpec.create(recordsWithOrder.map((item) => item.recordId)),
        { mode: 'stored', includeOrders: true }
      );
      if (previousOrdersResult.isErr()) {
        return err(previousOrdersResult.error);
      }

      const viewIdText = command.viewId.toString();
      const previousOrdersByRecordId: Record<string, number> = {};
      for (const record of previousOrdersResult.value.records) {
        const order = record.orders?.[viewIdText];
        if (typeof order === 'number') {
          previousOrdersByRecordId[record.id] = order;
        }
      }

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) =>
        safeTry<void, DomainError>(async function* () {
          const updates = recordsWithOrder.map((item) =>
            TableRecord.create({
              id: item.recordId,
              tableId: table.id(),
              fieldValues: [],
            }).map((record) =>
              RecordUpdateResult.create(
                record,
                new SetRowOrderValueSpec(command.viewId, item.order)
              )
            )
          );

          const resolvedUpdates: RecordUpdateResult[] = [];
          for (const updateResult of updates) {
            const update = yield* updateResult;
            resolvedUpdates.push(update);
          }

          const persistResult = await handler.tableRecordRepository.updateManyStream(
            transactionContext,
            table,
            ApplyRecordOrdersHandler.buildBatches(resolvedUpdates)
          );
          if (persistResult.isErr()) {
            return err(persistResult.error);
          }

          return ok(undefined);
        })
      );

      const ordersByRecordId = recordsWithOrder.reduce<Record<string, number>>((acc, item) => {
        acc[item.recordId.toString()] = item.order;
        return acc;
      }, {});

      const events: IDomainEvent[] = [
        RecordReordered.create({
          tableId: table.id(),
          baseId: table.baseId(),
          viewId: command.viewId,
          recordIds: recordsWithOrder.map((item) => item.recordId),
          ordersByRecordId,
          previousOrdersByRecordId,
        }),
      ];
      yield* await handler.eventBus.publishMany(context, events);

      return ok(
        ApplyRecordOrdersResult.create(recordsWithOrder.map((item) => item.recordId.toString()))
      );
    });
  }
}
