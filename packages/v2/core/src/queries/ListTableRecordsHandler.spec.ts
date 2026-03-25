import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { RecordId } from '../domain/table/records/RecordId';
import { NoopRecordConditionSpecVisitor } from '../domain/table/records/specs/visitors/NoopRecordConditionSpecVisitor';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRepository } from '../ports/TableRepository';
import { ListTableRecordsHandler } from './ListTableRecordsHandler';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';

const createContext = (): IExecutionContext => {
  const actorId = ActorId.create('system')._unsafeUnwrap();
  return { actorId };
};

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const createTableId = (seed: string) => TableId.create(`tbl${seed.repeat(16)}`)._unsafeUnwrap();
const createRecordId = (seed: string) => RecordId.create(`rec${seed.repeat(16)}`)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withName(TableName.create('Records')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([selectOption('Open')])
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildHostTableReferencing = (
  foreignTable: Table,
  relationship: 'manyMany' | 'oneMany' = 'oneMany'
) => {
  const builder = Table.builder()
    .withBaseId(foreignTable.baseId())
    .withName(TableName.create('Host Records')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Host Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withName(FieldName.create('Incoming Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        baseId: foreignTable.baseId().toString(),
        relationship,
        foreignTableId: foreignTable.id().toString(),
        lookupFieldId: foreignTable.primaryFieldId().toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class RecordingSpecVisitor extends NoopRecordConditionSpecVisitor {
  readonly visited: string[] = [];

  override visitIncomingLinkSelected(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitIncomingLinkSelected']>
  ) {
    this.visited.push('incomingLinkSelected');
    return super.visitIncomingLinkSelected(...args);
  }

  override visitIncomingLinkCandidate(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitIncomingLinkCandidate']>
  ) {
    this.visited.push('incomingLinkCandidate');
    return super.visitIncomingLinkCandidate(...args);
  }

  override visitRecordByIds(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitRecordByIds']>
  ) {
    this.visited.push(`recordByIds:${args[0].recordIds().length}`);
    return super.visitRecordByIds(...args);
  }
}

describe('ListTableRecordsHandler', () => {
  it('returns records without a filter', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        const records: TableRecordReadModel[] = [
          { id: 'rec1', fields: { Title: 'Hello' }, version: 1 },
        ];
        return ok({ records, total: 1 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.records.length).toBe(1);
    expect(payload.total).toBe(1);
    expect(captured.spec).toBeUndefined();
  });

  it('passes filter specs to the query repository', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      filter: {
        fieldId: titleField.id().toString(),
        operator: 'contains',
        value: 'Hello',
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();
  });

  it('drops filters for disabled fields from the permission read source', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      filter: {
        fieldId: statusField.id().toString(),
        operator: 'is',
        value: 'Open',
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(
      {
        ...createContext(),
        recordReadQuerySource: {
          enabledFieldIds: [],
        },
      } as IExecutionContext,
      queryResult._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeUndefined();
  });

  it('maps missing tables to not found', async () => {
    const tableRepo: ITableRepository = {
      insert: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
      insertMany: async (_context, _tables) => err(domainError.notFound({ message: 'Not found' })),
      findOne: async (_context, _spec) => err(domainError.notFound({ message: 'Not found' })),
      find: async (_context, _spec, _options) =>
        err(domainError.notFound({ message: 'Not found' })),
      updateOne: async (_context, _table, _spec) =>
        err(domainError.notFound({ message: 'Not found' })),
      restore: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
      delete: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
    };

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => ok({ records: [], total: 0 }),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: createTableId('b').toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepo, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('Table not found');
  });

  it('returns filter build errors', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => ok({ records: [], total: 0 }),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      filter: {
        fieldId: 'fldmissing123456789',
        operator: 'is',
        value: 'x',
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toContain('Filter field not found');
  });

  it('propagates query repository errors', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => err(domainError.unexpected({ message: 'query failed' })),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });

  it('builds incoming link candidate specs inside the handler', async () => {
    const table = buildTable();
    const hostTable = buildHostTableReferencing(table, 'oneMany');
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    await tableRepository.insert(createContext(), hostTable);
    const hostLinkField = hostTable
      .getField((field) => field.name().toString() === 'Incoming Link')
      ._unsafeUnwrap();

    const captured: { spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellCandidate: [hostLinkField.id().toString(), createRecordId('c').toString()],
      selectedRecordIds: [createRecordId('d').toString()],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();

    const visitor = new RecordingSpecVisitor();
    const acceptResult = (
      captured.spec as {
        accept: (visitor: RecordingSpecVisitor) => ReturnType<RecordingSpecVisitor['visit']>;
      }
    ).accept(visitor);
    expect(acceptResult.isOk()).toBe(true);
    expect(visitor.visited).toContain('incomingLinkCandidate');
    expect(visitor.visited).toContain('recordByIds:1');
  });

  it('passes ordered selected ids to the repository for incoming link selections', async () => {
    const table = buildTable();
    const hostTable = buildHostTableReferencing(table, 'manyMany');
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    await tableRepository.insert(createContext(), hostTable);
    const hostLinkField = hostTable
      .getField((field) => field.name().toString() === 'Incoming Link')
      ._unsafeUnwrap();
    const hostRecordId = createRecordId('e');
    const orderedIds = [createRecordId('f'), createRecordId('g')];
    const captured: { spec?: unknown; options?: unknown } = {};

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec, options) => {
        captured.spec = spec;
        captured.options = options;
        return ok({ records: [], total: 0 });
      },
      findOne: async (_context, tableArg, recordIdArg) => {
        expect(tableArg.id().equals(hostTable.id())).toBe(true);
        expect(recordIdArg.equals(hostRecordId)).toBe(true);
        return ok({
          id: hostRecordId.toString(),
          version: 1,
          fields: {
            [hostLinkField.id().toString()]: orderedIds.map((recordId) => ({
              id: recordId.toString(),
            })),
          },
        });
      },
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellSelected: [hostLinkField.id().toString(), hostRecordId.toString()],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(
      (
        captured.options as {
          recordIdsOrder?: ReadonlyArray<RecordId>;
          orderBy?: unknown;
        }
      ).recordIdsOrder?.map((recordId) => recordId.toString())
    ).toEqual(orderedIds.map((recordId) => recordId.toString()));
    expect((captured.options as { orderBy?: unknown }).orderBy).toBeUndefined();

    const visitor = new RecordingSpecVisitor();
    const acceptResult = (
      captured.spec as {
        accept: (visitor: RecordingSpecVisitor) => ReturnType<RecordingSpecVisitor['visit']>;
      }
    ).accept(visitor);
    expect(acceptResult.isOk()).toBe(true);
    expect(visitor.visited).toContain('recordByIds:2');
  });

  it('keeps view row order as the stable fallback even when ignoreViewQuery is true', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const viewId = table.views()[0]?.id().toString();
    const captured: { options?: unknown } = {};

    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.options = options;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId,
      ignoreViewQuery: true,
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect((captured.options as { orderBy?: Array<{ column?: string }> }).orderBy).toEqual([
      {
        column: `__row_${viewId}`,
        direction: 'asc',
      },
    ]);
  });
});
