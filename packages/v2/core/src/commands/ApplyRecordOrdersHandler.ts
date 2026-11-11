import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import {
  RecordWritePluginRunner,
  type RecordWritePluginExecution,
} from '../application/services/RecordWritePluginRunner';
import { TableQueryService } from '../application/services/TableQueryService';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import { RecordReordered } from '../domain/table/events/RecordReordered';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { RecordUpdateResult } from '../domain/table/records/RecordUpdateResult';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { SetRowOrderValueSpec } from '../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../domain/table/records/TableRecord';
import { domainWrite, type IDomainWriteTransaction } from '../ports/DomainWriteTransaction';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import * as TableRecordQueryRepositoryPort from '../ports/TableRecordQueryRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { ApplyRecordOrdersCommand } from './ApplyRecordOrdersCommand';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { toTableRecord } from './shared/toTableRecord';

export class ApplyRecordOrdersResult {
  private constructor(readonly updatedRecordIds: ReadonlyArray<string>) {}

  static create(updatedRecordIds: ReadonlyArray<string>): ApplyRecordOrdersResult {
    return new ApplyRecordOrdersResult([...updatedRecordIds]);
  }
}

@CommandHandler(ApplyRecordOrdersCommand)
@injectable()
export class ApplyRecordOrdersHandler implements ICommandHandler<
  ApplyRecordOrdersCommand,
  ApplyRecordOrdersResult
> {
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
    @inject(v2CoreTokens.domainWriteTransaction)
    private readonly domainWriteTransaction: IDomainWriteTransaction,
    @inject(v2CoreTokens.recordWritePluginRunner)
    private readonly recordWritePluginRunner: RecordWritePluginRunner
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: ApplyRecordOrdersCommand
  ): Promise<Result<ApplyRecordOrdersResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
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

      const recordIds = recordsWithOrder.map((item) => item.recordId);
      let pluginExecution: RecordWritePluginExecution | undefined;
      if (command.source === 'recordUpdate') {
        const fieldValues = new Map<string, unknown>();
        pluginExecution = yield* await handler.recordWritePluginRunner.prepare({
          kind: RecordWriteOperationKind.updateMany,
          executionContext: context,
          table,
          payload: {
            variant: 'explicit',
            recordUpdates: recordsWithOrder.map((item) => ({
              recordId: item.recordId,
              fieldValues,
            })),
            fieldKeyType: FieldKeyType.Id,
            typecast: false,
            recordIds,
            recordCount: recordsWithOrder.length,
          },
          isTransactionBound: false,
        });
        yield* await pluginExecution.guard();
      }

      const previousOrdersResult = await handler.tableRecordQueryRepository.find(
        context,
        table,
        RecordByIdsSpec.create(recordIds),
        { mode: 'stored', includeOrders: true }
      );
      if (previousOrdersResult.isErr()) {
        return err(previousOrdersResult.error);
      }
      const pluginRecordSpec = pluginExecution ? yield* pluginExecution.getRecordSpec() : undefined;
      if (pluginRecordSpec) {
        const authorizedRecordIds = new Set<string>();
        for (const record of previousOrdersResult.value.records) {
          const recordEntity = yield* toTableRecord(table, record);
          if (pluginRecordSpec.isSatisfiedBy(recordEntity)) {
            authorizedRecordIds.add(record.id);
          }
        }
        if (recordsWithOrder.some((item) => !authorizedRecordIds.has(item.recordId.toString()))) {
          return err(
            domainError.forbidden({
              code: 'record_write_plugin.scope_forbidden',
              message: 'Record write target includes rows outside the allowed scope.',
              details: {
                operation: RecordWriteOperationKind.updateMany,
                tableId: table.id().toString(),
              },
            })
          );
        }
      }

      const viewIdText = command.viewId.toString();
      const previousOrdersByRecordId: Record<string, number> = {};
      for (const record of previousOrdersResult.value.records) {
        const order = record.orders?.[viewIdText];
        if (typeof order === 'number') {
          previousOrdersByRecordId[record.id] = order;
        }
      }

      const committed = yield* await handler.domainWriteTransaction.execute(
        context,
        async (transactionContext) =>
          safeTry(async function* () {
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

            if (pluginExecution) {
              yield* await pluginExecution.beforePersist(transactionContext);
            }
            const persistResult = await handler.tableRecordRepository.updateManyStream(
              transactionContext,
              table,
              ApplyRecordOrdersHandler.buildBatches(resolvedUpdates)
            );
            if (persistResult.isErr()) {
              return err(persistResult.error);
            }

            const ordersByRecordId = recordsWithOrder.reduce<Record<string, number>>(
              (acc, item) => {
                acc[item.recordId.toString()] = item.order;
                return acc;
              },
              {}
            );

            return ok(
              domainWrite.fromEvents(
                ApplyRecordOrdersResult.create(
                  recordsWithOrder.map((item) => item.recordId.toString())
                ),
                [
                  RecordReordered.create({
                    tableId: table.id(),
                    baseId: table.baseId(),
                    viewId: command.viewId,
                    recordIds,
                    ordersByRecordId,
                    previousOrdersByRecordId,
                  }),
                ]
              )
            );
          })
      );

      await pluginExecution?.afterCommit();
      return ok(committed.value);
    });
  }
}
