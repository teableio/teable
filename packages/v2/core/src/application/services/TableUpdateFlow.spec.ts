import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { ViewColumnMetaUpdated } from '../../domain/table/events/ViewColumnMetaUpdated';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { TableUpdateViewColumnMetaSpec } from '../../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { TableSortKey } from '../../domain/table/TableSortKey';
import { ViewColumnMeta } from '../../domain/table/views/ViewColumnMeta';
import type { IEventBus } from '../../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../../ports/ExecutionContext';
import type { IFindOptions } from '../../ports/RepositoryQuery';
import type { ITableRepository, TableUpdatePersistResult } from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, UnitOfWorkOperation } from '../../ports/UnitOfWork';

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

class FakeTableRepository implements ITableRepository {
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

  async restore(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  async delete(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
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
  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>
  ): Promise<Result<T, DomainError>> {
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction' };
    return work({ ...context, transaction });
  }
}

describe('TableUpdateFlow', () => {
  it('publishes repository-added post-persist events without returning them', async () => {
    const table = buildTable();
    const eventBus = new FakeEventBus();
    const flow = new TableUpdateFlow(
      new FakeTableRepository(),
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
});
