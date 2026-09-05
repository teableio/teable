import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { ViewDescriptionUpdated } from '../../domain/table/events/ViewDescriptionUpdated';
import { ViewFilterUpdated } from '../../domain/table/events/ViewFilterUpdated';
import { ViewGroupUpdated } from '../../domain/table/events/ViewGroupUpdated';
import { ViewLockedUpdated } from '../../domain/table/events/ViewLockedUpdated';
import { ViewOptionsUpdated } from '../../domain/table/events/ViewOptionsUpdated';
import { ViewRenamed } from '../../domain/table/events/ViewRenamed';
import { ViewShareDisabled } from '../../domain/table/events/ViewShareDisabled';
import { ViewShareEnabled } from '../../domain/table/events/ViewShareEnabled';
import { ViewShareIdRefreshed } from '../../domain/table/events/ViewShareIdRefreshed';
import { ViewShareMetaUpdated } from '../../domain/table/events/ViewShareMetaUpdated';
import { ViewSortUpdated } from '../../domain/table/events/ViewSortUpdated';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import { SingleLineTextField } from '../../domain/table/fields/types/SingleLineTextField';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateViewColumnMetaSpec } from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewOptionsSpec } from '../../domain/table/specs/TableUpdateViewOptionsSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import { ViewName } from '../../domain/table/views/ViewName';
import { ViewQueryDefaults } from '../../domain/table/views/ViewQueryDefaults';
import type { IEventBus } from '../../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
  TableUpdatePersistResult,
} from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';

import { TableUpdateFlow } from './TableUpdateFlow';
import {
  resolveLatestTableInTransactionScope,
  scheduleTableUpdateDeferredTask,
} from './TableUpdateTransactionScope';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const buildTable = () => {
  const baseId = BaseId.create(`bse${'z'.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${'y'.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Flow Table')._unsafeUnwrap();

  const builder = Table.builder().withId(tableId).withBaseId(baseId).withName(tableName);
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildTextField = (seed: string, name: string) =>
  SingleLineTextField.create({
    id: FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap(),
    name: FieldName.create(name)._unsafeUnwrap(),
  })._unsafeUnwrap();

class FakeTableRepository implements ITableRepository {
  provisionStateChanges: TableProvisionState[] = [];
  provisionOperations: Array<TableProvisionOperationOptions | undefined> = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return err(domainError.notFound({ message: 'not found' }));
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async updateOne(
    _: IExecutionContext,
    __: Table,
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<TableUpdatePersistResult | void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async setProvisionState(
    _: IExecutionContext,
    __: Table,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    this.provisionStateChanges.push(state);
    this.provisionOperations.push(operation);
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async insert(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async insertMany(
    _: IExecutionContext,
    __: ReadonlyArray<Table>
  ): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async update(
    _: IExecutionContext,
    table: Table,
    __: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    table.requestActionTrigger({
      actionKey: 'setRecord',
      payload: {
        tableId: table.id().toString(),
        fieldIds: [],
      },
    });
    return ok(table);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent): Promise<Result<void, DomainError>> {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(
    _: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.published.push(...events);
    return ok(undefined);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  topLevelMetaStarts = 0;

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const existing = context.transactions?.[scope];
    if (existing) {
      return work({ ...context, transaction: existing });
    }
    if (scope === 'meta') {
      this.topLevelMetaStarts += 1;
    }
    const afterCommitHandlers: Array<() => Promise<void> | void> = [];
    const afterRollbackHandlers: Array<() => Promise<void> | void> = [];
    const transaction: IUnitOfWorkTransaction = {
      kind: 'unitOfWorkTransaction',
      scope,
      afterCommit(handler) {
        afterCommitHandlers.push(handler);
      },
      afterRollback(handler) {
        afterRollbackHandlers.push(handler);
      },
    };
    const result = await work({
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    });
    const handlers = result.isOk() ? afterCommitHandlers : afterRollbackHandlers;
    for (const handler of handlers) {
      await handler();
    }
    return result;
  }
}

describe('TableUpdateFlow', () => {
  it('publishes repository-added post-persist events without returning them', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const nextName = TableName.create('Flow Table Renamed')._unsafeUnwrap();
    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) => mutator.rename(nextName))
    );

    const payload = result._unsafeUnwrap();
    const responseEventNames = payload.events.map((event) => event.name.toString());
    const publishedEventNames = eventBus.published.map((event) => event.name.toString());

    expect(responseEventNames).toContain('TableRenamed');
    expect(responseEventNames).not.toContain('TableActionTriggerRequested');
    expect(publishedEventNames).toContain('TableRenamed');
    expect(publishedEventNames).toContain('TableActionTriggerRequested');
    expect(repository.provisionStateChanges).toEqual(['ready', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      undefined,
    ]);
  });

  it('flushes repository deferred tasks after afterPersist hooks', async () => {
    const table = buildTable();
    const order: string[] = [];
    const flow = new TableUpdateFlow(
      new FakeTableRepository(),
      {
        insert: async () => ok(undefined),
        insertMany: async () => ok(undefined),
        update: async (context, nextTable) => {
          order.push('schema-update');
          scheduleTableUpdateDeferredTask(context, async () => {
            order.push('deferred-task');
            return ok(undefined);
          });
          return ok(nextTable);
        },
        delete: async () => ok(undefined),
      },
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const nextName = TableName.create('Flow Table Deferred')._unsafeUnwrap();
    const result = await flow.execute(
      createContext(),
      { table },
      (tableToUpdate) => tableToUpdate.update((mutator) => mutator.rename(nextName)),
      {
        hooks: {
          afterPersist: async () => {
            order.push('after-persist');
            return ok([]);
          },
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(order).toEqual(['schema-update', 'after-persist', 'deferred-task']);
  });

  it('does not change provision state when prepare validation fails before persistence', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const nextName = TableName.create('Flow Table Invalid')._unsafeUnwrap();
    const result = await flow.execute(
      createContext(),
      { table },
      (tableToUpdate) => tableToUpdate.update((mutator) => mutator.rename(nextName)),
      {
        hooks: {
          prepare: async () => err(domainError.validation({ message: 'invalid update' })),
        },
      }
    );

    expect(result._unsafeUnwrapErr().message).toBe('invalid update');
    expect(repository.provisionStateChanges).toEqual([]);
  });

  it('attaches persisted view versions to view column meta events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: table.views()[0]!.id().toString(),
            oldVersion: 3,
            newVersion: 4,
          },
        ],
      });

    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const view = table.views()[0]!;
    const fieldId = table.primaryFieldId();
    const fieldKey = fieldId.toString();
    const currentMeta = view.columnMeta()._unsafeUnwrap().toDto();
    const nextMeta = ViewColumnMeta.create({
      ...currentMeta,
      [fieldKey]: {
        ...(currentMeta[fieldKey] ?? {}),
        hidden: true,
      },
    })._unsafeUnwrap();

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) =>
        mutator.applySpecs([
          TableUpdateViewColumnMetaSpec.create([
            {
              viewId: view.id(),
              fieldId,
              columnMeta: nextMeta,
            },
          ]),
        ])
      )
    );

    const payload = result._unsafeUnwrap();
    const viewEvent = payload.events.find(
      (event): event is ViewColumnMetaUpdated => event instanceof ViewColumnMetaUpdated
    );

    expect(viewEvent).toBeDefined();
    expect(viewEvent?.oldVersion).toBe(3);
    expect(viewEvent?.newVersion).toBe(4);
    expect(eventBus.published.some((event) => event instanceof ViewColumnMetaUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewRenamed events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 7,
            newVersion: 8,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate
        .renameView(view.id(), ViewName.create('Renamed')._unsafeUnwrap())
        .map(({ updateResult }) => updateResult)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewRenamed => event instanceof ViewRenamed);
    expect(viewEvent).toMatchObject({
      oldVersion: 7,
      newVersion: 8,
      previousName: view.name(),
      nextName: ViewName.create('Renamed')._unsafeUnwrap(),
    });
    expect(eventBus.published.some((event) => event instanceof ViewRenamed)).toBe(true);
  });

  it('attaches persisted view versions to ViewDescriptionUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 8,
            newVersion: 9,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate
        .updateViewDescription(view.id(), 'Updated')
        .map(({ updateResult }) => updateResult)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find(
        (event): event is ViewDescriptionUpdated => event instanceof ViewDescriptionUpdated
      );
    expect(viewEvent).toMatchObject({
      oldVersion: 8,
      newVersion: 9,
      previousDescription: undefined,
      nextDescription: 'Updated',
    });
    expect(eventBus.published.some((event) => event instanceof ViewDescriptionUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewLockedUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 9,
            newVersion: 10,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.updateViewLocked(view.id(), true).map(({ updateResult }) => updateResult)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewLockedUpdated => event instanceof ViewLockedUpdated);
    expect(viewEvent).toMatchObject({
      oldVersion: 9,
      newVersion: 10,
      previousIsLocked: undefined,
      nextIsLocked: true,
    });
    expect(eventBus.published.some((event) => event instanceof ViewLockedUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewSortUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 10,
            newVersion: 11,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );
    const sort = {
      sortObjs: [{ fieldId: table.primaryFieldId().toString(), order: 'desc' as const }],
      manualSort: false,
    };

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.updateViewSort(view.id(), sort).map(({ updateResult }) => updateResult!)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewSortUpdated => event instanceof ViewSortUpdated);
    expect(viewEvent).toMatchObject({
      oldVersion: 10,
      newVersion: 11,
      previousSort: null,
      nextSort: sort,
    });
    expect(eventBus.published.some((event) => event instanceof ViewSortUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewGroupUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 11,
            newVersion: 12,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );
    const group = [{ fieldId: table.primaryFieldId().toString(), order: 'asc' as const }];

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.updateViewGroup(view.id(), group).map(({ updateResult }) => updateResult!)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewGroupUpdated => event instanceof ViewGroupUpdated);
    expect(viewEvent).toMatchObject({
      oldVersion: 11,
      newVersion: 12,
      previousGroup: null,
      nextGroup: group,
    });
    expect(eventBus.published.some((event) => event instanceof ViewGroupUpdated)).toBe(true);
  });

  it('shares one persisted version across compound View query-default events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    const fieldId = table.primaryFieldId().toString();
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 12,
            newVersion: 13,
          },
          {
            viewId: view.id().toString(),
            oldVersion: 13,
            newVersion: 14,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );
    const previousQueryDefaults = view.queryDefaults()._unsafeUnwrap();
    const sourceFilter = {
      conjunction: 'and',
      filterSet: [{ fieldId, operator: 'is', value: 'ready' }],
    };
    const nextQueryDefaults = ViewQueryDefaults.create(
      {
        filter: { fieldId, operator: 'is', value: 'ready' },
        sort: [{ fieldId, order: 'desc' }],
        group: [{ fieldId, order: 'asc' }],
      },
      { sourceFilter }
    )._unsafeUnwrap();

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) =>
        mutator.applySpecs([
          TableUpdateViewQueryDefaultsSpec.create([
            {
              viewId: view.id(),
              previousQueryDefaults,
              queryDefaults: nextQueryDefaults,
            },
          ]),
          TableUpdateViewOptionsSpec.create({
            viewId: view.id(),
            previousOptions: undefined,
            nextOptions: { rowHeight: 'short' },
          }),
        ])
      )
    );

    const queryEvents = result
      ._unsafeUnwrap()
      .events.filter(
        (event) =>
          event instanceof ViewFilterUpdated ||
          event instanceof ViewGroupUpdated ||
          event instanceof ViewSortUpdated
      );
    expect(queryEvents).toHaveLength(3);
    expect(queryEvents).toEqual([
      expect.objectContaining({ oldVersion: 12, newVersion: 13 }),
      expect.objectContaining({ oldVersion: 12, newVersion: 13 }),
      expect.objectContaining({ oldVersion: 12, newVersion: 13 }),
    ]);
    const optionsEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewOptionsUpdated => event instanceof ViewOptionsUpdated);
    expect(optionsEvent).toMatchObject({ oldVersion: 13, newVersion: 14 });
  });

  it('attaches persisted view versions to ViewOptionsUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 12,
            newVersion: 13,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );
    const options = { rowHeight: 'tall' };

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.updateViewOptions(view.id(), options).map(({ updateResult }) => updateResult!)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewOptionsUpdated => event instanceof ViewOptionsUpdated);
    expect(viewEvent).toMatchObject({
      oldVersion: 12,
      newVersion: 13,
      previousOptions: undefined,
      nextOptions: options,
    });
    expect(eventBus.published.some((event) => event instanceof ViewOptionsUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewShareMetaUpdated events', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    const view = table.views()[0]!;
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 13,
            newVersion: 14,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );
    const shareMeta = { allowCopy: true };

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate
        .updateViewShareMeta(view.id(), shareMeta)
        .map(({ updateResult }) => updateResult!)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewShareMetaUpdated => event instanceof ViewShareMetaUpdated);
    expect(viewEvent).toMatchObject({
      oldVersion: 13,
      newVersion: 14,
      previousShareMeta: undefined,
      nextShareMeta: shareMeta,
    });
    expect(eventBus.published.some((event) => event instanceof ViewShareMetaUpdated)).toBe(true);
  });

  it('attaches persisted view versions to ViewShareIdRefreshed events', async () => {
    const source = buildTable();
    const created = source
      .createView({
        type: 'grid',
        name: 'Public View',
        enableShare: true,
        shareId: `shr${'a'.repeat(16)}`,
      })
      ._unsafeUnwrap();
    const table = created.updateResult.table;
    table.pullDomainEvents();
    const view = created.view;
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 14,
            newVersion: 15,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.refreshViewShareId(view.id()).map(({ updateResult }) => updateResult)
    );

    const viewEvent = result
      ._unsafeUnwrap()
      .events.find((event): event is ViewShareIdRefreshed => event instanceof ViewShareIdRefreshed);
    expect(viewEvent).toMatchObject({
      oldVersion: 14,
      newVersion: 15,
      previousShareId: `shr${'a'.repeat(16)}`,
      nextShareId: expect.stringMatching(/^shr[0-9a-zA-Z]{16}$/),
    });
    expect(eventBus.published.some((event) => event instanceof ViewShareIdRefreshed)).toBe(true);
  });

  it('attaches persisted view versions to View share lifecycle events', async () => {
    const table = buildTable();
    const view = table.views()[0]!;
    const eventBus = new FakeEventBus();
    const repository = new FakeTableRepository();
    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 20,
            newVersion: 21,
          },
        ],
      });
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      eventBus,
      new FakeUnitOfWork()
    );

    const enabledResult = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.enableViewShare(view.id()).map(({ updateResult }) => updateResult)
    );
    const enabledTable = enabledResult._unsafeUnwrap().table;
    const enabledEvent = enabledResult
      ._unsafeUnwrap()
      .events.find((event): event is ViewShareEnabled => event instanceof ViewShareEnabled);
    expect(enabledEvent).toMatchObject({ oldVersion: 20, newVersion: 21 });

    repository.updateOne = async () =>
      ok({
        viewVersionChanges: [
          {
            viewId: view.id().toString(),
            oldVersion: 21,
            newVersion: 22,
          },
        ],
      });
    const disabledResult = await flow.execute(createContext(), { table: enabledTable }, (next) =>
      next.disableViewShare(view.id()).map(({ updateResult }) => updateResult)
    );
    const disabledEvent = disabledResult
      ._unsafeUnwrap()
      .events.find((event): event is ViewShareDisabled => event instanceof ViewShareDisabled);
    expect(disabledEvent).toMatchObject({ oldVersion: 21, newVersion: 22 });
    expect(eventBus.published.some((event) => event instanceof ViewShareEnabled)).toBe(true);
    expect(eventBus.published.some((event) => event instanceof ViewShareDisabled)).toBe(true);
  });

  it('lets deferred tasks observe the latest table state in the transaction scope', async () => {
    const table = buildTable();
    const observedNames: string[] = [];
    const flow = new TableUpdateFlow(
      new FakeTableRepository(),
      {
        insert: async () => ok(undefined),
        insertMany: async () => ok(undefined),
        update: async (context, nextTable) => {
          scheduleTableUpdateDeferredTask(context, async () => {
            const latestTable = resolveLatestTableInTransactionScope(
              context,
              nextTable.id(),
              nextTable
            );
            observedNames.push(latestTable.name().toString());
            return ok(undefined);
          });
          return ok(nextTable);
        },
        delete: async () => ok(undefined),
      },
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const initialName = TableName.create('Flow Table Initial')._unsafeUnwrap();
    const finalName = TableName.create('Flow Table Final')._unsafeUnwrap();
    const result = await flow.execute(
      createContext(),
      { table },
      (tableToUpdate) => tableToUpdate.update((mutator) => mutator.rename(initialName)),
      {
        hooks: {
          afterPersist: async (_context, updatedTable) =>
            updatedTable
              .update((mutator) => mutator.rename(finalName))
              .map((next) => ({ events: [], table: next.table })),
        },
      }
    );

    expect(result.isOk()).toBe(true);
    expect(observedNames).toEqual(['Flow Table Final']);
  });

  it('marks physical schema updates pending before applying data schema changes', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const order: string[] = [];
    const flow = new TableUpdateFlow(
      repository,
      {
        insert: async () => ok(undefined),
        insertMany: async () => ok(undefined),
        update: async (_context, nextTable) => {
          order.push(`schema-update-after-${repository.provisionStateChanges.join(',')}`);
          return ok(nextTable);
        },
        delete: async () => ok(undefined),
      },
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const addedField = buildTextField('c', 'Added Field');
    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) => mutator.addField(addedField))
    );

    expect(result.isOk()).toBe(true);
    expect(order).toEqual(['schema-update-after-pending']);
    expect(repository.provisionStateChanges).toEqual(['pending', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      undefined,
    ]);
  });

  it('does not commit physical-repair pending before the meta transaction (T7114)', async () => {
    const table = buildTable();
    const unitOfWork = new FakeUnitOfWork();
    let metaStartsAtSchemaUpdate = 0;
    const flow = new TableUpdateFlow(
      new FakeTableRepository(),
      {
        insert: async () => ok(undefined),
        insertMany: async () => ok(undefined),
        update: async (_context, nextTable) => {
          metaStartsAtSchemaUpdate = unitOfWork.topLevelMetaStarts;
          return ok(nextTable);
        },
        delete: async () => ok(undefined),
      },
      new FakeEventBus(),
      unitOfWork
    );

    const addedField = buildTextField('c', 'Added Field');
    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) => mutator.addField(addedField))
    );

    expect(result.isOk()).toBe(true);
    expect(metaStartsAtSchemaUpdate).toBe(1);
  });

  it('does not mark pending when physical schema prepare validation fails', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const addedField = buildTextField('d', 'Prepare Failed Field');
    const result = await flow.execute(
      createContext(),
      { table },
      (tableToUpdate) => tableToUpdate.update((mutator) => mutator.addField(addedField)),
      {
        hooks: {
          prepare: async () => err(domainError.validation({ message: 'prepare failed' })),
        },
      }
    );

    expect(result._unsafeUnwrapErr().message).toBe('prepare failed');
    expect(repository.provisionStateChanges).toEqual([]);
  });

  it('keeps tables available when an outer transaction rolls back after deferring ready', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const unitOfWork = new FakeUnitOfWork();
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      unitOfWork
    );

    const nestedName = TableName.create('Flow Table Nested Rollback')._unsafeUnwrap();
    const outerResult = await unitOfWork.withTransaction(
      createContext(),
      async (outerContext) => {
        const innerResult = await flow.execute(outerContext, { table }, (tableToUpdate) =>
          tableToUpdate.update((mutator) => mutator.rename(nestedName))
        );
        expect(innerResult.isOk()).toBe(true);
        return err(domainError.unexpected({ message: 'outer rollback' }));
      },
      { scope: 'data' }
    );

    expect(outerResult._unsafeUnwrapErr().message).toBe('outer rollback');
    expect(repository.provisionStateChanges).toEqual(['ready', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      undefined,
    ]);
    expect(repository.provisionOperations.at(-1)?.result).toEqual({
      nonRepairableFailure: 'Parent transaction rolled back',
    });
  });

  it('does not mark repairable error when metadata did not persist for a physical schema update', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    repository.updateOne = async () => err(domainError.infrastructure({ message: 'meta failed' }));
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const addedField = buildTextField('b', 'Metadata Failed Field');
    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) => mutator.addField(addedField))
    );

    expect(result._unsafeUnwrapErr().message).toBe('meta failed');
    expect(repository.provisionStateChanges).toEqual(['pending', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      undefined,
    ]);
    expect(repository.provisionOperations.at(-1)?.result).toEqual({
      nonRepairableFailure: 'meta failed',
    });
  });

  it('records schema failures when metadata persists but the data phase fails', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const flow = new TableUpdateFlow(
      repository,
      {
        insert: async () => ok(undefined),
        insertMany: async () => ok(undefined),
        update: async () => err(domainError.infrastructure({ message: 'data failed' })),
        delete: async () => ok(undefined),
      },
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const nextName = TableName.create('Flow Table Data Failed')._unsafeUnwrap();
    const result = await flow.execute(createContext(), { table }, (tableToUpdate) =>
      tableToUpdate.update((mutator) => mutator.rename(nextName))
    );

    expect(result._unsafeUnwrapErr().message).toBe('data failed');
    expect(repository.provisionStateChanges).toEqual(['ready', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      'error',
    ]);
  });

  it('records repairable schema failures when an outer rollback can leave physical schema missing', async () => {
    const table = buildTable();
    const repository = new FakeTableRepository();
    const unitOfWork = new FakeUnitOfWork();
    const flow = new TableUpdateFlow(
      repository,
      new FakeTableSchemaRepository(),
      new FakeEventBus(),
      unitOfWork
    );

    const addedField = buildTextField('a', 'Added Field');
    const outerResult = await unitOfWork.withTransaction(
      createContext(),
      async (outerContext) => {
        const innerResult = await flow.execute(outerContext, { table }, (tableToUpdate) =>
          tableToUpdate.update((mutator) => mutator.addField(addedField))
        );
        expect(innerResult.isOk()).toBe(true);
        return err(domainError.unexpected({ message: 'outer rollback' }));
      },
      { scope: 'data' }
    );

    expect(outerResult._unsafeUnwrapErr().message).toBe('outer rollback');
    expect(repository.provisionStateChanges).toEqual(['pending', 'ready']);
    expect(repository.provisionOperations.map((operation) => operation?.status)).toEqual([
      'pending',
      'error',
    ]);
  });
});
