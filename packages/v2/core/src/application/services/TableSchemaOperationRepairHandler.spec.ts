import { ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../../domain/base/BaseId';
import { ActorId } from '../../domain/shared/ActorId';
import type { DomainError } from '../../domain/shared/DomainError';
import { FieldName } from '../../domain/table/fields/FieldName';
import type { Table } from '../../domain/table/Table';
import { Table as TableAggregate } from '../../domain/table/Table';
import { TableId } from '../../domain/table/TableId';
import { TableName } from '../../domain/table/TableName';
import type { IExecutionContext } from '../../ports/ExecutionContext';
import type { SchemaOperationRecord } from '../../ports/SchemaOperationRepository';
import type {
  ITableRepository,
  TableProvisionOperationOptions,
  TableProvisionState,
} from '../../ports/TableRepository';
import type { ITableSchemaRepository } from '../../ports/TableSchemaRepository';
import type { IUnitOfWork, IUnitOfWorkOptions, UnitOfWorkOperation } from '../../ports/UnitOfWork';
import { TableSchemaOperationRepairHandler } from './TableSchemaOperationRepairHandler';

const context = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
  requestId: 'repair-run',
});

const createTable = (seed: string, name: string): Table => {
  const baseId = BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
  const tableId = TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
  const builder = TableAggregate.builder()
    .withBaseId(baseId)
    .withId(tableId)
    .withName(TableName.create(name)._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Name')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const operation = (
  table: Table,
  overrides: Partial<SchemaOperationRecord> = {}
): SchemaOperationRecord => ({
  id: 'sgoRepair00000001',
  type: 'table.create',
  status: 'error',
  phase: 'error',
  target: {
    resourceType: 'table',
    resourceId: table.id().toString(),
    baseId: table.baseId().toString(),
    tableId: table.id().toString(),
  },
  payload: {
    tableId: table.id().toString(),
    recordCount: 0,
  },
  idempotencyKey: `repair-op:table:${table.id().toString()}`,
  attempts: 1,
  maxAttempts: 8,
  nextRunAt: new Date('2026-04-28T00:00:00.000Z'),
  lockedAt: null,
  lockedBy: null,
  lastError: 'data phase failed',
  createdTime: new Date('2026-04-28T00:00:00.000Z'),
  createdBy: 'system',
  lastModifiedTime: null,
  lastModifiedBy: null,
  ...overrides,
});

class FakeUnitOfWork implements IUnitOfWork {
  readonly scopes: Array<IUnitOfWorkOptions['scope']> = [];

  async withTransaction<T>(
    context: IExecutionContext,
    work: UnitOfWorkOperation<T>,
    options?: IUnitOfWorkOptions
  ): Promise<Result<T, DomainError>> {
    this.scopes.push(options?.scope);
    return work(context);
  }
}

class FakeTableRepository implements Partial<ITableRepository> {
  readonly setProvisionState = vi.fn(
    async (
      _: IExecutionContext,
      __: Table,
      ___: TableProvisionState,
      ____?: TableProvisionOperationOptions
    ) => ok(undefined)
  );

  readonly setProvisionStateMany = vi.fn(
    async (
      _: IExecutionContext,
      __: ReadonlyArray<Table>,
      ___: TableProvisionState,
      ____?: TableProvisionOperationOptions
    ) => ok(undefined)
  );

  constructor(private readonly tables: ReadonlyArray<Table>) {}

  async find(
    _: IExecutionContext,
    spec: { isSatisfiedBy(table: Table): boolean }
  ): Promise<Result<ReadonlyArray<Table>, DomainError>> {
    return ok(this.tables.filter((table) => spec.isSatisfiedBy(table)));
  }
}

const createHandler = (tables: ReadonlyArray<Table>) => {
  const unitOfWork = new FakeUnitOfWork();
  const tableRepository = new FakeTableRepository(tables);
  const tableSchemaRepository = {
    ensureInsertedMany: vi.fn(async () => ok(undefined)),
  } as unknown as ITableSchemaRepository;
  const fieldCreationSideEffectService = {
    execute: vi.fn(
      async (_: IExecutionContext, input: { tableState?: ReadonlyMap<string, Table> }) =>
        ok({ events: [], tableState: input.tableState ?? new Map() })
    ),
  };
  const foreignTableLoaderService = {
    load: vi.fn(async () => ok([])),
  };
  const handler = new TableSchemaOperationRepairHandler(
    tableRepository as unknown as ITableRepository,
    tableSchemaRepository,
    fieldCreationSideEffectService as never,
    foreignTableLoaderService as never,
    unitOfWork
  );

  return {
    handler,
    unitOfWork,
    tableRepository,
    tableSchemaRepository,
    fieldCreationSideEffectService,
    foreignTableLoaderService,
  };
};

describe('TableSchemaOperationRepairHandler', () => {
  it('repairs a schema-only table create operation and completes the same operation key', async () => {
    const table = createTable('a', 'Repair Create');
    const { handler, tableRepository, tableSchemaRepository, fieldCreationSideEffectService } =
      createHandler([table]);

    const result = await handler.run(context(), operation(table));

    expect(result._unsafeUnwrap()).toEqual({
      result: {
        repaired: 'table_schema',
        tableIds: [table.id().toString()],
      },
    });
    expect(tableSchemaRepository.ensureInsertedMany).toHaveBeenCalledWith(expect.any(Object), [
      table,
    ]);
    expect(fieldCreationSideEffectService.execute).toHaveBeenCalledOnce();
    expect(tableRepository.setProvisionState).toHaveBeenCalledWith(
      expect.any(Object),
      table,
      'ready',
      expect.objectContaining({
        idempotencyKey: `repair-op:table:${table.id().toString()}`,
        operationType: 'table.create',
      })
    );
  });

  it('refuses to repair create operations that need record replay', async () => {
    const table = createTable('b', 'Repair Records');
    const { handler, tableSchemaRepository } = createHandler([table]);

    const result = await handler.run(
      context(),
      operation(table, {
        payload: {
          tableId: table.id().toString(),
          recordCount: 1,
        },
      })
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'schema_operation.repair_not_supported',
    });
    expect(tableSchemaRepository.ensureInsertedMany).not.toHaveBeenCalled();
  });

  it('repairs a structure-only DotTea import batch and derives the original operation id', async () => {
    const tableA = createTable('c', 'Import A');
    const tableB = createTable('d', 'Import B');
    const { handler, tableRepository, tableSchemaRepository, fieldCreationSideEffectService } =
      createHandler([tableA, tableB]);

    const result = await handler.run(
      context(),
      operation(tableA, {
        type: 'table.import',
        payload: {
          source: 'dottea',
          tableIds: [tableA.id().toString(), tableB.id().toString()],
          recordCountByTableId: {
            [tableA.id().toString()]: 0,
            [tableB.id().toString()]: 0,
          },
        },
        idempotencyKey: `import-op:table:${tableA.id().toString()}`,
      })
    );

    expect(result._unsafeUnwrap().result).toEqual({
      repaired: 'table_schema',
      tableIds: [tableA.id().toString(), tableB.id().toString()],
    });
    expect(tableSchemaRepository.ensureInsertedMany).toHaveBeenCalledWith(expect.any(Object), [
      tableA,
      tableB,
    ]);
    expect(fieldCreationSideEffectService.execute).toHaveBeenCalledTimes(2);
    expect(tableRepository.setProvisionStateMany).toHaveBeenCalledWith(
      expect.any(Object),
      [tableA, tableB],
      'ready',
      expect.objectContaining({
        operationId: 'import-op',
        operationType: 'table.import',
      })
    );
  });

  it('does not claim CSV import as automatically repairable', async () => {
    const table = createTable('e', 'CSV Import');
    const { handler, tableSchemaRepository } = createHandler([table]);

    const result = await handler.run(
      context(),
      operation(table, {
        type: 'table.import',
        payload: {
          source: 'csv',
          tableId: table.id().toString(),
          recordCount: 0,
        },
      })
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'schema_operation.repair_not_supported',
    });
    expect(tableSchemaRepository.ensureInsertedMany).not.toHaveBeenCalled();
  });
});
