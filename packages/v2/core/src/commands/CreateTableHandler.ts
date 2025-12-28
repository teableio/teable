import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectService } from '../application/services/FieldCreationSideEffectService';
import { ForeignTableLoaderService } from '../application/services/ForeignTableLoaderService';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import { IExecutionContext } from '../ports/ExecutionContext';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
import { TraceSpan } from '../ports/TraceSpan';
import * as UnitOfWorkPort from '../ports/UnitOfWork';
import { CommandHandler, type ICommandHandler } from './CommandHandler';
import { buildTable, CreateTableCommand } from './CreateTableCommand';

export class CreateTableResult {
  private constructor(
    readonly table: Table,
    readonly events: ReadonlyArray<IDomainEvent>
  ) {}

  static create(table: Table, events: ReadonlyArray<IDomainEvent>): CreateTableResult {
    return new CreateTableResult(table, [...events]);
  }
}

@CommandHandler(CreateTableCommand)
@injectable()
export class CreateTableHandler implements ICommandHandler<CreateTableCommand, CreateTableResult> {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.fieldCreationSideEffectService)
    private readonly fieldCreationSideEffectService: FieldCreationSideEffectService,
    @inject(v2CoreTokens.foreignTableLoaderService)
    private readonly foreignTableLoaderService: ForeignTableLoaderService,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  @TraceSpan()
  async handle(
    context: IExecutionContext,
    command: CreateTableCommand
  ): Promise<Result<CreateTableResult, string>> {
    const handler = this;
    return safeTry<CreateTableResult, string>(async function* () {
      const foreignTableReferences = yield* command.foreignTableReferences();
      const selfTableId = command.tableId;
      const referencesToLoad = selfTableId
        ? foreignTableReferences.filter(
            (reference) => !reference.foreignTableId.equals(selfTableId)
          )
        : foreignTableReferences;
      const foreignTables = yield* await handler.foreignTableLoaderService.load(context, {
        baseId: command.baseId,
        references: referencesToLoad,
      });
      const includeSelf =
        selfTableId !== undefined &&
        foreignTableReferences.some((reference) => reference.foreignTableId.equals(selfTableId));

      const span = context.tracer?.startSpan('teable.CreateTableHandler.handle.buildTable');
      const table = yield* buildTable(command, { foreignTables, includeSelf });
      span?.end();

      const tableFields = table.fields();
      const foreignTablesForSideEffects = includeSelf
        ? [
            ...new Map(
              [...foreignTables, table].map((value) => [value.id().toString(), value] as const)
            ).values(),
          ]
        : foreignTables;
      const transactionResult = yield* await handler.unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          return safeTry<{ table: Table; sideEffectEvents: ReadonlyArray<IDomainEvent> }, string>(
            async function* () {
              const persistedTable = yield* await handler.tableRepository.insert(
                transactionContext,
                table
              );
              yield* await handler.tableSchemaRepository.insert(transactionContext, persistedTable);
              const sideEffectEvents = yield* await handler.fieldCreationSideEffectService.execute(
                transactionContext,
                {
                  table,
                  fields: tableFields,
                  foreignTables: foreignTablesForSideEffects,
                }
              );
              return ok<{ table: Table; sideEffectEvents: ReadonlyArray<IDomainEvent> }, string>({
                table: persistedTable,
                sideEffectEvents,
              });
            }
          );
        }
      );
      const { table: persistedTable, sideEffectEvents } = transactionResult;
      const events = [...table.pullDomainEvents(), ...sideEffectEvents];
      yield* await handler.eventBus.publishMany(context, events);
      return ok(CreateTableResult.create(persistedTable, events));
    });
  }
}
