import { err, ok } from 'neverthrow';
import type { Result } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import type {
  TableCreationServiceInput,
  TableCreationServiceResult,
} from '../application/services/TableCreationService';
import { ActorId } from '../domain/shared/ActorId';
import type { DomainError } from '../domain/shared/DomainError';
import type { IDomainEvent } from '../domain/shared/DomainEvent';
import type { Table } from '../domain/table/Table';
import type {
  DotTeaStructure,
  IDotTeaParser,
  NormalizedDotTeaStructure,
} from '../ports/DotTeaParser';
import type { IEventBus } from '../ports/EventBus';
import type { IExecutionContext, IUnitOfWorkTransaction } from '../ports/ExecutionContext';
import type { IUnitOfWork, UnitOfWorkOperation } from '../ports/UnitOfWork';
import { ImportDotTeaStructureCommand } from './ImportDotTeaStructureCommand';
import { ImportDotTeaStructureHandler } from './ImportDotTeaStructureHandler';

const baseId = `bse${'d'.repeat(16)}`;

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

class FakeDotTeaParser implements IDotTeaParser {
  constructor(private readonly normalized: Result<NormalizedDotTeaStructure, DomainError>) {}

  async parseStructure(): Promise<Result<DotTeaStructure, DomainError>> {
    return err({
      code: 'not_implemented',
      message: 'not implemented',
      tags: ['not-implemented'],
      toString: () => 'not implemented',
    });
  }

  async parseNormalizedStructure(): Promise<Result<NormalizedDotTeaStructure, DomainError>> {
    return this.normalized;
  }
}

class FakeForeignTableLoaderService {
  async load() {
    return ok([]);
  }
}

class FakeTableCreationService {
  lastInput: TableCreationServiceInput | undefined;

  async execute(
    _: IExecutionContext,
    input: TableCreationServiceInput
  ): Promise<Result<TableCreationServiceResult, DomainError>> {
    this.lastInput = input;
    const tableState = new Map<string, Table>();
    for (const table of input.tables) {
      tableState.set(table.id().toString(), table);
    }
    return ok({
      persistedTables: input.tables,
      tableState,
      sideEffectEvents: [],
    });
  }
}

class FakeEventBus implements IEventBus {
  published: IDomainEvent[] = [];

  async publish(_: IExecutionContext, event: IDomainEvent) {
    this.published.push(event);
    return ok(undefined);
  }

  async publishMany(_: IExecutionContext, events: ReadonlyArray<IDomainEvent>) {
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

describe('ImportDotTeaStructureHandler', () => {
  it('returns error when dottea has no tables', async () => {
    const parser = new FakeDotTeaParser(ok({ tables: [] }));
    const handler = new ImportDotTeaStructureHandler(
      parser,
      new FakeForeignTableLoaderService() as never,
      new FakeTableCreationService() as never,
      new FakeEventBus(),
      new FakeUnitOfWork()
    );

    const command = ImportDotTeaStructureCommand.createFromBuffer({
      baseId,
      dotTeaData: new Uint8Array([1]),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('dottea.no_tables');
  });

  it('imports tables and publishes events', async () => {
    const tableId = `tbl${'t'.repeat(16)}`;
    const fieldId = `fld${'f'.repeat(16)}`;

    const parser = new FakeDotTeaParser(
      ok({
        tables: [
          {
            id: tableId,
            name: 'Products',
            fields: [
              {
                id: fieldId,
                name: 'Name',
                type: 'singleLineText',
                isPrimary: true,
              },
            ],
            views: [{ type: 'grid', name: 'Grid' }],
          },
        ],
      })
    );

    const tableCreationService = new FakeTableCreationService();
    const eventBus = new FakeEventBus();

    const handler = new ImportDotTeaStructureHandler(
      parser,
      new FakeForeignTableLoaderService() as never,
      tableCreationService as never,
      eventBus,
      new FakeUnitOfWork()
    );

    const command = ImportDotTeaStructureCommand.createFromBuffer({
      baseId,
      dotTeaData: new Uint8Array([1]),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), command);
    expect(result.isOk()).toBe(true);

    const value = result._unsafeUnwrap();
    expect(value.tables).toHaveLength(1);
    expect(value.tables[0]?.id).toBe(tableId);
    expect(value.tables[0]?.name).toBe('Products');
    expect(eventBus.published.length).toBeGreaterThan(0);
    expect(tableCreationService.lastInput?.tables).toHaveLength(1);
  });
});
