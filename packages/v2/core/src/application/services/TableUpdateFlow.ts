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
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import type { TableId } from '../../domain/table/TableId';
import type { TableUpdateResult } from '../../domain/table/TableMutator';
import * as EventBusPort from '../../ports/EventBus';
import {
  registerAfterCommit,
  registerAfterRollback,
  type IExecutionContext,
} from '../../ports/ExecutionContext';
import * as TableRepositoryPort from '../../ports/TableRepository';
import * as TableSchemaRepositoryPort from '../../ports/TableSchemaRepository';
import { v2CoreTokens } from '../../ports/tokens';
import * as UnitOfWorkPort from '../../ports/UnitOfWork';
import {
  beginTableSchemaOperation,
  completeTableSchemaOperation,
  failTableSchemaOperation,
} from './TableSchemaOperationLifecycleService';
import {
  abortTableUpdateTransactionScope,
  enterTableUpdateTransactionScope,
  flushTableUpdateTransactionScope,
  recordLatestTableInTransactionScope,
} from './TableUpdateTransactionScope';

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
  // These hooks are for command/application side effects only. Repository-owned
  // post-persist work must stay behind the repository method boundary and flow
  // back out as aggregate domain events on the returned table.
  prepare?: TableUpdateFlowHook;
  afterPersist?: TableUpdateFlowHook;
};

export type TableUpdateFlowResult = {
  table: Table;
  events: ReadonlyArray<IDomainEvent>;
  postPersistEvents: ReadonlyArray<IDomainEvent>;
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
      const postPersistEvents: IDomainEvent[] = [];
      const table = yield* await handler.resolveTable(context, target);
      let tableUpdatePersistResult: TableRepositoryPort.TableUpdatePersistResult | void = undefined;

      const span = context.tracer?.startSpan('teable.TableUpdateFlow.mutate');
      const updated = yield* mutate(table);
      span?.end();

      let latestTable = updated.table;
      const hostEvents = latestTable.pullDomainEvents();
      events.push(...hostEvents);

      const mutateSpec = updated.mutateSpec;
      yield* await beginTableSchemaOperation(
        handler.unitOfWork,
        handler.tableRepository,
        context,
        latestTable,
        { type: 'table.update' }
      );

      let transactionContextRef: IExecutionContext | undefined;
      const transactionResult = await handler.unitOfWork.withTransaction(
        context,
        async (metaTransactionContext) => {
          transactionContextRef = metaTransactionContext;
          return safeTry<void, DomainError>(async function* () {
            enterTableUpdateTransactionScope(metaTransactionContext);

            if (options?.hooks?.prepare) {
              const prepareHookResult = yield* await options.hooks.prepare(
                metaTransactionContext,
                latestTable,
                mutateSpec
              );
              const normalizedResult = normalizeHookResult(prepareHookResult);
              events.push(...normalizedResult.events);
              latestTable = normalizedResult.table ?? latestTable;
            }

            tableUpdatePersistResult = yield* await handler.tableRepository.updateOne(
              metaTransactionContext,
              latestTable,
              mutateSpec
            );
            const dataPhaseResult = yield* await handler.unitOfWork.withTransaction(
              metaTransactionContext,
              async (dataTransactionContext) => {
                transactionContextRef = dataTransactionContext;
                return safeTry<void, DomainError>(async function* () {
                  latestTable = yield* await handler.tableSchemaRepository.update(
                    dataTransactionContext,
                    latestTable,
                    mutateSpec
                  );
                  recordLatestTableInTransactionScope(dataTransactionContext, latestTable);
                  postPersistEvents.push(...latestTable.pullDomainEvents());

                  if (options?.hooks?.afterPersist) {
                    const afterPersistHookResult = yield* await options.hooks.afterPersist(
                      dataTransactionContext,
                      latestTable,
                      mutateSpec
                    );
                    const normalizedResult = normalizeHookResult(afterPersistHookResult);
                    events.push(...normalizedResult.events);
                    latestTable = normalizedResult.table ?? latestTable;
                    recordLatestTableInTransactionScope(dataTransactionContext, latestTable);
                  }

                  yield* await flushTableUpdateTransactionScope(dataTransactionContext);
                  return ok(undefined);
                });
              },
              { scope: 'data' }
            );
            return ok(dataPhaseResult);
          });
        },
        { scope: 'meta' }
      );
      if (transactionResult.isErr()) {
        if (transactionContextRef) {
          abortTableUpdateTransactionScope(transactionContextRef);
        }
        yield* await failTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          latestTable,
          {
            lastError: transactionResult.error.message,
            type: 'table.update',
          }
        );
        return err(transactionResult.error);
      }

      const finalizeReady = async (): Promise<void> => {
        const readyResult = await completeTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          latestTable,
          { type: 'table.update' }
        );
        if (readyResult.isErr()) {
          throw new Error(readyResult.error.message);
        }
      };
      if (registerAfterCommit(context, finalizeReady)) {
        registerAfterRollback(context, async () => {
          const errorResult = await failTableSchemaOperation(
            handler.unitOfWork,
            handler.tableRepository,
            context,
            latestTable,
            {
              lastError: 'Parent transaction rolled back',
              type: 'table.update',
            }
          );
          if (errorResult.isErr()) {
            throw new Error(errorResult.error.message);
          }
        });
        // Reused outer data transactions finalize ready only after the parent
        // transaction commits, while a later outer rollback now flips the table
        // back to error for reconciliation instead of leaving it pending forever.
      } else {
        yield* await completeTableSchemaOperation(
          handler.unitOfWork,
          handler.tableRepository,
          context,
          latestTable,
          { type: 'table.update' }
        );
      }

      const normalizedEvents = handler.attachPersistedEventVersions(
        events,
        tableUpdatePersistResult
      );

      if (publishEvents) {
        // Publish events directly; projections fetch data themselves
        if (normalizedEvents.length > 0) {
          yield* await handler.eventBus.publishMany(context, normalizedEvents);
        }
        if (postPersistEvents.length > 0) {
          yield* await handler.eventBus.publishMany(context, postPersistEvents);
        }
      }
      return ok({ table: latestTable, events: normalizedEvents, postPersistEvents });
    });
  }

  private attachPersistedEventVersions(
    events: ReadonlyArray<IDomainEvent>,
    persistResult: TableRepositoryPort.TableUpdatePersistResult | void
  ): ReadonlyArray<IDomainEvent> {
    const fieldVersionChanges = persistResult?.fieldVersionChanges;
    const viewVersionChanges = persistResult?.viewVersionChanges;
    if (!events.length || (!fieldVersionChanges?.length && !viewVersionChanges?.length)) {
      return events;
    }

    const queueByFieldId = new Map<string, Array<TableRepositoryPort.FieldVersionChange>>();
    for (const change of fieldVersionChanges ?? []) {
      const queue = queueByFieldId.get(change.fieldId) ?? [];
      queue.push(change);
      queueByFieldId.set(change.fieldId, queue);
    }

    const queueByViewId = new Map<string, Array<TableRepositoryPort.ViewVersionChange>>();
    for (const change of viewVersionChanges ?? []) {
      const queue = queueByViewId.get(change.viewId) ?? [];
      queue.push(change);
      queueByViewId.set(change.viewId, queue);
    }

    return events.map((event) => {
      if (event instanceof FieldUpdated) {
        if (event.oldVersion != null && event.newVersion != null) {
          return event;
        }

        const fieldId = event.fieldId.toString();
        const queue = queueByFieldId.get(fieldId);
        const versionChange = queue?.shift();
        if (!versionChange) {
          return event;
        }

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

      if (event instanceof FieldOptionsAdded) {
        if (event.oldVersion != null && event.newVersion != null) {
          return event;
        }

        const fieldId = event.fieldId.toString();
        const queue = queueByFieldId.get(fieldId);
        const versionChange = queue?.shift();
        if (!versionChange) {
          return event;
        }

        return FieldOptionsAdded.create({
          tableId: event.tableId,
          baseId: event.baseId,
          fieldId: event.fieldId,
          options: event.options,
          oldVersion: versionChange.oldVersion,
          newVersion: versionChange.newVersion,
        });
      }

      if (event instanceof ViewColumnMetaUpdated) {
        if (event.oldVersion != null && event.newVersion != null) {
          return event;
        }

        const viewId = event.viewId.toString();
        const queue = queueByViewId.get(viewId);
        const versionChange = queue?.shift();
        if (!versionChange) {
          return event;
        }

        return ViewColumnMetaUpdated.create({
          tableId: event.tableId,
          baseId: event.baseId,
          viewId: event.viewId,
          fieldId: event.fieldId,
          oldVersion: versionChange.oldVersion,
          newVersion: versionChange.newVersion,
        });
      }

      return event;
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
