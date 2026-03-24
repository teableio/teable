import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import { RecordReordered } from '../../domain/table/events/RecordReordered';
import type { RecordInsertOrder } from '../../domain/table/records/RecordInsertOrder';
import { RecordId } from '../../domain/table/records/RecordId';
import { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import { SetRowOrderValueSpec } from '../../domain/table/records/specs/values/SetRowOrderValueSpec';
import { TableRecord } from '../../domain/table/records/TableRecord';
import type { Table } from '../../domain/table/Table';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { IRecordOrderCalculator } from '../../ports/RecordOrderCalculator';
import type { TableRecordReadModel } from '../../ports/TableRecordReadModel';
import type { ITableRecordRepository } from '../../ports/TableRecordRepository';
import { v2CoreTokens } from '../../ports/tokens';
import { createUndoRedoCommand, type UndoRedoCommandLeafData } from '../../ports/UndoRedoStore';

const UPDATE_BATCH_SIZE = 500;

export interface IRecordReorderInput {
  readonly table: Table;
  readonly recordIds: ReadonlyArray<RecordId>;
  readonly currentRecords: ReadonlyArray<TableRecordReadModel>;
  readonly order: RecordInsertOrder;
}

export interface IRecordReorderResult {
  readonly updatedCount: number;
  readonly events: ReadonlyArray<IDomainEvent>;
  readonly undoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
  readonly redoCommands: ReadonlyArray<UndoRedoCommandLeafData>;
}

export const emptyRecordReorderResult = (): IRecordReorderResult => ({
  updatedCount: 0,
  events: [],
  undoCommands: [],
  redoCommands: [],
});

const buildRecordUpdateBatches = (
  updates: ReadonlyArray<RecordUpdateResult>
): Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>> =>
  (function* () {
    for (let index = 0; index < updates.length; index += UPDATE_BATCH_SIZE) {
      yield ok(updates.slice(index, index + UPDATE_BATCH_SIZE));
    }
  })();

@injectable()
export class RecordReorderService {
  constructor(
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: ITableRecordRepository,
    @inject(v2CoreTokens.recordOrderCalculator)
    private readonly recordOrderCalculator: IRecordOrderCalculator
  ) {}

  async reorder(
    context: IExecutionContext,
    input: IRecordReorderInput
  ): Promise<Result<IRecordReorderResult, DomainError>> {
    const service = this;

    return safeTry<IRecordReorderResult, DomainError>(async function* () {
      if (input.recordIds.length === 0) {
        return ok(emptyRecordReorderResult());
      }

      const orderValues = yield* await service.recordOrderCalculator.calculateOrders(
        context,
        input.table,
        input.order.viewId,
        input.order.anchorId,
        input.order.position,
        input.recordIds.length
      );

      const previousOrdersByRecordId: Record<string, number> = {};
      const ordersByRecordId: Record<string, number> = {};
      const viewIdText = input.order.viewId.toString();
      const recordUpdates: RecordUpdateResult[] = [];

      for (let index = 0; index < input.recordIds.length; index++) {
        const recordId = input.recordIds[index]!;
        const currentRecord = input.currentRecords[index];
        const nextOrder = orderValues[index]!;
        const recordIdText = recordId.toString();

        if (currentRecord) {
          const previousOrder = currentRecord.orders?.[viewIdText] ?? currentRecord.autoNumber;
          if (previousOrder !== undefined) {
            previousOrdersByRecordId[recordIdText] = previousOrder;
          }
        }
        ordersByRecordId[recordIdText] = nextOrder;

        const record = yield* TableRecord.create({
          id: recordId,
          tableId: input.table.id(),
          fieldValues: [],
        });
        recordUpdates.push(
          RecordUpdateResult.create(record, new SetRowOrderValueSpec(input.order.viewId, nextOrder))
        );
      }

      const persistResult = yield* await service.tableRecordRepository.updateManyStream(
        context,
        input.table,
        buildRecordUpdateBatches(recordUpdates)
      );

      const changedRecords = input.recordIds.flatMap((recordId) => {
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

      if (changedRecords.length === 0) {
        return ok({
          updatedCount: persistResult.totalUpdated,
          events: [],
          undoCommands: [],
          redoCommands: [],
        });
      }

      return ok({
        updatedCount: persistResult.totalUpdated,
        events: [
          RecordReordered.create({
            tableId: input.table.id(),
            baseId: input.table.baseId(),
            viewId: input.order.viewId,
            recordIds: changedRecords.map((record) =>
              RecordId.create(record.recordId)._unsafeUnwrap()
            ),
            ordersByRecordId: Object.fromEntries(
              changedRecords.map((record) => [record.recordId, record.nextOrder as number])
            ),
            previousOrdersByRecordId: Object.fromEntries(
              changedRecords.flatMap((record) =>
                record.previousOrder !== undefined
                  ? [[record.recordId, record.previousOrder] as const]
                  : []
              )
            ),
          }),
        ],
        undoCommands: [
          createUndoRedoCommand('ApplyRecordOrders', {
            tableId: input.table.id().toString(),
            viewId: input.order.viewId.toString(),
            records: changedRecords.map((record) => ({
              recordId: record.recordId,
              ...(record.previousOrder !== undefined ? { order: record.previousOrder } : {}),
            })),
          }),
        ],
        redoCommands: [
          createUndoRedoCommand('ApplyRecordOrders', {
            tableId: input.table.id().toString(),
            viewId: input.order.viewId.toString(),
            records: changedRecords.map((record) => ({
              recordId: record.recordId,
              ...(record.nextOrder !== undefined ? { order: record.nextOrder } : {}),
            })),
          }),
        ],
      });
    });
  }
}
