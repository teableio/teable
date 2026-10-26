import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordBulkUpdateService } from '../application/services/RecordBulkUpdateService';
import { preLeasePlan } from '../application/services/RecordWriteCoordinationPlan';
import { TableQueryService } from '../application/services/TableQueryService';
import { withRecordWriteCoordination } from '../application/services/withRecordWriteCoordination';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { FieldKeyMapping } from '../domain/table/records/RecordCreateResult';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { type IExecutionContext } from '../ports/ExecutionContext';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { UpdateRecordsCommand } from './UpdateRecordsCommand';

export class UpdateRecordsResult {
  private constructor(
    readonly updatedCount: number,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly records?: ReadonlyArray<TableRecord>,
    readonly fieldKeyMapping: FieldKeyMapping = new Map()
  ) {}

  static create(
    updatedCount: number,
    events: ReadonlyArray<IDomainEvent>,
    records?: ReadonlyArray<TableRecord>,
    fieldKeyMapping: FieldKeyMapping = new Map()
  ) {
    return new UpdateRecordsResult(
      updatedCount,
      [...events],
      records ? [...records] : undefined,
      fieldKeyMapping
    );
  }
}

@injectable()
export class UpdateRecordsApplicationService {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordBulkUpdateService)
    private readonly recordBulkUpdateService: RecordBulkUpdateService,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination()
  ) {}

  @TraceSpan()
  async execute(
    context: IExecutionContext,
    command: UpdateRecordsCommand
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    return withRecordWriteCoordination({
      context,
      tableId: command.tableId,
      coordination: this.tableSchemaCoordination,
      initialPlan: preLeasePlan({ hasOrder: command.order != null }),
      loadTable: () => this.tableQueryService.getById(context, command.tableId),
      planForTable: (table) =>
        this.recordBulkUpdateService.planCoordination(context, {
          table,
          hasOrder: command.order != null,
          fieldValues: command.fieldValues,
          records: command.records,
          typecast: command.typecast,
          fieldKeyType: command.fieldKeyType,
        }),
      execute: (table) => this.executeWrite(context, command, table),
    });
  }

  private async executeWrite(
    context: IExecutionContext,
    command: UpdateRecordsCommand,
    table: Table
  ): Promise<Result<UpdateRecordsResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured

    return safeTry<UpdateRecordsResult, DomainError>(async function* () {
      const result = yield* await handler.recordBulkUpdateService.update(context, {
        table,
        fieldValues: command.fieldValues,
        filter: command.filter,
        recordIds: command.recordIds,
        records: command.records,
        typecast: command.typecast,
        deferComputedUpdates: command.deferComputedUpdates,
        enqueueDeferredComputedUpdates: command.enqueueDeferredComputedUpdates,
        fieldKeyType: command.fieldKeyType,
        order: command.order,
        recordWritePluginRunnerOptions: command.recordWritePluginRunnerOptions,
      });

      return ok(
        UpdateRecordsResult.create(
          result.updatedCount,
          result.events,
          result.records,
          result.fieldKeyMapping ?? new Map()
        )
      );
    });
  }
}
