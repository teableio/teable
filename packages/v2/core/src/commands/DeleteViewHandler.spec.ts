import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import type { TableUpdateFlow } from '../application/services/TableUpdateFlow';
import type { ViewUndoRedoService } from '../application/services/ViewUndoRedoService';
import { BaseId } from '../domain/base/BaseId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import { FieldUpdated } from '../domain/table/events/FieldUpdated';
import { ViewDeleted } from '../domain/table/events/ViewDeleted';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import type { TableUpdateResult } from '../domain/table/TableMutator';
import { TableName } from '../domain/table/TableName';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext } from '../ports/ExecutionContext';
import type { ITableRepository, TableFindOneOptions } from '../ports/TableRepository';
import type { IUnitOfWork } from '../ports/UnitOfWork';
import { DeleteViewCommand } from './DeleteViewCommand';
import { DeleteViewHandler } from './DeleteViewHandler';

const baseId = BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const buildPlainTable = (seed: string): Table => {
  const builder = TableAggregate.builder()
    .withId(tableId(seed))
    .withBaseId(baseId)
    .withName(TableName.create(`Table ${seed}`)._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId(seed))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildLinkedTables = () => {
  const sourceTableId = tableId('b');
  const foreignTableId = tableId('c');
  const sourceLinkFieldId = fieldId('d');
  const foreignLinkFieldId = fieldId('e');

  const sourceBuilder = TableAggregate.builder()
    .withId(sourceTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Source')._unsafeUnwrap());
  sourceBuilder
    .field()
    .singleLineText()
    .withId(fieldId('b'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  sourceBuilder
    .field()
    .link()
    .withId(sourceLinkFieldId)
    .withName(FieldName.create('Foreign')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: fieldId('c').toString(),
        symmetricFieldId: foreignLinkFieldId.toString(),
        isOneWay: false,
      })._unsafeUnwrap()
    )
    .done();
  sourceBuilder.view().defaultGrid().done();
  const originalSource = sourceBuilder.build()._unsafeUnwrap();
  const createdView = originalSource
    .createView({ type: 'grid', name: 'Temporary' })
    ._unsafeUnwrap();
  const source = createdView.updateResult.table;
  source.pullDomainEvents();

  const foreignBuilder = TableAggregate.builder()
    .withId(foreignTableId)
    .withBaseId(baseId)
    .withName(TableName.create('Foreign')._unsafeUnwrap());
  foreignBuilder
    .field()
    .singleLineText()
    .withId(fieldId('c'))
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  foreignBuilder
    .field()
    .link()
    .withId(foreignLinkFieldId)
    .withName(FieldName.create('Source')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyMany',
        foreignTableId: sourceTableId.toString(),
        lookupFieldId: fieldId('b').toString(),
        symmetricFieldId: sourceLinkFieldId.toString(),
        filterByViewId: createdView.view.id().toString(),
        isOneWay: false,
      })._unsafeUnwrap()
    )
    .done();
  foreignBuilder.view().defaultGrid().done();

  return {
    source,
    foreign: foreignBuilder.build()._unsafeUnwrap(),
    targetViewId: createdView.view.id(),
  };
};

class FakeTableRepository {
  readonly findOneOptions: Array<TableFindOneOptions | undefined> = [];

  constructor(private readonly responses: Array<Result<Table, DomainError>>) {}

  async findOne(
    _context: IExecutionContext,
    _spec: { accept(visitor: ITableSpecVisitor): Result<unknown, DomainError> },
    options?: TableFindOneOptions
  ): Promise<Result<Table, DomainError>> {
    this.findOneOptions.push(options);
    return (
      this.responses.shift() ??
      err(domainError.unexpected({ message: 'Missing fake Table response' }))
    );
  }
}

type FlowHookResult =
  | ReadonlyArray<IDomainEvent>
  | { readonly table?: Table; readonly events: ReadonlyArray<IDomainEvent> };

class FakeTableUpdateFlow {
  readonly updatedTables: Table[] = [];

  async execute(
    context: IExecutionContext,
    target: { table: Table },
    mutate: (table: Table) => Result<TableUpdateResult, DomainError>,
    options?: {
      hooks?: {
        afterPersist?: (
          context: IExecutionContext,
          table: Table,
          spec: TableUpdateResult['mutateSpec']
        ) => Promise<Result<FlowHookResult, DomainError>>;
      };
    }
  ) {
    const mutationResult = mutate(target.table);
    if (mutationResult.isErr()) return err(mutationResult.error);
    let table = mutationResult.value.table;
    const events = [...table.pullDomainEvents()];
    this.updatedTables.push(table);

    const hook = options?.hooks?.afterPersist;
    if (hook) {
      const hookResult = await hook(context, table, mutationResult.value.mutateSpec);
      if (hookResult.isErr()) return err(hookResult.error);
      const normalized = Array.isArray(hookResult.value)
        ? { events: hookResult.value }
        : hookResult.value;
      events.push(...normalized.events);
      table = normalized.table ?? table;
    }

    return ok({ table, events, postPersistEvents: [] });
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  calls = 0;

  async withTransaction<T>(
    context: IExecutionContext,
    work: (context: IExecutionContext) => Promise<Result<T, DomainError>>
  ): Promise<Result<T, DomainError>> {
    this.calls += 1;
    return work(context);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    return ok(undefined);
  }
}

const createContext = (): IExecutionContext =>
  ({
    actorId: { toString: () => 'system' },
  }) as IExecutionContext;

const createHandler = (repository: FakeTableRepository) => {
  const flow = new FakeTableUpdateFlow();
  const unitOfWork = new FakeUnitOfWork();
  const eventBus = new FakeEventBus();
  const undoRedo = {
    capture: vi.fn((_table: Table, viewId: string) => ok({ id: viewId } as never)),
    appendDelete: vi.fn(async () => ok(undefined)),
  } as unknown as ViewUndoRedoService;
  const handler = new DeleteViewHandler(
    repository as unknown as ITableRepository,
    flow as unknown as TableUpdateFlow,
    unitOfWork,
    eventBus,
    undoRedo
  );
  return { handler, flow, unitOfWork, eventBus };
};

describe('DeleteViewCommand', () => {
  it('validates nominal Table and View identifiers', () => {
    expect(DeleteViewCommand.create({ tableId: 'bad', viewId: 'bad' }).isErr()).toBe(true);
  });
});

describe('DeleteViewHandler', () => {
  it('locks Table aggregate roots, clears foreign Link dependencies, and publishes events', async () => {
    const setup = buildLinkedTables();
    const repository = new FakeTableRepository([ok(setup.source), ok(setup.foreign)]);
    const { handler, flow, unitOfWork, eventBus } = createHandler(repository);
    const command = DeleteViewCommand.create({
      tableId: setup.source.id().toString(),
      viewId: setup.targetViewId.toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().table.views()).toHaveLength(1);
    expect(unitOfWork.calls).toBe(1);
    expect(repository.findOneOptions).toEqual([{ lock: 'forUpdate' }, { lock: 'forUpdate' }]);
    expect(flow.updatedTables).toHaveLength(2);
    expect(eventBus.published.some((event) => event instanceof ViewDeleted)).toBe(true);
    expect(eventBus.published.some((event) => event instanceof FieldUpdated)).toBe(true);
  });

  it('keeps deletion valid when an orphan foreign Table is missing', async () => {
    const setup = buildLinkedTables();
    const repository = new FakeTableRepository([
      ok(setup.source),
      err(domainError.notFound({ message: 'Foreign Table missing' })),
    ]);
    const { handler, flow, eventBus } = createHandler(repository);
    const command = DeleteViewCommand.create({
      tableId: setup.source.id().toString(),
      viewId: setup.targetViewId.toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result.isOk()).toBe(true);
    expect(flow.updatedTables).toHaveLength(1);
    expect(eventBus.published).toHaveLength(1);
    expect(eventBus.published[0]).toBeInstanceOf(ViewDeleted);
  });

  it('rejects deletion of the last View before persistence or event publication', async () => {
    const table = buildPlainTable('f');
    const repository = new FakeTableRepository([ok(table)]);
    const { handler, flow, eventBus } = createHandler(repository);
    const command = DeleteViewCommand.create({
      tableId: table.id().toString(),
      viewId: table.views()[0]!.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('view.cannot_delete_last');
    expect(flow.updatedTables).toHaveLength(0);
    expect(eventBus.published).toHaveLength(0);
  });

  it('maps a missing source aggregate to table.not_found', async () => {
    const repository = new FakeTableRepository([err(domainError.notFound({ message: 'Missing' }))]);
    const { handler } = createHandler(repository);
    const command = DeleteViewCommand.create({
      tableId: tableId('g').toString(),
      viewId: `viw${'g'.repeat(16)}`,
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('table.not_found');
  });
});
