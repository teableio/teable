import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { RecordCreationService } from '../application/services/RecordCreationService';
import {
  preLeasePlan,
  sharedRecordWritePlan,
} from '../application/services/RecordWriteCoordinationPlan';
import { RecordWriteSideEffectService } from '../application/services/RecordWriteSideEffectService';
import { TableQueryService } from '../application/services/TableQueryService';
import { withRecordWriteCoordination } from '../application/services/withRecordWriteCoordination';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { TableRecord } from '../domain/table/records/TableRecord';
import type { Table } from '../domain/table/Table';
import { NoopRecordOrderColumnPreparer } from '../ports/defaults/NoopRecordOrderColumnPreparer';
import * as ExecutionContextPort from '../ports/ExecutionContext';
import type { IRecordOrderColumnPreparer } from '../ports/RecordOrderColumnPreparer';
import { RecordWriteOperationKind } from '../ports/RecordWritePlugin';
import {
  NoopTableSchemaCoordination,
  type ITableSchemaCoordination,
} from '../ports/TableSchemaCoordination';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { CreateRecordCommand } from './CreateRecordCommand';

export class CreateRecordResult {
  private constructor(
    readonly record: TableRecord,
    readonly events: ReadonlyArray<IDomainEvent>,
    readonly fieldKeyMapping: Map<string, string>,
    readonly computedChanges?: ReadonlyMap<string, unknown>
  ) {}

  static create(
    record: TableRecord,
    events: ReadonlyArray<IDomainEvent>,
    fieldKeyMapping: Map<string, string> = new Map(),
    computedChanges?: ReadonlyMap<string, unknown>
  ): CreateRecordResult {
    return new CreateRecordResult(record, [...events], fieldKeyMapping, computedChanges);
  }
}

@CommandHandler(CreateRecordCommand)
@injectable()
export class CreateRecordHandler implements ICommandHandler<
  CreateRecordCommand,
  CreateRecordResult
> {
  constructor(
    @inject(v2CoreTokens.tableQueryService)
    private readonly tableQueryService: TableQueryService,
    @inject(v2CoreTokens.recordCreationService)
    private readonly recordCreationService: RecordCreationService,
    @inject(v2CoreTokens.recordWriteSideEffectService)
    private readonly recordWriteSideEffectService: RecordWriteSideEffectService,
    @inject(v2CoreTokens.tableSchemaCoordination)
    private readonly tableSchemaCoordination: ITableSchemaCoordination = new NoopTableSchemaCoordination(),
    @inject(v2CoreTokens.recordOrderColumnPreparer)
    private readonly orderColumnPreparer: IRecordOrderColumnPreparer = new NoopRecordOrderColumnPreparer()
  ) {}

  @TraceSpan()
  async handle(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordCommand
  ): Promise<Result<CreateRecordResult, DomainError>> {
    const preparation = await this.prepareOrder(context, command);
    if (preparation.isErr()) return err(preparation.error);
    const orderColumnPrepared = preparation.value;

    return withRecordWriteCoordination({
      context,
      tableId: command.tableId,
      coordination: this.tableSchemaCoordination,
      initialPlan:
        command.order && !orderColumnPrepared
          ? preLeasePlan({ hasOrder: true })
          : sharedRecordWritePlan,
      loadTable: () => this.tableQueryService.getById(context, command.tableId),
      planForTable: (table) =>
        this.recordWriteSideEffectService.planCreateCoordination(context, table, {
          recordsFieldValues: [command.fieldValues],
          fieldKeyType: command.fieldKeyType,
          typecast: command.typecast,
          conservativeOnProbeError: false,
        }),
      execute: (table) => this.executeCreate(context, command, table, orderColumnPrepared),
    });
  }

  /**
   * T8080: the view row-order column is schema state. Create it, backfill it
   * and build its index on the request's non-transactional context before the
   * coordination lease. The wrapper reloads metadata under the shared lease on
   * purpose, so the probe decides on state the lease protects; ordered creates
   * therefore read metadata once here and once for the write.
   */
  private async prepareOrder(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordCommand
  ): Promise<Result<boolean, DomainError>> {
    if (!command.order) return ok(false);

    const table = await this.tableQueryService.getById(context, command.tableId);
    if (table.isErr()) return err(table.error);
    return this.orderColumnPreparer.prepareOrderColumn(context, table.value, command.order.viewId);
  }

  private async executeCreate(
    context: ExecutionContextPort.IExecutionContext,
    command: CreateRecordCommand,
    table: Table,
    orderColumnPrepared: boolean
  ): Promise<Result<CreateRecordResult, DomainError>> {
    const handler = this; // NOSONAR typescript:S7740 -- generator functions cannot be arrow functions, so `this` must be captured
    return safeTry<CreateRecordResult, DomainError>(async function* () {
      const result = yield* await handler.recordCreationService.create(context, {
        table,
        fieldValues: command.fieldValues,
        fieldKeyType: command.fieldKeyType,
        typecast: command.typecast,
        source: command.source,
        operationKind: RecordWriteOperationKind.createOne,
        order: command.order,
        orderColumnPrepared,
      });

      return ok(
        CreateRecordResult.create(
          result.record,
          result.events,
          result.fieldKeyMapping,
          result.computedChanges
        )
      );
    });
  }
}
