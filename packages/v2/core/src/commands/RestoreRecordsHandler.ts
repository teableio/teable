import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type {
  RecordFieldValueDTO,
  RecordValuesDTO,
} from '../domain/table/events/RecordFieldValuesDTO';
import { RecordsBatchCreated } from '../domain/table/events/RecordsBatchCreated';
import { FieldId } from '../domain/table/fields/FieldId';
import { RecordId } from '../domain/table/records/RecordId';
import { TableRecord } from '../domain/table/records/TableRecord';
import { TableRecordCellValue } from '../domain/table/records/TableRecordFields';
import * as EventBusPort from '../ports/EventBus';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { BatchRecordMutationResult } from '../ports/TableRecordRepository';
import * as TableRecordRepositoryPort from '../ports/TableRecordRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { RestoreRecordsCommand } from './RestoreRecordsCommand';

export class RestoreRecordsResult {
  private constructor(
    readonly restoredCount: number,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(restoredCount: number, events: ReadonlyArray<IDomainEvent>): RestoreRecordsResult {
    return new RestoreRecordsResult(restoredCount, [...events]);
  }
}

@CommandHandler(RestoreRecordsCommand)
@injectable()
export class RestoreRecordsHandler
  implements ICommandHandler<RestoreRecordsCommand, RestoreRecordsResult>
{
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.tableRecordRepository)
    private readonly tableRecordRepository: TableRecordRepositoryPort.ITableRecordRepository,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableUpdateFlow)
    private readonly tableUpdateFlow: TableUpdateFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: RestoreRecordsCommand
  ): Promise<Result<RestoreRecordsResult, DomainError>> {
    const handler = this;
    return safeTry<RestoreRecordsResult, DomainError>(async function* () {
      const table = yield* await handler.tableQueryService.getById(context, command.tableId);

      const fieldValueMaps = command.records.map(
        (record) => new Map(Object.entries(record.fields))
      );

      const sideEffectResult = yield* handler.recordWriteSideEffectService.execute(
        table,
        fieldValueMaps,
        false
      );
      const tableForInsert = sideEffectResult.table;
      const tableUpdateResult = sideEffectResult.updateResult;

      const records: TableRecord[] = [];
      for (const record of command.records) {
        const recordId = yield* RecordId.create(record.recordId);
        const fieldValues: Array<{ fieldId: FieldId; value: TableRecordCellValue }> = [];

        for (const [fieldIdRaw, rawValue] of Object.entries(record.fields)) {
          const fieldId = yield* FieldId.create(fieldIdRaw);
          const cellValue = yield* TableRecordCellValue.create(rawValue);
          fieldValues.push({ fieldId, value: cellValue });
        }

        const tableRecord = yield* TableRecord.create({
          id: recordId,
          tableId: tableForInsert.id(),
          fieldValues,
        });
        records.push(tableRecord);
      }

      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        return safeTry<BatchRecordMutationResult, DomainError>(async function* () {
          if (tableUpdateResult) {
            yield* await handler.tableUpdateFlow.execute(
              transactionContext,
              { table },
              () => ok(tableUpdateResult),
              { publishEvents: false }
            );
          }
          return handler.tableRecordRepository.insertMany(
            transactionContext,
            tableForInsert,
            records
          );
        });
      });

      const eventRecords: RecordValuesDTO[] = command.records.map((record) => {
        const fields: RecordFieldValueDTO[] = Object.entries(record.fields).map(
          ([fieldId, value]) => ({
            fieldId,
            value,
          })
        );
        return { recordId: record.recordId, fields, orders: record.orders };
      });

      const events: IDomainEvent[] =
        eventRecords.length > 0
          ? [
              RecordsBatchCreated.create({
                tableId: tableForInsert.id(),
                baseId: tableForInsert.baseId(),
                records: eventRecords,
              }),
            ]
          : [];

      if (events.length > 0) {
        yield* await handler.eventBus.publishMany(context, events);
      }

      return ok(RestoreRecordsResult.create(records.length, events));
    });
  }
}
