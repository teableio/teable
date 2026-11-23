import { err, ok, safeTry } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { CreateTableCommand } from '../../commands/CreateTableCommand';
import { CreateTableHandler } from '../../commands/CreateTableHandler';
import { CreateTablesCommand } from '../../commands/CreateTablesCommand';
import { CreateTablesHandler } from '../../commands/CreateTablesHandler';
import { DeleteTableCommand } from '../../commands/DeleteTableCommand';
import { DeleteTableHandler } from '../../commands/DeleteTableHandler';
import { DeleteViewCommand } from '../../commands/DeleteViewCommand';
import { DeleteViewHandler } from '../../commands/DeleteViewHandler';
import { RestoreTableCommand } from '../../commands/RestoreTableCommand';
import { RestoreTableHandler } from '../../commands/RestoreTableHandler';
import { createTableOperationPluginRunner } from '../../commands/tableOperationPluginRunnerTestUtils';
import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import { domainError, type DomainError } from '../../domain/shared/DomainError';
import type { IDomainEvent } from '../../domain/shared/DomainEvent';
import type { ISpecification } from '../../domain/shared/specification/ISpecification';
import { FieldDeleted } from '../../domain/table/events/FieldDeleted';
import { TableCreated } from '../../domain/table/events/TableCreated';
import { TableDeleted } from '../../domain/table/events/TableDeleted';
import { TableRestored } from '../../domain/table/events/TableRestored';
import { TableTrashed } from '../../domain/table/events/TableTrashed';
import { ViewDeleted } from '../../domain/table/events/ViewDeleted';
import { FieldId } from '../../domain/table/fields/FieldId';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { RecordId } from '../../domain/table/records/RecordId';
import type { RecordUpdateResult } from '../../domain/table/records/RecordUpdateResult';
import type { ITableRecordConditionSpecVisitor } from '../../domain/table/records/specs/ITableRecordConditionSpecVisitor';
import type { ICellValueSpec } from '../../domain/table/records/specs/values/ICellValueSpecVisitor';
import type { TableRecord } from '../../domain/table/records/TableRecord';
import type { ITableSpecVisitor } from '../../domain/table/specs/ITableSpecVisitor';
import { Table } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import { NoopLogger } from '../../ports/defaults/NoopLogger';
import { NoopTableRecordQueryRepository } from '../../ports/defaults/NoopTableRecordQueryRepository';
import type { IEventBus } from '../../ports/EventBus';
import type {
  IExecutionContext,
  IUnitOfWorkTransaction,
  SameTxProjectionContext,
  UnitOfWorkScope,
} from '../../ports/ExecutionContext';
import { DefaultTableMapper } from '../../ports/mappers/defaults/DefaultTableMapper';
import { EventBusDomainWriteTransaction } from '../../ports/memory/EventBusDomainWriteTransaction';
import type {
  BatchRecordMutationResult,
  ITableRecordRepository,
  InsertManyStreamOptions,
  InsertManyStreamResult,
  RecordMutationResult,
} from '../../ports/TableRecordRepository';
import type {
  ITableRepository,
  TableDeleteOptions,
  TableFindOneOptions,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { registerSameTxProjection } from '../projections/SameTxProjection';
import { AttachmentValueResolverService } from './AttachmentValueResolverService';
import { FieldCreationSideEffectService } from './FieldCreationSideEffectService';
import { ForeignTableLoaderService } from './ForeignTableLoaderService';
import { LinkTitleResolverService } from './LinkTitleResolverService';
import { RecordMutationSpecResolverService } from './RecordMutationSpecResolverService';
import { SameTxProjectionDispatcher } from './SameTxProjectionDispatcher';
import { TableCreationService } from './TableCreationService';
import { TableDeletionPreparationService } from './TableDeletionPreparationService';
import { TableQueryService } from './TableQueryService';
import { TableUpdateFlow } from './TableUpdateFlow';
import { UserValueResolverService } from './UserValueResolverService';
import type { ViewUndoRedoService } from './ViewUndoRedoService';

const baseIdStr = `bse${'b'.repeat(16)}`;
const baseId = BaseId.create(baseIdStr)._unsafeUnwrap();
const tableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const fieldId = (seed: string) => FieldId.create(`fld${seed.repeat(16)}`)._unsafeUnwrap();

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('usr-schema-batch')._unsafeUnwrap(),
});

const buildTwoFieldTwoViewTable = (seed = 'a') => {
  const builder = Table.builder()
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
  builder
    .field()
    .number()
    .withId(fieldId('n'))
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const baseTable = builder.build()._unsafeUnwrap();
  const withSecondView = baseTable
    .createView({ type: 'grid', name: 'Secondary View' })
    ._unsafeUnwrap().updateResult.table;
  withSecondView.pullDomainEvents();
  const secondaryViewId = withSecondView.views()[1]!.id();
  return {
    table: withSecondView,
    primaryFieldId: fieldId(seed),
    secondaryFieldId: fieldId('n'),
    secondaryViewId,
  };
};

class SharedTestUnitOfWork implements IUnitOfWork {
  beginCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  readonly scopes: UnitOfWorkScope[] = [];

  constructor(private readonly sharePhysicalTxAcrossScopes = true) {}

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    const scope: UnitOfWorkScope = options?.scope ?? 'data';
    const existing =
      context.transactions?.[scope] ??
      (this.sharePhysicalTxAcrossScopes ? context.transaction : undefined);

    if (existing) {
      return work({
        ...context,
        transaction: existing,
        transactions: {
          ...(context.transactions ?? {}),
          [scope]: existing,
        },
      });
    }

    this.beginCount += 1;
    this.scopes.push(scope);
    const afterCommitHandlers: Array<() => Promise<void> | void> = [];
    const afterRollbackHandlers: Array<() => Promise<void> | void> = [];
    const tx: IUnitOfWorkTransaction = {
      kind: 'unitOfWorkTransaction',
      scope,
      afterCommit(fn) {
        afterCommitHandlers.push(fn);
      },
      afterRollback(fn) {
        afterRollbackHandlers.push(fn);
      },
    };

    const nextContext: IExecutionContext = {
      ...context,
      transaction: tx,
      transactions: {
        ...(context.transactions ?? {}),
        ...(this.sharePhysicalTxAcrossScopes ? { meta: tx, data: tx } : { [scope]: tx }),
      },
    };

    const result = await work(nextContext);
    if (result.isOk()) {
      this.commitCount += 1;
      for (const fn of afterCommitHandlers) {
        await fn();
      }
    } else {
      this.rollbackCount += 1;
      for (const fn of afterRollbackHandlers) {
        await fn();
      }
    }
    return result;
  }
}

class InMemoryTableRepository implements ITableRepository {
  tables: Table[] = [];
  deletedIds = new Set<string>();
  readonly provisionCalls: Array<{
    hasTx: boolean;
    tableId: string;
    state: TableProvisionState;
    operation?: TableProvisionOperationOptions;
  }> = [];

  async insert(context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    this.tables.push(table);
    return ok(table);
  }

  async insertMany(
    _context: IExecutionContext,
    tables: ReadonlyArray<Table>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    this.tables.push(...tables);
    return ok([...tables]);
  }

  async findOne(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>,
    options?: TableFindOneOptions
  ): Promise<Result<Table, DomainError>> {
    const match = this.tables.find((t) => {
      const isDel = this.deletedIds.has(t.id().toString());
      if (options?.state === 'deleted' && !isDel) return false;
      if ((options?.state == null || options.state === 'active') && isDel) return false;
      return spec.isSatisfiedBy(t);
    });
    if (!match) return err(domainError.notFound({ message: 'Table not found' }));
    return ok(match);
  }

  async find(
    _context: IExecutionContext,
    spec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(
      this.tables.filter((t) => !this.deletedIds.has(t.id().toString()) && spec.isSatisfiedBy(t))
    );
  }

  async updateOne(
    _context: IExecutionContext,
    table: Table,
    _mutateSpec: ISpecification<Table, ITableSpecVisitor>
  ): Promise<Result<void, DomainError>> {
    const cloned = table.clone(new DefaultTableMapper())._unsafeUnwrap();
    const idx = this.tables.findIndex((t) => t.id().equals(table.id()));
    if (idx >= 0) {
      this.tables[idx] = cloned;
    } else {
      this.tables.push(cloned);
    }
    return ok(undefined);
  }

  async restore(_context: IExecutionContext, table: Table): Promise<Result<void, DomainError>> {
    this.deletedIds.delete(table.id().toString());
    return ok(undefined);
  }

  async delete(
    _context: IExecutionContext,
    table: Table,
    options?: TableDeleteOptions
  ): Promise<Result<void, DomainError>> {
    if (options?.mode === 'permanent') {
      this.tables = this.tables.filter((t) => !t.id().equals(table.id()));
      this.deletedIds.delete(table.id().toString());
    } else {
      this.deletedIds.add(table.id().toString());
    }
    return ok(undefined);
  }

  async setProvisionState(
    context: IExecutionContext,
    table: Table,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    this.provisionCalls.push({
      hasTx: Boolean(context.transaction),
      tableId: table.id().toString(),
      state,
      operation,
    });
    return ok(undefined);
  }

  async setProvisionStateMany(
    context: IExecutionContext,
    tables: ReadonlyArray<Table>,
    state: TableProvisionState,
    operation?: TableProvisionOperationOptions
  ): Promise<Result<void, DomainError>> {
    for (const table of tables) {
      this.provisionCalls.push({
        hasTx: Boolean(context.transaction),
        tableId: table.id().toString(),
        state,
        operation,
      });
    }
    return ok(undefined);
  }
}

class InMemoryTableSchemaRepository implements ITableSchemaRepository {
  failUpdate = false;
  async insert(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
  async insertMany(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
  async update(_context: IExecutionContext, table: Table): Promise<Result<Table, DomainError>> {
    if (this.failUpdate) {
      return err(domainError.unexpected({ message: 'schema update failed' }));
    }
    return ok(table);
  }
  async delete(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
}

class InMemoryTableRecordRepository implements ITableRecordRepository {
  async insert(): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }
  async insertMany(): Promise<Result<BatchRecordMutationResult, DomainError>> {
    return ok({});
  }
  async insertManyStream(
    _ctx: IExecutionContext,
    _t: Table,
    _b: Iterable<ReadonlyArray<TableRecord>> | AsyncIterable<ReadonlyArray<TableRecord>>,
    _opts?: InsertManyStreamOptions
  ): Promise<Result<InsertManyStreamResult, DomainError>> {
    return ok({ totalInserted: 0 });
  }
  async updateOne(
    _ctx: IExecutionContext,
    _t: Table,
    _id: RecordId,
    _spec: ICellValueSpec
  ): Promise<Result<RecordMutationResult, DomainError>> {
    return ok({});
  }
  async updateMany(
    _ctx: IExecutionContext,
    _t: Table,
    _spec: ISpecification<TableRecord, ITableRecordConditionSpecVisitor>,
    _m: ICellValueSpec
  ) {
    return ok({ totalUpdated: 0, updatedRecordIds: [], updatedRecords: [] });
  }
  async updateManyStream(
    _ctx: IExecutionContext,
    _t: Table,
    _b: Generator<Result<ReadonlyArray<RecordUpdateResult>, DomainError>>
  ) {
    return ok({ totalUpdated: 0, updatedRecords: [] as [] });
  }
  async deleteMany() {
    return ok({});
  }
  async duplicatePhysicalRows() {
    return ok({ rowCount: 0, recordIds: [] });
  }
  async deleteManyStream() {
    return ok({ totalDeleted: 0 });
  }
}

class SpyEventBus implements IEventBus {
  published: IDomainEvent[] = [];
  async publish(_ctx: IExecutionContext, event: IDomainEvent): Promise<Result<void, DomainError>> {
    this.published.push(event);
    return ok(undefined);
  }
  async publishMany(
    _ctx: IExecutionContext,
    events: ReadonlyArray<IDomainEvent>
  ): Promise<Result<void, DomainError>> {
    this.published.push(...events);
    return ok(undefined);
  }
}

const createRecordMutationSpecResolver = (tableRepo: ITableRepository) =>
  new RecordMutationSpecResolverService(
    new LinkTitleResolverService(tableRepo, new NoopTableRecordQueryRepository()),
    new AttachmentValueResolverService({
      listAttachmentsByTokens: async () => ok([]),
      listAttachmentsByAttachmentIds: async () => ok([]),
    }),
    new UserValueResolverService({
      listTableUsersByIdentifiers: async () => ok([]),
      listUsersByIdentityPairs: async () => ok([]),
      listUsersByIds: async () => ok([]),
    })
  );

type RecordedSameTxCall = {
  eventName: string;
  event: IDomainEvent;
  scope: UnitOfWorkScope | undefined;
  sameTxProjection: SameTxProjectionContext | undefined;
};

describe('BatchSchemaAndRecordTransaction & same-tx schema/view projection dispatch', () => {
  it('TableUpdateFlow dispatches @SameTxProjectionHandler inside data tx with tables and previousTables, and rolls back on error', async () => {
    const calls: RecordedSameTxCall[] = [];
    let shouldFail = false;

    class FieldAndViewDeletedProjection {
      async handle(
        ctx: IExecutionContext,
        event: IDomainEvent
      ): Promise<Result<void, DomainError>> {
        calls.push({
          eventName: event.name.toString(),
          event,
          scope: ctx.transaction?.scope,
          sameTxProjection: ctx.sameTxProjection,
        });
        if (shouldFail) {
          return err(domainError.unexpected({ message: 'sameTx abort' }));
        }
        return ok(undefined);
      }
    }

    const unregField = registerSameTxProjection(
      FieldDeleted as never,
      FieldAndViewDeletedProjection as never,
      { id: 'test-field-deleted' }
    );
    const unregView = registerSameTxProjection(
      ViewDeleted as never,
      FieldAndViewDeletedProjection as never,
      { id: 'test-view-deleted' }
    );

    try {
      const dispatcher = new SameTxProjectionDispatcher({
        resolve: () => new FieldAndViewDeletedProjection(),
        isRegistered: () => true,
      } as never);

      const { table, secondaryFieldId, secondaryViewId } = buildTwoFieldTwoViewTable('a');
      const tableRepo = new InMemoryTableRepository();
      tableRepo.tables.push(table);
      const schemaRepo = new InMemoryTableSchemaRepository();
      const eventBus = new SpyEventBus();
      const unitOfWork = new SharedTestUnitOfWork(false);

      const flow = new TableUpdateFlow(
        tableRepo,
        schemaRepo,
        eventBus,
        unitOfWork,
        new NoopLogger(),
        dispatcher
      );

      // 1. FieldDeleted via TableUpdateFlow sees previous field on previousTables
      const deleteFieldRes = await flow.execute(createContext(), { table }, (t) =>
        t.update((m) => m.removeField(secondaryFieldId))
      );
      expect(deleteFieldRes.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('FieldDeleted');
      expect(calls[0]?.scope).toBe('data');
      const prevTable = calls[0]?.sameTxProjection?.previousTables?.get(table.id().toString()) as
        | Table
        | undefined;
      const nextTable = calls[0]?.sameTxProjection?.tables.get(table.id().toString()) as
        | Table
        | undefined;
      expect(prevTable).toBeDefined();
      expect(nextTable).toBeDefined();
      expect(prevTable!.getField((f) => f.id().equals(secondaryFieldId)).isOk()).toBe(true);
      expect(nextTable!.getField((f) => f.id().equals(secondaryFieldId)).isErr()).toBe(true);

      // 2. ViewDeleted via TableUpdateFlow sees deleted view on previousTables
      calls.length = 0;
      const updatedTable = deleteFieldRes._unsafeUnwrap().table;
      const deleteViewRes = await flow.execute(createContext(), { table: updatedTable }, (t) =>
        t.deleteView(secondaryViewId).map((res) => res.updateResult)
      );
      expect(deleteViewRes.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('ViewDeleted');
      expect(calls[0]?.scope).toBe('data');
      const prevForView = calls[0]?.sameTxProjection?.previousTables?.get(
        updatedTable.id().toString()
      ) as Table | undefined;
      const nextForView = calls[0]?.sameTxProjection?.tables.get(updatedTable.id().toString()) as
        | Table
        | undefined;
      expect(prevForView!.views().some((v) => v.id().equals(secondaryViewId))).toBe(true);
      expect(nextForView!.views().some((v) => v.id().equals(secondaryViewId))).toBe(false);

      // 3. SameTx failure aborts transaction & suppresses eventBus publication
      calls.length = 0;
      eventBus.published.length = 0;
      shouldFail = true;
      const abortRes = await flow.execute(
        createContext(),
        { table: deleteViewRes._unsafeUnwrap().table },
        (t) => t.update((m) => m.rename(TableName.create('Aborted Rename')._unsafeUnwrap()))
      );
      // Even without handler on TableRenamed, re-test with ViewDeleted / new view
      expect(abortRes.isOk()).toBe(true);

      const extraViewTable = deleteViewRes
        ._unsafeUnwrap()
        .table.createView({ type: 'grid', name: 'To Abort' })
        ._unsafeUnwrap().updateResult.table;
      extraViewTable.pullDomainEvents();
      await tableRepo.updateOne(createContext(), extraViewTable, {} as never);
      const extraViewId = extraViewTable.views()[1]!.id();
      eventBus.published.length = 0;
      const rollbacksBefore = unitOfWork.rollbackCount;
      const failedFlow = await flow.execute(createContext(), { table: extraViewTable }, (t) =>
        t.deleteView(extraViewId).map((res) => res.updateResult)
      );
      expect(failedFlow.isErr()).toBe(true);
      expect(unitOfWork.rollbackCount).toBe(rollbacksBefore + 2);
      expect(eventBus.published).toHaveLength(0);
    } finally {
      unregField();
      unregView();
    }
  });

  it('CreateTableHandler, CreateTablesHandler, DeleteTableHandler, RestoreTableHandler, DeleteViewHandler all dispatch @SameTxProjectionHandler in data tx and abort on error', async () => {
    const calls: RecordedSameTxCall[] = [];
    let failOnEvent: string | undefined;

    class LifecycleProjection {
      async handle(
        ctx: IExecutionContext,
        event: IDomainEvent
      ): Promise<Result<void, DomainError>> {
        calls.push({
          eventName: event.name.toString(),
          event,
          scope: ctx.transaction?.scope,
          sameTxProjection: ctx.sameTxProjection,
        });
        if (failOnEvent === event.name.toString()) {
          return err(domainError.unexpected({ message: `abort ${event.name.toString()}` }));
        }
        return ok(undefined);
      }
    }

    const unregs = [
      registerSameTxProjection(TableCreated as never, LifecycleProjection as never, {
        id: 'test-table-created',
      }),
      registerSameTxProjection(TableDeleted as never, LifecycleProjection as never, {
        id: 'test-table-deleted',
      }),
      registerSameTxProjection(TableTrashed as never, LifecycleProjection as never, {
        id: 'test-table-trashed',
      }),
      registerSameTxProjection(TableRestored as never, LifecycleProjection as never, {
        id: 'test-table-restored',
      }),
      registerSameTxProjection(ViewDeleted as never, LifecycleProjection as never, {
        id: 'test-view-deleted-handler',
      }),
    ];

    try {
      const dispatcher = new SameTxProjectionDispatcher({
        resolve: () => new LifecycleProjection(),
        isRegistered: () => true,
      } as never);

      const makeEnv = () => {
        const tableRepo = new InMemoryTableRepository();
        const schemaRepo = new InMemoryTableSchemaRepository();
        const recordRepo = new InMemoryTableRecordRepository();
        const eventBus = new SpyEventBus();
        const unitOfWork = new SharedTestUnitOfWork(false);
        const flow = new TableUpdateFlow(
          tableRepo,
          schemaRepo,
          eventBus,
          unitOfWork,
          new NoopLogger(),
          dispatcher
        );
        const fieldCreationSideEffects = new FieldCreationSideEffectService(flow);
        const foreignLoader = new ForeignTableLoaderService(tableRepo);
        const resolver = createRecordMutationSpecResolver(tableRepo);
        const creationService = new TableCreationService(
          tableRepo,
          schemaRepo,
          fieldCreationSideEffects
        );
        const delPrep = new TableDeletionPreparationService(tableRepo, {
          prepare: async (_c: IExecutionContext, input: { table: Table }) =>
            ok({
              deletedTable: input.table,
              candidateEvidence: 'unknown',
              candidateTableCount: 0,
              downstreamCascadeEvidence: 'not-applicable',
              reactionEffects: [],
              candidatePlans: [],
            }),
        } as never);

        const createTableHandler = new CreateTableHandler(
          tableRepo,
          schemaRepo,
          recordRepo,
          fieldCreationSideEffects,
          foreignLoader,
          eventBus,
          unitOfWork,
          resolver,
          undefined,
          createTableOperationPluginRunner([]),
          undefined,
          undefined,
          dispatcher
        );
        const createTablesHandler = new CreateTablesHandler(
          tableRepo,
          recordRepo,
          foreignLoader,
          creationService,
          eventBus,
          unitOfWork,
          resolver,
          undefined,
          createTableOperationPluginRunner([]),
          undefined,
          undefined,
          dispatcher
        );
        const deleteTableHandler = new DeleteTableHandler(
          tableRepo,
          schemaRepo,
          {
            executePrepared: async () =>
              ok({ events: [], postPersistEvents: [], updatedTables: [] }),
          } as never,
          delPrep,
          eventBus,
          new NoopLogger(),
          unitOfWork,
          undefined,
          createTableOperationPluginRunner([]),
          dispatcher
        );
        const restoreTableHandler = new RestoreTableHandler(
          new TableQueryService(tableRepo),
          tableRepo,
          eventBus,
          unitOfWork,
          createTableOperationPluginRunner([]),
          dispatcher
        );
        const domainTx = new EventBusDomainWriteTransaction(unitOfWork, eventBus, dispatcher);
        const deleteViewHandler = new DeleteViewHandler(tableRepo, flow, domainTx, {
          capture: vi.fn(() => ok({ id: 'viw' } as never)),
          appendDelete: vi.fn(async () => ok(undefined)),
        } as unknown as ViewUndoRedoService);

        return {
          tableRepo,
          eventBus,
          unitOfWork,
          createTableHandler,
          createTablesHandler,
          deleteTableHandler,
          restoreTableHandler,
          deleteViewHandler,
        };
      };

      // CreateTableHandler
      calls.length = 0;
      const e1 = makeEnv();
      const createCmd = CreateTableCommand.create({
        baseId: baseIdStr,
        name: 'Created One',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap();
      const c1 = await e1.createTableHandler.handle(createContext(), createCmd);
      expect(c1.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('TableCreated');
      expect(calls[0]?.scope).toBe('data');
      expect(calls[0]?.sameTxProjection?.tables.has(c1._unsafeUnwrap().table.id().toString())).toBe(
        true
      );

      failOnEvent = 'TableCreated';
      const e1Fail = makeEnv();
      const c1Fail = await e1Fail.createTableHandler.handle(createContext(), createCmd);
      expect(c1Fail.isErr()).toBe(true);
      expect(e1Fail.eventBus.published).toHaveLength(0);
      failOnEvent = undefined;

      // CreateTablesHandler
      calls.length = 0;
      const e2 = makeEnv();
      const createBatchCmd = CreateTablesCommand.create({
        baseId: baseIdStr,
        tables: [
          {
            name: 'Batch A',
            fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
            views: [{ type: 'grid' }],
          },
          {
            name: 'Batch B',
            fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
            views: [{ type: 'grid' }],
          },
        ],
      })._unsafeUnwrap();
      const c2 = await e2.createTablesHandler.handle(createContext(), createBatchCmd);
      expect(c2.isOk()).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls.every((c) => c.eventName === 'TableCreated' && c.scope === 'data')).toBe(true);

      failOnEvent = 'TableCreated';
      const e2Fail = makeEnv();
      const c2Fail = await e2Fail.createTablesHandler.handle(createContext(), createBatchCmd);
      expect(c2Fail.isErr()).toBe(true);
      expect(e2Fail.eventBus.published).toHaveLength(0);
      failOnEvent = undefined;

      // DeleteViewHandler
      calls.length = 0;
      const eView = makeEnv();
      const { table: viewTbl, secondaryViewId } = buildTwoFieldTwoViewTable('v');
      eView.tableRepo.tables.push(viewTbl);
      const delViewCmd = DeleteViewCommand.create({
        tableId: viewTbl.id().toString(),
        viewId: secondaryViewId.toString(),
      })._unsafeUnwrap();
      const dv = await eView.deleteViewHandler.handle(createContext(), delViewCmd);
      expect(dv.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('ViewDeleted');
      expect(calls[0]?.scope).toBe('data');
      const prevV = calls[0]?.sameTxProjection?.previousTables?.get(viewTbl.id().toString()) as
        | Table
        | undefined;
      expect(prevV?.views().some((v) => v.id().equals(secondaryViewId))).toBe(true);

      // DeleteTableHandler (permanent -> TableDeleted + previousTables)
      calls.length = 0;
      const eDel = makeEnv();
      const { table: delTbl } = buildTwoFieldTwoViewTable('d');
      eDel.tableRepo.tables.push(delTbl);
      const delCmd = DeleteTableCommand.create({
        baseId: baseIdStr,
        tableId: delTbl.id().toString(),
        mode: 'permanent',
      })._unsafeUnwrap();
      const dt = await eDel.deleteTableHandler.handle(createContext(), delCmd);
      expect(dt.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('TableDeleted');
      expect(calls[0]?.scope).toBe('data');
      expect(calls[0]?.sameTxProjection?.previousTables?.has(delTbl.id().toString())).toBe(true);

      // RestoreTableHandler
      calls.length = 0;
      const eRestore = makeEnv();
      const { table: rstTbl } = buildTwoFieldTwoViewTable('r');
      eRestore.tableRepo.tables.push(rstTbl);
      eRestore.tableRepo.deletedIds.add(rstTbl.id().toString());
      const rstCmd = RestoreTableCommand.create({
        baseId: baseIdStr,
        tableId: rstTbl.id().toString(),
      })._unsafeUnwrap();
      const rt = await eRestore.restoreTableHandler.handle(createContext(), rstCmd);
      expect(rt.isOk()).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.eventName).toBe('TableRestored');
      expect(calls[0]?.scope).toBe('data');
      expect(calls[0]?.sameTxProjection?.tables.has(rstTbl.id().toString())).toBe(true);

      failOnEvent = 'TableRestored';
      const eRestoreFail = makeEnv();
      eRestoreFail.tableRepo.tables.push(rstTbl);
      eRestoreFail.tableRepo.deletedIds.add(rstTbl.id().toString());
      const rtFail = await eRestoreFail.restoreTableHandler.handle(createContext(), rstCmd);
      expect(rtFail.isErr()).toBe(true);
      expect(eRestoreFail.eventBus.published).toHaveLength(0);
    } finally {
      for (const unreg of unregs) unreg();
    }
  });

  it('inside withBatchTransaction on shared meta/data tx, failing at step k after schema/table/view commands publishes 0 events and emits 0 afterRollback schema_operation calls', async () => {
    const unitOfWork = new SharedTestUnitOfWork(true);
    const tableRepo = new InMemoryTableRepository();
    const schemaRepo = new InMemoryTableSchemaRepository();
    const recordRepo = new InMemoryTableRecordRepository();
    const eventBus = new SpyEventBus();
    const sameTxLog: string[] = [];

    class AllEventsProj {
      async handle(
        _ctx: IExecutionContext,
        event: IDomainEvent
      ): Promise<Result<void, DomainError>> {
        sameTxLog.push(event.name.toString());
        return ok(undefined);
      }
    }

    const unregs = [
      registerSameTxProjection(TableCreated as never, AllEventsProj as never, {
        id: 'batch-rollback-tc',
      }),
      registerSameTxProjection(ViewDeleted as never, AllEventsProj as never, {
        id: 'batch-rollback-vd',
      }),
    ];

    try {
      const dispatcher = new SameTxProjectionDispatcher({
        resolve: () => new AllEventsProj(),
        isRegistered: () => true,
      } as never);

      const flow = new TableUpdateFlow(
        tableRepo,
        schemaRepo,
        eventBus,
        unitOfWork,
        new NoopLogger(),
        dispatcher
      );
      const createHandler = new CreateTableHandler(
        tableRepo,
        schemaRepo,
        recordRepo,
        new FieldCreationSideEffectService(flow),
        new ForeignTableLoaderService(tableRepo),
        eventBus,
        unitOfWork,
        createRecordMutationSpecResolver(tableRepo),
        undefined,
        createTableOperationPluginRunner([]),
        undefined,
        undefined,
        dispatcher
      );
      const domainTx = new EventBusDomainWriteTransaction(unitOfWork, eventBus, dispatcher);
      const deleteViewHandler = new DeleteViewHandler(tableRepo, flow, domainTx, {
        capture: vi.fn(() => ok({ id: 'viw' } as never)),
        appendDelete: vi.fn(async () => ok(undefined)),
      } as unknown as ViewUndoRedoService);

      const createCmd = CreateTableCommand.create({
        baseId: baseIdStr,
        name: 'Shared Batch Table',
        fields: [{ type: 'singleLineText', name: 'Title', isPrimary: true }],
        views: [{ type: 'grid' }, { type: 'grid', name: 'View 2' }],
      })._unsafeUnwrap();

      const batchFailRes = await domainTx.withBatchTransaction(
        createContext(),
        async (batchCtx) => {
          return safeTry<void, DomainError>(async function* () {
            const created = yield* await createHandler.handle(batchCtx, createCmd);
            const secondViewId = created.table.views()[1]!.id();
            yield* await deleteViewHandler.handle(
              batchCtx,
              DeleteViewCommand.create({
                tableId: created.table.id().toString(),
                viewId: secondViewId.toString(),
              })._unsafeUnwrap()
            );
            // Mid-batch after earlier commands, nothing should be published yet!
            expect(eventBus.published).toHaveLength(0);

            // Step 3 fails inside a record transaction:
            yield* await domainTx.execute(batchCtx, async () =>
              err(domainError.conflict({ message: 'cas mismatch at k=3' }))
            );
            return ok(undefined);
          });
        }
      );

      expect(batchFailRes.isErr()).toBe(true);
      expect(unitOfWork.beginCount).toBe(1);
      expect(unitOfWork.commitCount).toBe(0);
      expect(unitOfWork.rollbackCount).toBe(1);
      expect(sameTxLog).toEqual(['TableCreated', 'ViewDeleted']);
      // 0 events published to eventBus on rollback
      expect(eventBus.published).toHaveLength(0);
      // 0 out-of-transaction afterRollback schema_operation calls (every provision call occurred inside tx)
      expect(tableRepo.provisionCalls.every((c) => c.hasTx)).toBe(true);
    } finally {
      for (const unreg of unregs) unreg();
    }
  });

  it('Item 5: SameTxProjectionDispatcher fails closed and logs error instead of silently skipping unregistered handlers', async () => {
    class UnregisteredSameTxHandler {
      constructor(private readonly missingDep: unknown) {
        void this.missingDep;
      }
      async handle(): Promise<Result<void, DomainError>> {
        return ok(undefined);
      }
    }

    const errors: Array<{ message: string; context?: unknown }> = [];
    const spyLogger = {
      child: () => spyLogger,
      scope: () => spyLogger,
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (message: string, ctx?: unknown) => errors.push({ message, context: ctx }),
    };

    const resolver = {
      isRegistered: () => false,
      resolve: () => {
        throw new Error('Unregistered handler token');
      },
    };
    const dispatcher = new (SameTxProjectionDispatcher as unknown as new (
      r: unknown,
      l?: unknown
    ) => SameTxProjectionDispatcher)(resolver, spyLogger);

    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');
    const dummyEvent: IDomainEvent = {
      name: DomainEventName.tableCreated(),
      occurredAt: OccurredAt.now(),
    };

    const dispatchRes = await dispatcher.dispatch(createContext(), dummyEvent, [
      { consumerId: 'missing.same_tx', handler: UnregisteredSameTxHandler as never },
    ]);

    expect(dispatchRes.isErr()).toBe(true);
    expect(dispatchRes._unsafeUnwrapErr().code).toBe('projection.same_tx_failed');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('Item 6: sameTxTargetsForEvent never matches unrelated event classes that only share constructor.name', async () => {
    const { sameTxTargetsForEvent } = await import('../projections/SameTxProjection');
    const { DomainEventName } = await import('../../domain/shared/DomainEventName');
    const { OccurredAt } = await import('../../domain/shared/OccurredAt');

    class FakeEventClass {
      readonly name = DomainEventName.tableCreated();
      readonly occurredAt = OccurredAt.now();
    }
    Object.defineProperty(FakeEventClass, 'name', { value: 'TableCreated' });

    class OnlyForRealTableCreated {
      async handle(): Promise<Result<void, DomainError>> {
        return ok(undefined);
      }
    }

    const unregister = registerSameTxProjection(
      TableCreated as never,
      OnlyForRealTableCreated as never,
      { id: 'test-no-name-collision' }
    );
    try {
      const targets = sameTxTargetsForEvent(new FakeEventClass() as IDomainEvent);
      expect(targets.some((t) => t.consumerId === 'test-no-name-collision')).toBe(false);
    } finally {
      unregister();
    }
  });

  it('Item 7 & 12: non-batch TableUpdateFlow executes @SameTxProjectionHandler in data tx strictly once and MemoryEventBus/AsyncMemoryEventBus never double-dispatch it', async () => {
    const { MemoryEventBus } = await import('../../ports/memory/MemoryEventBus');
    const { AsyncMemoryEventBus } = await import('../../ports/memory/AsyncMemoryEventBus');
    const { EventHandler, unregisterEventHandler } = await import('../../ports/EventHandler');

    const executions: Array<{ bus: string; inTx: boolean }> = [];
    let activeBusLabel = 'memory';

    class DualDecoratedProjection {
      async handle(ctx: IExecutionContext): Promise<Result<void, DomainError>> {
        executions.push({ bus: activeBusLabel, inTx: Boolean(ctx.transaction) });
        return ok(undefined);
      }
    }
    // Simulate a handler carrying both @ProjectionHandler/@EventHandler and @SameTxProjectionHandler
    EventHandler(FieldDeleted as never, { role: 'projection' })(DualDecoratedProjection as never);
    const unregister = registerSameTxProjection(
      FieldDeleted as never,
      DualDecoratedProjection as never,
      { id: 'test-single-dispatch-guard' }
    );

    try {
      const makeResolver = () => ({
        isRegistered: () => true,
        resolve: () => new DualDecoratedProjection(),
      });

      const runWithBus = async (busLabel: string, eventBus: IEventBus) => {
        activeBusLabel = busLabel;
        const unitOfWork = new SharedTestUnitOfWork(false);
        const tableRepo = new InMemoryTableRepository();
        const schemaRepo = new InMemoryTableSchemaRepository();
        const dispatcher = new SameTxProjectionDispatcher(makeResolver() as never);
        const flow = new TableUpdateFlow(
          tableRepo,
          schemaRepo,
          eventBus,
          unitOfWork,
          new NoopLogger(),
          dispatcher
        );
        const { table, secondaryFieldId } = buildTwoFieldTwoViewTable('x');
        await tableRepo.insert(createContext(), table);

        const res = await flow.execute(createContext(), { table }, (t) =>
          t.update((m) => m.removeField(secondaryFieldId))
        );
        expect(res.isOk(), res.isErr() ? res.error.message : '').toBe(true);
      };

      await runWithBus('MemoryEventBus', new MemoryEventBus(makeResolver() as never));
      const asyncBus = new AsyncMemoryEventBus(makeResolver() as never);
      await runWithBus('AsyncMemoryEventBus', asyncBus);
      await asyncBus.settled();

      expect(executions).toEqual([
        { bus: 'MemoryEventBus', inTx: true },
        { bus: 'AsyncMemoryEventBus', inTx: true },
      ]);
    } finally {
      unregister();
      unregisterEventHandler(FieldDeleted as never, DualDecoratedProjection as never);
    }
  });
});
