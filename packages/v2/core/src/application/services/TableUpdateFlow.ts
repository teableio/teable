import { inject, injectable } from '@teable/v2-di';
import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';

import type { TableUpdateCommand } from '../../commands/TableUpdateCommand';
import type { BaseId } from '../../domain/base/BaseId';
import { domainError, isNotFoundError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldOptionsAdded } from '../../domain/table/events/FieldOptionsAdded';
import { FieldUpdated } from '../../domain/table/events/FieldUpdated';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import * as EventBusPort from '../../ports/EventBus';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';

type TableUpdateMutate = (table: Table) => Result<TableUpdateResult, DomainError>;
type TableUpdateFlowHook = (
  context: IExecutionContext,
  table: Table,
  mutateSpec: ISpecification<Table, ITableSpecVisitor>
) => Promise<Result<TableUpdateFlowHookResult | ReadonlyArray<IDomainEvent>, DomainError>>;

type TableUpdateFlowHookResult = {
  events: ReadonlyArray<IDomainEvent>;
  table?: Table;
};

type TableUpdateTarget =
  | {
      table: Table;
    }
  | TableUpdateCommand
  | {
      baseId?: BaseId;
      tableId: TableId;
    };

type TableUpdateFlowOptions = {
  publishEvents?: boolean;
  hooks?: TableUpdateFlowHooks;
};

type TableUpdateFlowHooks = {
  prepare?: TableUpdateFlowHook;
  afterPersist?: TableUpdateFlowHook;
};

type TableSchemaRepositoryRefresher = {
  refreshInMemoryTableAfterUpdate(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>>;
};

type TableSchemaRepositoryDeferredBackfillReplayer = {
  replayDeferredBackfillAfterUpdate(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>>;
};

type TableSchemaRepositoryPostPersistPresenceEventCollector = {
  collectPostPersistPresenceEventsAfterUpdate(
    context: IExecutionContext,
    table: Table,
    mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<ReadonlyArray<IDomainEvent>, DomainError>>;
};

export type TableUpdateFlowResult = {
  table: Table;
  events: ReadonlyArray<IDomainEvent>;
};

const normalizeHookResult = (
  result: TableUpdateFlowHookResult | ReadonlyArray<IDomainEvent>
): TableUpdateFlowHookResult => {
  if ('events' in result) {
    return {
      events: result.events,
      table: result.table,
    };
  }
  return { events: result };
};

const isTableSchemaRepositoryRefresher = (
  repository: TableSchemaRepositoryPort.ITableSchemaRepository
): repository is TableSchemaRepositoryPort.ITableSchemaRepository &
  TableSchemaRepositoryRefresher => {
  return (
    typeof (repository as Partial<TableSchemaRepositoryRefresher>)
      .refreshInMemoryTableAfterUpdate === 'function'
  );
};

const isTableSchemaRepositoryDeferredBackfillReplayer = (
  repository: TableSchemaRepositoryPort.ITableSchemaRepository
): repository is TableSchemaRepositoryPort.ITableSchemaRepository &
  TableSchemaRepositoryDeferredBackfillReplayer => {
  return (
    typeof (repository as Partial<TableSchemaRepositoryDeferredBackfillReplayer>)
      .replayDeferredBackfillAfterUpdate === 'function'
  );
};

const isTableSchemaRepositoryPostPersistPresenceEventCollector = (
  repository: TableSchemaRepositoryPort.ITableSchemaRepository
): repository is TableSchemaRepositoryPort.ITableSchemaRepository &
  TableSchemaRepositoryPostPersistPresenceEventCollector => {
  return (
    typeof (repository as Partial<TableSchemaRepositoryPostPersistPresenceEventCollector>)
      .collectPostPersistPresenceEventsAfterUpdate === 'function'
  );
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
      const presenceEvents: IDomainEvent[] = [];
      const table = yield* await handler.resolveTable(context, target);
      let tableUpdatePersistResult: TableRepositoryPort.TableUpdatePersistResult | void = undefined;

      const span = context.tracer?.startSpan('teable.TableUpdateFlow.mutate');
      const updated = yield* mutate(table);
      span?.end();

      let latestTable = updated.table;
      const hostEvents = latestTable.pullDomainEvents();
      events.push(...hostEvents);

      const mutateSpec = updated.mutateSpec;
      yield* await handler.unitOfWork.withTransaction(context, async (transactionContext) => {
        return safeTry<void, DomainError>(async function* () {
          if (options?.hooks?.prepare) {
            const prepareHookResult = yield* await options.hooks.prepare(
              transactionContext,
              latestTable,
              mutateSpec
            );
            const normalizedResult = normalizeHookResult(prepareHookResult);
            events.push(...normalizedResult.events);
            latestTable = normalizedResult.table ?? latestTable;
          }

          tableUpdatePersistResult = yield* await handler.tableRepository.updateOne(
            transactionContext,
            latestTable,
            mutateSpec
          );
          yield* await handler.tableSchemaRepository.update(
            transactionContext,
            latestTable,
            mutateSpec
          );

          if (isTableSchemaRepositoryRefresher(handler.tableSchemaRepository)) {
            latestTable =
              yield* await handler.tableSchemaRepository.refreshInMemoryTableAfterUpdate(
                transactionContext,
                latestTable,
                mutateSpec
              );
          }

          if (
            isTableSchemaRepositoryPostPersistPresenceEventCollector(handler.tableSchemaRepository)
          ) {
            const postPersistPresenceEvents =
              yield* await handler.tableSchemaRepository.collectPostPersistPresenceEventsAfterUpdate(
                transactionContext,
                latestTable,
                mutateSpec
              );
            presenceEvents.push(...postPersistPresenceEvents);
          }

          if (options?.hooks?.afterPersist) {
            const afterPersistHookResult = yield* await options.hooks.afterPersist(
              transactionContext,
              latestTable,
              mutateSpec
            );
            const normalizedResult = normalizeHookResult(afterPersistHookResult);
            events.push(...normalizedResult.events);
            latestTable = normalizedResult.table ?? latestTable;
          }

          if (isTableSchemaRepositoryDeferredBackfillReplayer(handler.tableSchemaRepository)) {
            yield* await handler.tableSchemaRepository.replayDeferredBackfillAfterUpdate(
              transactionContext,
              latestTable,
              mutateSpec
            );
          }
          return ok(undefined);
        });
      });

      const normalizedEvents = handler.attachFieldEventVersions(events, tableUpdatePersistResult);

      if (publishEvents) {
        // Publish events directly; projections fetch data themselves
        if (normalizedEvents.length > 0) {
          yield* await handler.eventBus.publishMany(context, normalizedEvents);
        }
        if (presenceEvents.length > 0) {
          yield* await handler.eventBus.publishMany(context, presenceEvents);
        }
      }
      return ok({ table: latestTable, events: normalizedEvents });
    });
  }

  private attachFieldEventVersions(
    events: ReadonlyArray<IDomainEvent>,
    persistResult: TableRepositoryPort.TableUpdatePersistResult | void
  ): ReadonlyArray<IDomainEvent> {
    const fieldVersionChanges = persistResult?.fieldVersionChanges;
    if (!events.length || !fieldVersionChanges?.length) {
      return events;
    }

    const queueByFieldId = new Map<string, Array<TableRepositoryPort.FieldVersionChange>>();
    for (const change of fieldVersionChanges) {
      const queue = queueByFieldId.get(change.fieldId) ?? [];
      queue.push(change);
      queueByFieldId.set(change.fieldId, queue);
    }

    return events.map((event) => {
      if (!(event instanceof FieldUpdated) && !(event instanceof FieldOptionsAdded)) {
        return event;
      }

      if (event.oldVersion != null && event.newVersion != null) {
        return event;
      }

      const fieldId = event.fieldId.toString();
      const queue = queueByFieldId.get(fieldId);
      const versionChange = queue?.shift();
      if (!versionChange) {
        return event;
      }

      if (event instanceof FieldUpdated) {
        return FieldUpdated.create({
          tableId: event.tableId,
          baseId: event.baseId,
          fieldId: event.fieldId,
          updatedProperties: event.updatedProperties,
          changes: event.changes,
          propertySemantics: event.propertySemantics,
          oldVersion: versionChange.oldVersion,
          newVersion: versionChange.newVersion,
        });
      }

      return FieldOptionsAdded.create({
        tableId: event.tableId,
        baseId: event.baseId,
        fieldId: event.fieldId,
        options: event.options,
        oldVersion: versionChange.oldVersion,
        newVersion: versionChange.newVersion,
      });
    });
  }

  private async resolveTable(
    context: IExecutionContext,
    target: TableUpdateTarget
  ): Promise<Result<Table, DomainError>> {
    if ('table' in target) return ok(target.table);

    const tableRepository = this.tableRepository;
    const result = await safeTry<Table, DomainError>(async function* () {
      // baseId is optional - can query by tableId alone
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
