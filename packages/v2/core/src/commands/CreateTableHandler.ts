import { inject, injectable } from '@teable/v2-di';
import { ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import { FieldCreationSideEffectFlow } from '../application/services/FieldCreationSideEffectFlow';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import * as EventBusPort from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import * as LoggerPort from '../ports/Logger';
import * as TableRepositoryPort from '../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../ports/TableSchemaRepository';
import { v2CoreTokens } from '../ports/tokens';
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
    @inject(v2CoreTokens.fieldCreationSideEffectFlow)
    private readonly fieldCreationSideEffectFlow: FieldCreationSideEffectFlow,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.logger)
    private readonly logger: LoggerPort.ILogger,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async handle(
    context: IExecutionContext,
    command: CreateTableCommand
  ): Promise<Result<CreateTableResult, string>> {
    this.logger.debug('CreateTableHandler.start', {
      actorId: context.actorId.toString(),
      baseId: command.baseId.toString(),
      tableName: command.tableName.toString(),
      fieldCount: command.fields.length,
      viewCount: command.views.length,
    });

    const unitOfWork = this.unitOfWork;
    const tableRepository = this.tableRepository;
    const tableSchemaRepository = this.tableSchemaRepository;
    const fieldCreationSideEffectFlow = this.fieldCreationSideEffectFlow;
    const eventBus = this.eventBus;
    const baseId = command.baseId;
    const result = await safeTry<CreateTableResult, string>(async function* () {
      const table = yield* buildTable(command);
      const tableFields = table.fields();
      const transactionResult = yield* await unitOfWork.withTransaction(
        context,
        async (transactionContext) => {
          const resultAsync = safeTry<
            { table: Table; sideEffectEvents: ReadonlyArray<IDomainEvent> },
            string
          >(async function* () {
            const persistedTable = yield* await tableRepository.insert(transactionContext, table);
            yield* await tableSchemaRepository.insert(transactionContext, persistedTable);
            const sideEffectEvents = yield* await fieldCreationSideEffectFlow.execute({
              context: transactionContext,
              baseId,
              table,
              fields: tableFields,
            });
            return ok<{ table: Table; sideEffectEvents: ReadonlyArray<IDomainEvent> }, string>({
              table: persistedTable,
              sideEffectEvents,
            });
          });
          return await resultAsync;
        }
      );
      const { table: persistedTable, sideEffectEvents } = transactionResult;
      const events = [...table.pullDomainEvents(), ...sideEffectEvents];
      yield* await eventBus.publishMany(context, events);
      return ok(CreateTableResult.create(persistedTable, events));
    });
    if (result.isOk()) {
      this.logger.debug('CreateTableHandler.success', {
        baseId: command.baseId.toString(),
        tableId: result.value.table.id().toString(),
        eventCount: result.value.events.length,
      });
    }
    return result;
  }
}
