import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import {
  TableDeletionPreparationService,
  type ITableDeletionPreparationService,
} from '../application/services/TableDeletionPreparationService';
import type {
  TableDeletionSideEffectPreparation,
  TableDeletionSideEffectServiceResult,
} from '../application/services/TableDeletionSideEffectService';
import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError, type DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { ISpecification } from '../domain/shared/specification/ISpecification';
import { FieldUpdated } from '../domain/table/events/FieldUpdated';
import { TableActionTriggerRequested } from '../domain/table/events/TableActionTriggerRequested';
import { TableDeleted } from '../domain/table/events/TableDeleted';
import { TableTrashed } from '../domain/table/events/TableTrashed';
import { FieldName } from '../domain/table/fields/FieldName';
import { AttachmentField } from '../domain/table/fields/types/AttachmentField';
import { AttachmentPublicAccess } from '../domain/table/fields/types/AttachmentPublicAccess';
import type { ITableSpecVisitor } from '../domain/table/specs/ITableSpecVisitor';
import type { Table } from '../domain/table/Table';
import { Table as TableAggregate } from '../domain/table/Table';
import { TableName } from '../domain/table/TableName';
import type { TableSortKey } from '../domain/table/TableSortKey';
import type { IEventBus } from '../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  UnitOfWorkScope,
} from '../ports/ExecutionContext';
import type { ILogger, LogContext } from '../ports/Logger';
import type { IFindOptions } from '../ports/RepositoryQuery';
import type {
  ITableRepository,
  TableDeleteOptions,
  TableFindOptions,
  TableProvisionState,
} from '../ports/TableRepository';
import {
  createTableSchemaCoordinationLease,
  type ITableSchemaCoordination,
  type ITableSchemaCoordinationLease,
  type TableSchemaCoordinationMode,
} from '../ports/TableSchemaCoordination';
import type { ITableSchemaRepository } from '../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { DeleteTableCommand } from './DeleteTableCommand';
import { DeleteTableHandler } from './DeleteTableHandler';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const buildTable = (baseIdSeed: string): Table => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const tableName = TableName.create('Delete Me')._unsafeUnwrap();
  const fieldName = FieldName.create('Title')._unsafeUnwrap();

  const builder = TableAggregate.builder().withBaseId(baseId).withName(tableName);
  builder.field().singleLineText().withName(fieldName).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

/** A table with two public attachment fields and a private one. */
const buildPublicFileTable = (baseIdSeed: string): Table => {
  const baseId = BaseId.create(`bse${baseIdSeed.repeat(16)}`)._unsafeUnwrap();
  const builder = TableAggregate.builder()
    .withBaseId(baseId)
    .withName(TableName.create('Files')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  for (const [name, publicAccess] of [
    ['Cover', AttachmentPublicAccess.enabled()],
    ['Photos', AttachmentPublicAccess.enabled()],
    ['Contracts', AttachmentPublicAccess.disabled()],
  ] as const) {
    builder
      .field()
      .attachment()
      .withName(FieldName.create(name)._unsafeUnwrap())
      .withPublicAccess(publicAccess)
      .done();
  }
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const publicFieldNames = (table: Table) =>
  table
    .getFields()
    .filter((field) => field instanceof AttachmentField && field.publicAccess().toBoolean())
    .map((field) => field.name().toString());

class TestTableSchemaCoordination implements ITableSchemaCoordination {
  readonly requests: Array<{ tableIds: ReadonlyArray<string>; mode: TableSchemaCoordinationMode }> =
    [];
  private readonly leases = new Set<ITableSchemaCoordinationLease>();
  private readonly waiters = new Set<() => void>();

  async acquire(
    _context: IExecutionContext,
    tableIds: ReadonlyArray<string>,
    mode: TableSchemaCoordinationMode,
    signal?: AbortSignal
  ): Promise<Result<ITableSchemaCoordinationLease, DomainError>> {
    this.requests.push({ tableIds: [...tableIds], mode });
    while (
      [...this.leases].some(
        (lease) =>
          (mode === 'exclusive' || lease.mode === 'exclusive') &&
          tableIds.some((tableId) => lease.tableIds.includes(tableId))
      )
    ) {
      if (signal?.aborted) {
        return err(
          domainError.infrastructure({
            code: 'schema_coordination.cancelled',
            message: 'Table schema coordination acquisition cancelled',
          })
        );
      }
      const { promise, resolve } = Promise.withResolvers<void>();
      const onAbort = () => resolve();
      this.waiters.add(resolve);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        await promise;
      } finally {
        this.waiters.delete(resolve);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    const lease = createTableSchemaCoordinationLease(mode, tableIds, async () => {
      this.leases.delete(lease);
      const waiters = [...this.waiters];
      this.waiters.clear();
      for (const resolve of waiters) resolve();
    });
    this.leases.add(lease);
    return ok(lease);
  }
}

class FakeTableRepository implements ITableRepository {
  tables: Table[] = [];
  deleted: Table[] = [];
  deleteModes: Array<'soft' | 'permanent'> = [];
  deletedTableIds = new Set<string>();
  provisionStateChanges: Array<{ tableId: string; state: TableProvisionState }> = [];
  findStates: Array<TableFindOptions['state'] | undefined> = [];
  failDelete: DomainError | undefined;
  failUpdate: DomainError | undefined;
  updates: Array<{ context: IExecutionContext; table: Table }> = [];
  /** The writes in the order they were made. */
  writes: Array<'update' | 'delete'> = [];

  async insert(_: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: Pick<TableFindOptions, 'state'>
  ): Promise<Result<Table, DomainError>> {
    this.findStates.push(options?.state);
    const state = options?.state ?? 'active';
    const found = this.tables.find((table) => {
      const isDeleted = this.deletedTableIds.has(table.id().toString());
      if (state === 'active' && isDeleted) return false;
      if (state === 'deleted' && !isDeleted) return false;
      return spec.isSatisfiedBy(table);
    });
    if (!found) return err(domainError.notFound({ message: 'Not found' }));
    return ok(found);
  }

  async find(
    _: IExecutionContext,
    __: ISpecification<Table, ITableSpecVisitor>,
    ___?: IFindOptions<TableSortKey>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok([]);
  }

  async updateOne(
    context: IExecutionContext,
    table: Table,
    _: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    if (this.failUpdate) return err(this.failUpdate);
    this.updates.push({ context, table });
    this.writes.push('update');
    return ok(undefined);
  }

  async delete(
    _: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.writes.push('delete');
    this.deleted.push(table);
    this.deleteModes.push(options?.mode ?? 'soft');
    this.deletedTableIds.add(table.id().toString());
    return ok(undefined);
  }

  async restore(_: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.deletedTableIds.delete(table.id().toString());
    return ok(undefined);
  }

  async setProvisionState(
    _: IExecutionContext,
    table: Table,
    state: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    this.provisionStateChanges.push({ tableId: table.id().toString(), state });
    return ok(undefined);
  }

  async setProvisionStateMany(
    _: IExecutionContext,
    tables: ReadonlyArray<Table>,
    state: TableProvisionState
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      this.provisionStateChanges.push({ tableId: table.id().toString(), state });
    }
    return ok(undefined);
  }
}

class FakeTableSchemaRepository implements ITableSchemaRepository {
  async ensureActorColumns(_: IExecutionContext, __: Table): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }

  deleted: Table[] = [];
  deleteModes: Array<'soft' | 'permanent'> = [];
  failDelete: DomainError | undefined;

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
    ___: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<Table, DomainError>> {
    return ok(table);
  }

  async delete(
    _: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    if (this.failDelete) return err(this.failDelete);
    this.deleteModes.push(options?.mode ?? 'soft');
    if ((options?.mode ?? 'soft') === 'permanent') {
      this.deleted.push(table);
    }
    return ok(undefined);
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  failPublish: DomainError | undefined;

  async publish(_context: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }

  async publishMany(_context: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
    this.published.push(...events);
    if (this.failPublish) return err(this.failPublish);
    return ok(undefined);
  }
}

class FakeTableDeletionSideEffectService {
  events: IDomainEvent[] = [];
  postPersistEvents: IDomainEvent[] = [];
  calls = 0;
  contexts: IExecutionContext[] = [];
  failExecute: DomainError | undefined;
  candidateTables: Table[] = [];
  preparations: TableDeletionSideEffectPreparation[] = [];

  async prepare(
    _: IExecutionContext,
    input: { table: Table }
  ): Promise<Result<TableDeletionSideEffectPreparation, DomainError>> {
    return ok({
      deletedTable: input.table,
      candidateEvidence: 'unknown',
      candidateTableCount: 0,
      downstreamCascadeEvidence: 'not-applicable',
      reactionEffects: [],
      candidatePlans: this.candidateTables.map((sourceTable) => ({
        sourceTable,
        isolatedReactions: [],
      })),
    });
  }

  async executePrepared(
    context: IExecutionContext,
    preparation: TableDeletionSideEffectPreparation
  ): Promise<Result<TableDeletionSideEffectServiceResult, DomainError>> {
    this.calls += 1;
    this.contexts.push(context);
    this.preparations.push(preparation);
    if (this.failExecute) return err(this.failExecute);
    return ok({
      events: [...this.events],
      postPersistEvents: [...this.postPersistEvents],
      updatedTables: [],
    });
  }
}

class FakeLogger implements ILogger {
  readonly messages: string[] = [];

  child(_: LogContext): ILogger {
    return this;
  }

  scope(_: string, __?: LogContext): ILogger {
    return this;
  }

  debug(message: string): void {
    this.messages.push(message);
  }

  info(message: string): void {
    this.messages.push(message);
  }

  warn(message: string): void {
    this.messages.push(message);
  }

  error(message: string): void {
    this.messages.push(message);
  }
}

class FakeUnitOfWork implements IUnitOfWork {
  transactions: IExecutionContext[] = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const transaction: IUnitOfWorkTransaction = { kind: 'unitOfWorkTransaction', scope };
    const transactionContext = {
      ...context,
      transaction,
      transactions: {
        ...(context.transactions ?? {}),
        [scope]: transaction,
      },
    };
    this.transactions.push(transactionContext);
    return work(transactionContext);
  }
}

const createHandler = (
  repository: FakeTableRepository,
  schemaRepository: FakeTableSchemaRepository,
  sideEffects: FakeTableDeletionSideEffectService,
  eventBus: FakeEventBus,
  logger: FakeLogger,
  unitOfWork: FakeUnitOfWork,
  preparationService: ITableDeletionPreparationService = new TableDeletionPreparationService(
    repository,
    sideEffects as never
  ),
  coordination?: ITableSchemaCoordination
) =>
  new DeleteTableHandler(
    repository,
    schemaRepository,
    sideEffects as never,
    preparationService,
    eventBus,
    logger,
    unitOfWork,
    coordination
  );

const createCoordinatedDeletion = () => {
  const table = buildTable('l');
  const context = createContext();
  const repository = new FakeTableRepository();
  repository.tables.push(table);
  const schemaRepository = new FakeTableSchemaRepository();
  const sideEffects = new FakeTableDeletionSideEffectService();
  const eventBus = new FakeEventBus();
  const unitOfWork = new FakeUnitOfWork();
  const coordination = new TestTableSchemaCoordination();
  const preparationService = new TableDeletionPreparationService(repository, sideEffects as never);
  const handler = createHandler(
    repository,
    schemaRepository,
    sideEffects,
    eventBus,
    new FakeLogger(),
    unitOfWork,
    preparationService,
    coordination
  );
  const command = DeleteTableCommand.create({
    baseId: table.baseId().toString(),
    tableId: table.id().toString(),
    mode: 'permanent',
  })._unsafeUnwrap();
  return {
    table,
    context,
    repository,
    schemaRepository,
    sideEffects,
    eventBus,
    unitOfWork,
    coordination,
    preparationService,
    handler,
    command,
  };
};

describe('DeleteTableHandler', () => {
  it('retains all table leases through event publication', async () => {
    const fixture = createCoordinatedDeletion();
    const source = buildTable('s');
    fixture.sideEffects.candidateTables = [source];
    const publishing = Promise.withResolvers<void>();
    const completePublication = Promise.withResolvers<void>();
    const publish = fixture.eventBus.publishMany.bind(fixture.eventBus);
    vi.spyOn(fixture.eventBus, 'publishMany').mockImplementation(async (context, events) => {
      publishing.resolve();
      await completePublication.promise;
      return publish(context, events);
    });

    const deletion = fixture.handler.handle(fixture.context, fixture.command);
    await publishing.promise;
    const readersEntered: string[] = [];
    const readers = [fixture.table, source].map(async (table) => {
      const lease = (
        await fixture.coordination.acquire(fixture.context, [table.id().toString()], 'shared')
      )._unsafeUnwrap();
      readersEntered.push(table.id().toString());
      return lease;
    });
    await Promise.resolve();
    expect(readersEntered).toEqual([]);

    completePublication.resolve();
    (await deletion)._unsafeUnwrap();
    for (const reader of await Promise.all(readers)) await reader.release();
    expect(readersEntered).toHaveLength(2);
  });

  it.each([
    'preparation',
    'blocker',
    'begin lifecycle',
    'side effects',
    'schema delete',
    'metadata delete',
    'complete lifecycle',
    'event publication',
  ])('releases its lease when %s returns an error', async (phase) => {
    const fixture = createCoordinatedDeletion();
    const source = buildTable('r');
    fixture.sideEffects.candidateTables = [source];
    const failure = domainError.unexpected({ message: `${phase} failed` });
    switch (phase) {
      case 'preparation':
        vi.spyOn(fixture.preparationService, 'prepare').mockResolvedValue(err(failure));
        break;
      case 'blocker': {
        const preparation = (
          await fixture.preparationService.prepare(fixture.context, fixture.command)
        )._unsafeUnwrap();
        vi.spyOn(fixture.preparationService, 'prepare').mockResolvedValue(
          ok({
            ...preparation,
            blockers: [{ code: 'table.delete.blocked', message: failure.message }],
          })
        );
        break;
      }
      case 'begin lifecycle':
      case 'complete lifecycle': {
        const setState = fixture.repository.setProvisionState.bind(fixture.repository);
        vi.spyOn(fixture.repository, 'setProvisionState').mockImplementation(
          (context, table, state) =>
            state === (phase === 'begin lifecycle' ? 'deleting' : 'ready')
              ? Promise.resolve(err(failure))
              : setState(context, table, state)
        );
        break;
      }
      case 'side effects':
        fixture.sideEffects.failExecute = failure;
        break;
      case 'schema delete':
        fixture.schemaRepository.failDelete = failure;
        break;
      case 'metadata delete':
        fixture.repository.failDelete = failure;
        break;
      case 'event publication':
        fixture.eventBus.failPublish = failure;
        break;
    }

    const result = await fixture.handler.handle(fixture.context, fixture.command);

    expect(result._unsafeUnwrapErr().message).toBe(failure.message);
    if (phase === 'preparation' || phase === 'blocker') {
      expect(fixture.repository.provisionStateChanges).toEqual([]);
      expect(fixture.unitOfWork.transactions).toEqual([]);
    }
    const reader = (
      await fixture.coordination.acquire(
        fixture.context,
        [fixture.table, source].map((table) => table.id().toString()),
        'shared'
      )
    )._unsafeUnwrap();
    await reader.release();
  });

  it.each([
    'preparation',
    'begin lifecycle',
    'side effects',
    'complete lifecycle',
    'event publication',
  ])('releases its lease when %s throws', async (phase) => {
    const fixture = createCoordinatedDeletion();
    const source = buildTable('r');
    fixture.sideEffects.candidateTables = [source];
    const failure = new Error(`${phase} threw`);
    switch (phase) {
      case 'preparation':
        vi.spyOn(fixture.preparationService, 'prepare').mockRejectedValue(failure);
        break;
      case 'begin lifecycle':
      case 'complete lifecycle': {
        const setState = fixture.repository.setProvisionState.bind(fixture.repository);
        vi.spyOn(fixture.repository, 'setProvisionState').mockImplementation(
          (context, table, state) =>
            state === (phase === 'begin lifecycle' ? 'deleting' : 'ready')
              ? Promise.reject(failure)
              : setState(context, table, state)
        );
        break;
      }
      case 'side effects':
        vi.spyOn(fixture.sideEffects, 'executePrepared').mockRejectedValue(failure);
        break;
      case 'event publication':
        vi.spyOn(fixture.eventBus, 'publishMany').mockRejectedValue(failure);
        break;
    }

    const result = await fixture.handler.handle(fixture.context, fixture.command);
    expect(result._unsafeUnwrapErr().message).toBe(failure.message);

    const reader = (
      await fixture.coordination.acquire(
        fixture.context,
        [fixture.table, source].map((table) => table.id().toString()),
        'shared'
      )
    )._unsafeUnwrap();
    await reader.release();
  });

  it('returns an expanded acquisition error after releasing its previous lease', async () => {
    const fixture = createCoordinatedDeletion();
    const source = buildTable('o');
    fixture.sideEffects.candidateTables = [source];
    const acquire = fixture.coordination.acquire.bind(fixture.coordination);
    const failure = domainError.infrastructure({ message: 'lease acquisition failed' });
    vi.spyOn(fixture.coordination, 'acquire').mockImplementation((context, tableIds, mode) =>
      mode === 'exclusive' && tableIds.length > 1
        ? Promise.resolve(err(failure))
        : acquire(context, tableIds, mode)
    );

    const result = await fixture.handler.handle(fixture.context, fixture.command);

    expect(result._unsafeUnwrapErr()).toBe(failure);
    expect(fixture.repository.provisionStateChanges).toEqual([]);
    expect(fixture.sideEffects.calls).toBe(0);
    const reader = (
      await fixture.coordination.acquire(fixture.context, [fixture.table.id().toString()], 'shared')
    )._unsafeUnwrap();
    await reader.release();
  });

  it('waits for a schema reader before preparing or deleting its table', async () => {
    const fixture = createCoordinatedDeletion();
    const { coordination, context, table, preparationService, handler, command } = fixture;
    const reader = (
      await coordination.acquire(context, [table.id().toString()], 'shared')
    )._unsafeUnwrap();
    const prepare = vi.spyOn(preparationService, 'prepare');

    const deletion = handler.handle(context, command);

    await vi.waitFor(() => {
      expect(coordination.requests).toContainEqual({
        tableIds: [table.id().toString()],
        mode: 'exclusive',
      });
    });

    expect(prepare).not.toHaveBeenCalled();
    expect(fixture.repository.provisionStateChanges).toEqual([]);
    expect(fixture.schemaRepository.deleted).toEqual([]);
    expect(fixture.sideEffects.calls).toBe(0);
    await reader.release();
    (await deletion)._unsafeUnwrap();

    expect(prepare).toHaveBeenCalledOnce();
    expect(fixture.schemaRepository.deleted).toEqual([table]);
    expect(fixture.eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
    const nextReader = (
      await coordination.acquire(context, [table.id().toString()], 'shared')
    )._unsafeUnwrap();
    await nextReader.release();
  });

  it('returns a retryable conflict when exclusive acquisition exceeds its wait', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createCoordinatedDeletion();
      const reader = (
        await fixture.coordination.acquire(
          fixture.context,
          [fixture.table.id().toString()],
          'shared'
        )
      )._unsafeUnwrap();

      const deletion = fixture.handler.handle(fixture.context, fixture.command);
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await deletion;

      expect(result._unsafeUnwrapErr()).toMatchObject({
        code: 'schema_coordination.busy',
        tags: expect.arrayContaining(['conflict']),
      });
      expect(fixture.repository.provisionStateChanges).toEqual([]);
      await reader.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['result', 'throw'] as const)(
    'releases exclusive coverage before stalled preparation settles with a late %s',
    async (lateOutcome) => {
      vi.useFakeTimers();
      try {
        const fixture = createCoordinatedDeletion();
        const { preparationService, context, command, coordination, table } = fixture;
        const preparation = await preparationService.prepare(context, command);
        const stalled =
          Promise.withResolvers<Awaited<ReturnType<typeof preparationService.prepare>>>();
        const prepare = vi
          .spyOn(preparationService, 'prepare')
          .mockReturnValueOnce(stalled.promise);

        const deletion = fixture.handler.handle(context, command);
        await vi.advanceTimersByTimeAsync(5_000);
        expect((await deletion)._unsafeUnwrapErr().code).toBe('schema_coordination.busy');
        const reader = (
          await coordination.acquire(context, [table.id().toString()], 'shared')
        )._unsafeUnwrap();
        if (lateOutcome === 'result') stalled.resolve(preparation);
        else stalled.reject(new Error('Late metadata read failed'));
        await vi.advanceTimersByTimeAsync(0);

        expect(fixture.repository.provisionStateChanges).toEqual([]);
        expect(fixture.schemaRepository.deleted).toEqual([]);
        expect(fixture.sideEffects.calls).toBe(0);
        expect(fixture.eventBus.published).toEqual([]);
        await reader.release();
        prepare.mockRestore();
        (await fixture.handler.handle(context, command))._unsafeUnwrap();
        expect(fixture.schemaRepository.deleted).toEqual([table]);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it('releases incomplete leases and reprepares after each candidate-table expansion', async () => {
    const fixture = createCoordinatedDeletion();
    const { coordination, context, table, sideEffects, preparationService, handler, command } =
      fixture;
    const source = buildTable('m');
    const additionalSource = buildTable('n');
    sideEffects.candidateTables = [source];
    const sourceReader = (
      await coordination.acquire(context, [source.id().toString()], 'shared')
    )._unsafeUnwrap();
    const additionalReader = (
      await coordination.acquire(context, [additionalSource.id().toString()], 'shared')
    )._unsafeUnwrap();
    const prepare = vi.spyOn(preparationService, 'prepare');

    const deletion = handler.handle(context, command);
    await vi.waitFor(() => {
      expect(coordination.requests.filter(({ mode }) => mode === 'exclusive')).toHaveLength(2);
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(fixture.repository.provisionStateChanges).toEqual([]);
    expect(sideEffects.calls).toBe(0);
    // A reader can enter the target while deletion waits on a candidate: no partial lease remains.
    const targetReader = (
      await coordination.acquire(context, [table.id().toString()], 'shared')
    )._unsafeUnwrap();
    sideEffects.candidateTables = [source, additionalSource];
    await sourceReader.release();
    await targetReader.release();

    await vi.waitFor(() => {
      expect(coordination.requests.filter(({ mode }) => mode === 'exclusive')).toHaveLength(3);
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(fixture.repository.provisionStateChanges).toEqual([]);
    expect(sideEffects.calls).toBe(0);
    await additionalReader.release();
    (await deletion)._unsafeUnwrap();

    expect(prepare).toHaveBeenCalledTimes(3);
    const finalPreparation = await prepare.mock.results[2]?.value;
    expect(sideEffects.preparations[0]).toBe(finalPreparation?._unsafeUnwrap().sideEffects);
    expect(coordination.requests.filter(({ mode }) => mode === 'exclusive')).toEqual([
      { tableIds: [table.id().toString()], mode: 'exclusive' },
      {
        tableIds: [table, source].map((candidate) => candidate.id().toString()).sort(),
        mode: 'exclusive',
      },
      {
        tableIds: [table, source, additionalSource]
          .map((candidate) => candidate.id().toString())
          .sort(),
        mode: 'exclusive',
      },
    ]);
    expect(
      sideEffects.preparations[0]?.candidatePlans.map(({ sourceTable }) => sourceTable)
    ).toEqual([source, additionalSource]);
    const nextReader = (
      await coordination.acquire(
        context,
        [table, source, additionalSource].map((candidate) => candidate.id().toString()),
        'shared'
      )
    )._unsafeUnwrap();
    await nextReader.release();
  });

  it('allows reciprocal table deletions to acquire their complete lease without deadlocking', async () => {
    const first = createCoordinatedDeletion();
    const second = createCoordinatedDeletion();
    const preparationBarrier = Promise.withResolvers<void>();
    let preparations = 0;
    for (const [fixture, source] of [
      [first, second.table],
      [second, first.table],
    ] as const) {
      fixture.sideEffects.candidateTables = [source];
      const prepare = fixture.preparationService.prepare.bind(fixture.preparationService);
      vi.spyOn(fixture.preparationService, 'prepare').mockImplementation(
        async (context, command) => {
          const result = await prepare(context, command);
          preparations += 1;
          if (preparations === 2) preparationBarrier.resolve();
          await preparationBarrier.promise;
          return result;
        }
      );
    }
    const secondHandler = createHandler(
      second.repository,
      second.schemaRepository,
      second.sideEffects,
      second.eventBus,
      new FakeLogger(),
      second.unitOfWork,
      second.preparationService,
      first.coordination
    );

    const results = await Promise.all([
      first.handler.handle(first.context, first.command),
      secondHandler.handle(second.context, second.command),
    ]);

    for (const result of results) result._unsafeUnwrap();
    expect(first.schemaRepository.deleted).toEqual([first.table]);
    expect(second.schemaRepository.deleted).toEqual([second.table]);
  });

  it('soft deletes tables without dropping schema and publishes TableTrashed', async () => {
    const table = buildTable('a');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const logger = new FakeLogger();
    const unitOfWork = new FakeUnitOfWork();

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    });
    commandResult._unsafeUnwrap();

    const handler = createHandler(
      repo,
      schemaRepo,
      sideEffectService,
      eventBus,
      logger,
      unitOfWork
    );
    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrap();

    expect(schemaRepo.deleted).toHaveLength(0);
    expect(sideEffectService.calls).toBe(1);
    expect(schemaRepo.deleteModes).toEqual(['soft']);
    expect(repo.deleted).toHaveLength(1);
    expect(repo.deleteModes).toEqual(['soft']);
    expect(repo.provisionStateChanges.map(({ state }) => state)).toEqual(['deleting', 'ready']);
    expect(eventBus.published.some((event) => event instanceof TableTrashed)).toBe(true);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(false);
    expect(unitOfWork.transactions.length).toBe(4);
    expect(unitOfWork.transactions.map((context) => context.transaction?.scope)).toEqual([
      'meta',
      'meta',
      'data',
      'meta',
    ]);
    expect(sideEffectService.contexts[0]?.transactions?.meta?.scope).toBe('meta');
    expect(sideEffectService.contexts[0]?.transactions?.data?.scope).toBe('data');
  });

  it('turns public links off before a table goes to the trash, in its transaction', async () => {
    const table = buildPublicFileTable('f');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const eventBus = new FakeEventBus();
    const handler = createHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService(),
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    (await handler.handle(createContext(), command))._unsafeUnwrap();

    // one write for every public field, before the delete, in the deletion's meta transaction
    expect(repo.writes).toEqual(['update', 'delete']);
    expect(repo.updates[0]?.context.transaction?.scope).toBe('meta');
    expect(publicFieldNames(repo.updates[0]!.table)).toEqual([]);
    // the trashed table is on no page, so TableTrashed is the only notice
    expect(eventBus.published.some((event) => event instanceof FieldUpdated)).toBe(false);
    expect(eventBus.published.some((event) => event instanceof TableTrashed)).toBe(true);
  });

  it('leaves public links alone when a table is deleted for good', async () => {
    const table = buildPublicFileTable('g');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const handler = createHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService(),
      new FakeEventBus(),
      new FakeLogger(),
      new FakeUnitOfWork()
    );
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    (await handler.handle(createContext(), command))._unsafeUnwrap();

    expect(repo.writes).toEqual(['delete']);
  });

  it('does not trash a table whose public links could not be turned off', async () => {
    const table = buildPublicFileTable('h');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    repo.failUpdate = domainError.infrastructure({ message: 'field write failed' });
    const eventBus = new FakeEventBus();
    const handler = createHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService(),
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().message).toBe('field write failed');
    expect(repo.deleted).toHaveLength(0);
    expect(eventBus.published.some((event) => event instanceof TableTrashed)).toBe(false);
  });

  it('stops on prepared blockers before schema lifecycle or persistence', async () => {
    const table = buildTable('k');
    const repository = new FakeTableRepository();
    repository.tables.push(table);
    const schemaRepository = new FakeTableSchemaRepository();
    const sideEffects = new FakeTableDeletionSideEffectService();
    const eventBus = new FakeEventBus();
    const unitOfWork = new FakeUnitOfWork();
    const preparationService: ITableDeletionPreparationService = {
      async prepare() {
        return ok({
          table,
          mode: 'soft',
          sourceState: 'active',
          blockers: [{ code: 'table.delete.blocked', message: 'Deletion blocked.' }],
          sideEffects: {
            deletedTable: table,
            candidateEvidence: 'unknown',
            candidateTableCount: 0,
            downstreamCascadeEvidence: 'not-applicable',
            reactionEffects: [],
            candidatePlans: [],
          },
        });
      },
    };
    const handler = createHandler(
      repository,
      schemaRepository,
      sideEffects,
      eventBus,
      new FakeLogger(),
      unitOfWork,
      preparationService
    );
    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);

    expect(result._unsafeUnwrapErr().code).toBe('table.delete.blocked');
    expect(unitOfWork.transactions).toEqual([]);
    expect(repository.provisionStateChanges).toEqual([]);
    expect(schemaRepository.deleteModes).toEqual([]);
    expect(sideEffects.calls).toBe(0);
    expect(eventBus.published).toEqual([]);
  });

  it('loads active tables in any provisioning state so failed provisioning can be deleted', async () => {
    const table = buildTable('e');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const handler = createHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService(),
      new FakeEventBus(),
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(repo.findStates[0]).toBe('activeAnyProvision');
    expect(repo.deleteModes).toEqual(['soft']);
  });

  it('publishes permanent-delete side-effect post-persist events without returning them in the response payload', async () => {
    const table = buildTable('s');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    sideEffectService.postPersistEvents = [
      TableActionTriggerRequested.create({
        tableId: table.id(),
        baseId: table.baseId(),
        actionKey: 'setRecord',
        payload: { tableId: table.id().toString(), fieldIds: [] },
      }),
    ];

    const handler = createHandler(
      repo,
      schemaRepo,
      sideEffectService,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    const payload = result._unsafeUnwrap();
    const responseEventNames = payload.events.map((event) => event.name.toString());
    const publishedEventNames = eventBus.published.map((event) => event.name.toString());

    expect(responseEventNames).not.toContain('TableActionTriggerRequested');
    expect(publishedEventNames).toContain('TableActionTriggerRequested');
    expect(publishedEventNames).toContain('TableDeleted');
  });

  it('permanently deletes tables and publishes TableDeleted', async () => {
    const table = buildTable('p');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const handler = createHandler(
      repo,
      schemaRepo,
      new FakeTableDeletionSideEffectService(),
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(schemaRepo.deleted).toHaveLength(1);
    expect(schemaRepo.deleteModes).toEqual(['permanent']);
    expect(repo.deleteModes).toEqual(['permanent']);
    expect(repo.provisionStateChanges.map(({ state }) => state)).toEqual(['deleting', 'ready']);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
  });

  it('runs side effects when permanently deleting an already trashed table', async () => {
    const table = buildTable('q');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    repo.deletedTableIds.add(table.id().toString());
    const schemaRepo = new FakeTableSchemaRepository();
    const eventBus = new FakeEventBus();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const handler = createHandler(
      repo,
      schemaRepo,
      sideEffectService,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const command = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    result._unsafeUnwrap();

    expect(sideEffectService.calls).toBe(1);
    expect(schemaRepo.deleteModes).toEqual(['permanent']);
    expect(repo.deleteModes).toEqual(['permanent']);
    expect(repo.provisionStateChanges.map(({ state }) => state)).toEqual(['deleting', 'ready']);
    expect(eventBus.published.some((event) => event instanceof TableDeleted)).toBe(true);
  });

  it('returns not found when table is missing', async () => {
    const table = buildTable('b');
    const repo = new FakeTableRepository();
    const handler = createHandler(
      repo,
      new FakeTableSchemaRepository(),
      new FakeTableDeletionSideEffectService(),
      new FakeEventBus(),
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    });
    commandResult._unsafeUnwrap();

    const result = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    result._unsafeUnwrapErr();
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });

  it('returns errors from repositories and event bus', async () => {
    const table = buildTable('c');
    const repo = new FakeTableRepository();
    repo.tables.push(table);
    const schemaRepo = new FakeTableSchemaRepository();
    const sideEffectService = new FakeTableDeletionSideEffectService();
    const eventBus = new FakeEventBus();

    const handler = createHandler(
      repo,
      schemaRepo,
      sideEffectService,
      eventBus,
      new FakeLogger(),
      new FakeUnitOfWork()
    );

    const commandResult = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'permanent',
    });
    commandResult._unsafeUnwrap();

    sideEffectService.failExecute = domainError.unexpected({ message: 'side effect failed' });
    const sideEffectResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(sideEffectResult._unsafeUnwrapErr().message).toBe('side effect failed');
    expect(repo.provisionStateChanges.slice(-2).map(({ state }) => state)).toEqual([
      'deleting',
      'ready',
    ]);

    sideEffectService.failExecute = undefined;
    repo.provisionStateChanges = [];
    schemaRepo.failDelete = domainError.unexpected({ message: 'schema delete failed' });
    const schemaResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(schemaResult._unsafeUnwrapErr().message).toBe('schema delete failed');
    expect(repo.provisionStateChanges.slice(-2).map(({ state }) => state)).toEqual([
      'deleting',
      'ready',
    ]);

    schemaRepo.failDelete = undefined;
    repo.provisionStateChanges = [];
    repo.failDelete = domainError.unexpected({ message: 'repo delete failed' });
    const repoResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(repoResult._unsafeUnwrapErr().message).toBe('repo delete failed');
    expect(repo.provisionStateChanges.slice(-2).map(({ state }) => state)).toEqual([
      'deleting',
      'ready',
    ]);

    const softCommand = DeleteTableCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      mode: 'soft',
    })._unsafeUnwrap();
    repo.provisionStateChanges = [];
    const softMetaResult = await handler.handle(createContext(), softCommand);
    expect(softMetaResult._unsafeUnwrapErr().message).toBe('repo delete failed');
    expect(repo.provisionStateChanges.slice(-2).map(({ state }) => state)).toEqual([
      'deleting',
      'ready',
    ]);

    repo.failDelete = undefined;
    repo.provisionStateChanges = [];
    eventBus.failPublish = domainError.unexpected({ message: 'publish failed' });
    const publishResult = await handler.handle(createContext(), commandResult._unsafeUnwrap());
    expect(publishResult._unsafeUnwrapErr().message).toBe('publish failed');
    expect(repo.provisionStateChanges.map(({ state }) => state)).toEqual(['deleting', 'ready']);
  });
});
