import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TableUpdateCommand } from '../../commands/TableUpdateCommand';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { AbstractTableUpdatedEvent } from '../../domain/table/events/AbstractTableUpdatedEvent';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import * as EventBusPort from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { ITablePersistenceDTO } from '../../ports/mappers/TableMapper';
import * as TableMapperPort from '../../ports/mappers/TableMapper';
import * as TableRepositoryPort from '../../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';

type TableUpdateMutate = (table: Table) => Result<TableUpdateResult, DomainError>;
type TableUpdateFlowHook = (
  context: IExecutionContext,
  table: Table,
  mutateSpec: ISpecification<Table, ITableSpecVisitor>
) => Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>>;

type TableUpdateTarget =
  | {
      table: Table;
    }
  | TableUpdateCommand;

type TableUpdateFlowOptions = {
  publishEvents?: boolean;
  hooks?: TableUpdateFlowHooks;
};

type TableUpdateFlowHooks = {
  prepare?: TableUpdateFlowHook;
  afterPersist?: TableUpdateFlowHook;
};

export type TableUpdateFlowResult = {
  table: Table;
  events: ReadonlyArray<IDomainEvent>;
};

@injectable()
// Application service: wraps transactional table updates, persistence, schema changes, and events.
// Mutations are provided by domain code; this class only orchestrates ports.
export class TableUpdateFlow {
  constructor(
    @inject(v2CoreTokens.tableRepository)
    private readonly tableRepository: TableRepositoryPort.ITableRepository,
    @inject(v2CoreTokens.tableSchemaRepository)
    private readonly tableSchemaRepository: TableSchemaRepositoryPort.ITableSchemaRepository,
    @inject(v2CoreTokens.tableMapper)
    private readonly tableMapper: TableMapperPort.ITableMapper,
    @inject(v2CoreTokens.eventBus)
    private readonly eventBus: EventBusPort.IEventBus,
    @inject(v2CoreTokens.unitOfWork)
    private readonly unitOfWork: UnitOfWorkPort.IUnitOfWork
  ) {}

  async execute(
    context: IExecutionContext,
    target: TableUpdateTarget,
    mutate: TableUpdateMutate,
    options?: TableUpdateFlowOptions
  ): Promise<Result<TableUpdateFlowResult, DomainError>> {
    const publishEvents = options?.publishEvents ?? true;
    const handler = this;
    return await safeTry<TableUpdateFlowResult, DomainError>(async function* () {
      const events: IDomainEvent[] = [];
      const table = yield* await handler.resolveTable(context, target);

      const span = context.tracer?.startSpan('teable.TableUpdateFlow.mutate');
      const updated = yield* mutate(table);
      span?.end();

      const updatedTable = updated.table;
      const hostEvents = updatedTable.pullDomainEvents();
      events.push(...hostEvents);

      const mutateSpec = updated.mutateSpec;
      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        return safeTry<void, DomainError>(async function* () {
          if (options?.hooks?.prepare) {
            const prepareEvents = yield* await options.hooks.prepare(
              transactionContext,
              updatedTable,
              mutateSpec
            );
            events.push(...prepareEvents);
          }

          yield* await handler.tableRepository.updateOne(
            transactionContext,
            updatedTable,
            mutateSpec
          );
          yield* await handler.tableSchemaRepository.update(
            transactionContext,
            updatedTable,
            mutateSpec
          );

          if (options?.hooks?.afterPersist) {
            const afterPersistEvents = yield* await options.hooks.afterPersist(
              transactionContext,
              updatedTable,
              mutateSpec
            );
            events.push(...afterPersistEvents);
          }
          return ok(undefined);
        });
      });

      if (publishEvents) {
        const snapshotResult = handler.tableMapper.toDTO(updatedTable);
        if (snapshotResult.isErr()) return err(snapshotResult.error);
        const enrichedEvents = yield* await handler.enrichEventsWithSnapshots(
          context,
          events,
          updatedTable,
          snapshotResult.value,
          new Set(hostEvents)
        );
        yield* await handler.eventBus.publishMany(context, enrichedEvents);
      }
      return ok({ table: updatedTable, events });
    });
  }

  /**
   * Enriches table-updated events with per-table snapshots (host + side effects).
   */
  private async enrichEventsWithSnapshots(
    context: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>,
    hostTable: Table,
    hostSnapshot: ITablePersistenceDTO,
    hostEventSet: ReadonlySet<IDomainEvent>
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>> {
    const handler = this;
    return safeTry<ReadonlyArray<IDomainEvent>, DomainError>(async function* () {
      const snapshots = new Map<string, ITablePersistenceDTO>();

      const enriched: IDomainEvent[] = [];
      for (const event of events) {
        if (!(event instanceof AbstractTableUpdatedEvent) || event.hasSnapshot()) {
          enriched.push(event);
          continue;
        }

        const tableId = event.tableId.toString();
        let snapshot = snapshots.get(tableId);
        if (!snapshot) {
          if (hostEventSet.has(event)) {
            snapshot = hostSnapshot;
          } else {
            const spec = yield* TableAggregate.specs(event.baseId).byId(event.tableId).build();
            const tableResult = yield* await handler.tableRepository.findOne(context, spec);
            const tableSnapshot = yield* handler.tableMapper.toDTO(tableResult);
            snapshots.set(tableId, tableSnapshot);
            snapshot = tableSnapshot;
          }
        }

        enriched.push(event.withSnapshot(snapshot));
      }

      return ok(enriched);
    });
  }

  private async resolveTable(
    context: IExecutionContext,
    target: TableUpdateTarget
  ): Promise<Result<Table, DomainError>> {
    if ('table' in target) return ok(target.table);

    const tableRepository = this.tableRepository;
    const result = await safeTry<Table, DomainError>(async function* () {
      const whereSpec = yield* TableAggregate.specs(target.baseId).byId(target.tableId).build();
      const tableResult = await tableRepository.findOne(context, whereSpec);
      if (tableResult.isErr()) {
        if (isNotFoundError(tableResult.error)) {
          return err(
            domainError.notFound({
              code: 'table.not_found',
              message: 'Table not found',
            })
          );
        }
        return err(tableResult.error);
      }
      return ok(tableResult.value);
    });
    return result;
  }
}
