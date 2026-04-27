import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { DbFieldName } from '../domain/table/fields/DbFieldName';
import { FieldKeyType } from '../domain/table/fields/FieldKeyType';
import { FieldName } from '../domain/table/fields/FieldName';
import type { LinkFieldConfigValue } from '../domain/table/fields/types/LinkFieldConfig';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { RecordId } from '../domain/table/records/RecordId';
import { NoopRecordConditionSpecVisitor } from '../domain/table/records/specs/visitors/NoopRecordConditionSpecVisitor';
import type { UserConditionSpec } from '../domain/table/records/specs/UserConditionSpec';
import { TableUpdateViewColumnMetaSpec } from '../domain/table/specs/TableUpdateViewColumnMetaSpec';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewColumnMeta } from '../domain/table/views/ViewColumnMeta';
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
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

const buildUserFilterTable = () => {
  const builder = Table.builder()
    .withBaseId(createBaseId('u'))
    .withName(TableName.create('User Filter Records')._unsafeUnwrap());
  builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
  builder.field().user().withName(FieldName.create('Assignee')._unsafeUnwrap()).done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const buildHostTableReferencing = (
  foreignTable: Table,
  relationship: 'manyMany' | 'oneMany' = 'oneMany',
  extraConfig?: Partial<Pick<LinkFieldConfigValue, 'filter' | 'filterByViewId'>>
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
        ...extraConfig,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

class RecordingSpecVisitor extends NoopRecordConditionSpecVisitor {
  readonly visited: string[] = [];
  readonly incomingLinkSelectedModes: string[] = [];
  readonly incomingLinkCandidateModes: string[] = [];
  readonly userValues: unknown[] = [];

  override visitIncomingLinkSelected(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitIncomingLinkSelected']>
  ) {
    this.visited.push('incomingLinkSelected');
    this.incomingLinkSelectedModes.push(args[0].mode());
    return super.visitIncomingLinkSelected(...args);
  }

  override visitIncomingLinkCandidate(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitIncomingLinkCandidate']>
  ) {
    this.visited.push('incomingLinkCandidate');
    this.incomingLinkCandidateModes.push(args[0].mode());
    return super.visitIncomingLinkCandidate(...args);
  }

  override visitRecordByIds(
    ...args: Parameters<NoopRecordConditionSpecVisitor['visitRecordByIds']>
  ) {
    this.visited.push(`recordByIds:${args[0].recordIds().length}`);
    return super.visitRecordByIds(...args);
  }

  override visitUserIs(spec: UserConditionSpec) {
    this.visited.push('userIs');
    const value = spec.value();
    this.userValues.push(value && 'toValue' in value ? value.toValue() : value);
    return super.visitUserIs(spec);
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

  it('replaces Me in view filters with the current actor id', async () => {
    const table = buildUserFilterTable();
    const assigneeField = table
      .getField((field) => field.name().toString() === 'Assignee')
      ._unsafeUnwrap();
    const view = table.views()[0]!;
    const tableWithViewFilter = TableUpdateViewQueryDefaultsSpec.create([
      {
        viewId: view.id(),
        queryDefaults: ViewQueryDefaults.create({
          filter: {
            conjunction: 'and',
            items: [
              {
                fieldId: assigneeField.id().toString(),
                operator: 'is',
                value: 'Me',
              },
            ],
          },
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();
    const tableRepository = new MemoryTableRepository();
    const context = createContext();
    await tableRepository.insert(context, tableWithViewFilter);

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
      viewId: view.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(context, queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    const visitor = new RecordingSpecVisitor();
    const acceptResult = (
      captured.spec as {
        accept: (visitor: RecordingSpecVisitor) => ReturnType<RecordingSpecVisitor['visit']>;
      }
    ).accept(visitor);
    expect(acceptResult.isOk()).toBe(true);
    expect(visitor.userValues).toEqual([context.actorId.toString()]);
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

  it('builds incoming link selected specs when only the link field is provided', async () => {
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
      filterLinkCellSelected: hostLinkField.id().toString(),
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
    expect(visitor.incomingLinkSelectedModes).toEqual(['hostReferenceExists']);
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

  it('skips candidate specs for many-many incoming links when no other query constraints exist', async () => {
    const table = buildTable();
    const hostTable = buildHostTableReferencing(table, 'manyMany');
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
      filterLinkCellCandidate: [hostLinkField.id().toString(), createRecordId('h').toString()],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeUndefined();
  });

  it('merges view defaults filter and sort with query filter and sort', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const view = table.views()[0]!;
    const tableWithDefaults = TableUpdateViewQueryDefaultsSpec.create([
      {
        viewId: view.id(),
        queryDefaults: ViewQueryDefaults.create({
          filter: {
            fieldId: statusField.id().toString(),
            operator: 'is',
            value: 'Open',
          },
          sort: [{ fieldId: statusField.id().toString(), order: 'asc' }],
          manualSort: false,
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();
    await tableRepository.insert(createContext(), tableWithDefaults);

    const captured: { spec?: unknown; options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec, options) => {
        captured.spec = spec;
        captured.options = options;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: tableWithDefaults.id().toString(),
      viewId: view.id().toString(),
      filter: {
        fieldId: titleField.id().toString(),
        operator: 'contains',
        value: 'Hello',
      },
      sort: [{ fieldId: titleField.id().toString(), order: 'desc' }],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();
    const normalizedOrderBy = (
      (
        captured.options as {
          orderBy?: Array<{
            fieldId?: { toString: () => string };
            direction?: string;
            column?: string;
          }>;
        }
      ).orderBy ?? []
    ).map((item) => ({
      fieldId: item.fieldId?.toString(),
      direction: item.direction,
      column: item.column,
    }));
    expect(normalizedOrderBy).toEqual([
      {
        fieldId: titleField.id().toString(),
        direction: 'desc',
      },
      {
        fieldId: statusField.id().toString(),
        direction: 'asc',
      },
      {
        column: '__auto_number',
        direction: 'asc',
      },
    ]);
  });

  it('drops disabled sort fields and limits visible-row search to enabled fields', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

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
      sort: [
        { fieldId: statusField.id().toString(), order: 'asc' },
        { fieldId: titleField.id().toString(), order: 'desc' },
      ],
      search: ['hello', '', true],
      fieldKeyType: FieldKeyType.Id,
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(
      {
        ...createContext(),
        recordReadQuerySource: {
          enabledFieldIds: [titleField.id().toString()],
        },
      } as IExecutionContext,
      queryResult._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    const options = captured.options as {
      orderBy?: Array<{ fieldId?: string; direction?: string; column?: string }>;
      search?: {
        visibleFieldIds?: Array<{ toString: () => string }>;
        search?: { value?: string; hideNotMatchRow?: boolean };
      };
    };
    const normalizedOrderBy = (options.orderBy ?? []).map((item) => ({
      fieldId: item.fieldId?.toString?.(),
      direction: item.direction,
      column: item.column,
    }));
    expect(normalizedOrderBy).toEqual([
      {
        fieldId: titleField.id().toString(),
        direction: 'desc',
      },
      {
        column: '__auto_number',
        direction: 'asc',
      },
    ]);
    expect(options.search?.visibleFieldIds?.map((fieldId) => fieldId.toString())).toEqual([
      titleField.id().toString(),
    ]);
    expect(options.search?.search?.value).toBe('hello');
    expect(options.search?.search?.hideNotMatchRow).toBe(true);
  });

  it('passes pagination to the repository and returns the same offset and limit', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.options = options;
        return ok({ records: [{ id: 'rec1', fields: {}, version: 1 }], total: 23 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      limit: 5,
      offset: 10,
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(payload.total).toBe(23);
    expect(payload.offset).toBe(10);
    expect(payload.limit).toBe(5);
    expect(
      (
        captured.options as {
          pagination?: {
            offset: () => { toNumber: () => number };
            limit: () => { toNumber: () => number };
          };
        }
      ).pagination
        ?.offset()
        .toNumber()
    ).toBe(10);
    expect(
      (
        captured.options as {
          pagination?: {
            offset: () => { toNumber: () => number };
            limit: () => { toNumber: () => number };
          };
        }
      ).pagination
        ?.limit()
        .toNumber()
    ).toBe(5);
  });

  it('returns invalid selected record id errors before querying records', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      selectedRecordIds: ['invalid-record-id'],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain('Invalid RecordId');
    expect(findCalled).toBe(false);
  });

  it('limits visible-row search to visible fields in the view', async () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const view = table.views()[0]!;
    const tableWithHiddenStatus = TableUpdateViewColumnMetaSpec.create([
      {
        viewId: view.id(),
        fieldId: statusField.id(),
        columnMeta: ViewColumnMeta.create({
          ...view.columnMeta()._unsafeUnwrap().toDto(),
          [statusField.id().toString()]: {
            ...(view.columnMeta()._unsafeUnwrap().toDto()[statusField.id().toString()] ?? {}),
            hidden: true,
          },
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), tableWithHiddenStatus);

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
      tableId: tableWithHiddenStatus.id().toString(),
      viewId: view.id().toString(),
      search: ['hello', `${statusField.name().toString()},${titleField.name().toString()}`, true],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(
      (
        captured.options as {
          search?: { visibleFieldIds?: Array<{ toString: () => string }> };
        }
      ).search?.visibleFieldIds?.map((fieldId) => fieldId.toString())
    ).toEqual([titleField.id().toString()]);
  });

  it('resolves named field keys for filter and sort, then transforms response keys back to names', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

    const captured: { spec?: unknown; options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec, options) => {
        captured.spec = spec;
        captured.options = options;
        return ok({
          records: [
            {
              id: 'rec1',
              version: 1,
              fields: {
                [titleField.id().toString()]: 'Hello',
                [statusField.id().toString()]: 'Open',
              },
            },
          ],
          total: 1,
        });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      fieldKeyType: FieldKeyType.Name,
      filter: {
        fieldId: 'Status',
        operator: 'is',
        value: 'Open',
      },
      sort: [{ fieldId: 'Title', order: 'desc' }],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(captured.spec).toBeDefined();
    expect(
      (
        captured.options as {
          orderBy?: Array<{
            fieldId?: { toString: () => string };
            direction?: string;
            column?: string;
          }>;
        }
      ).orderBy?.map((item) => ({
        fieldId: item.fieldId?.toString(),
        direction: item.direction,
        column: item.column,
      }))
    ).toEqual([
      {
        fieldId: titleField.id().toString(),
        direction: 'desc',
      },
      {
        column: '__auto_number',
        direction: 'asc',
      },
    ]);
    expect(payload.records).toEqual([
      {
        id: 'rec1',
        version: 1,
        fields: {
          Title: 'Hello',
          Status: 'Open',
        },
      },
    ]);
  });

  it('keeps enabled conditions when disabled fields are sanitized out of filter groups', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
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
        conjunction: 'and',
        items: [
          {
            fieldId: statusField.id().toString(),
            operator: 'is',
            value: 'Open',
          },
          {
            not: {
              fieldId: titleField.id().toString(),
              operator: 'contains',
              value: 'archived',
            },
          },
        ],
      },
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(
      {
        ...createContext(),
        recordReadQuerySource: {
          enabledFieldIds: [titleField.id().toString()],
        },
      } as IExecutionContext,
      queryResult._unsafeUnwrap()
    );

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();
  });

  it('resolves dbFieldName keys for filter and sort, then transforms response keys back to dbFieldName', async () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    titleField.setDbFieldName(DbFieldName.rehydrate('title_col')._unsafeUnwrap())._unsafeUnwrap();
    statusField.setDbFieldName(DbFieldName.rehydrate('status_col')._unsafeUnwrap())._unsafeUnwrap();

    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { options?: unknown; spec?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec, options) => {
        captured.spec = spec;
        captured.options = options;
        return ok({
          records: [
            {
              id: 'rec1',
              version: 1,
              fields: {
                [titleField.id().toString()]: 'Hello',
                [statusField.id().toString()]: 'Open',
              },
            },
          ],
          total: 1,
        });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      fieldKeyType: FieldKeyType.DbFieldName,
      filter: {
        fieldId: 'status_col',
        operator: 'is',
        value: 'Open',
      },
      sort: [{ fieldId: 'title_col', order: 'asc' }],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());
    const payload = result._unsafeUnwrap();

    expect(captured.spec).toBeDefined();
    expect(
      (
        captured.options as {
          orderBy?: Array<{
            fieldId?: { toString: () => string };
            direction?: string;
            column?: string;
          }>;
        }
      ).orderBy?.map((item) => ({
        fieldId: item.fieldId?.toString(),
        direction: item.direction,
        column: item.column,
      }))
    ).toEqual([
      {
        fieldId: titleField.id().toString(),
        direction: 'asc',
      },
      {
        column: '__auto_number',
        direction: 'asc',
      },
    ]);
    expect(payload.records).toEqual([
      {
        id: 'rec1',
        version: 1,
        fields: {
          title_col: 'Hello',
          status_col: 'Open',
        },
      },
    ]);
  });

  // T3109: link field filter/filterByViewId must be applied in v2 candidate queries
  // (mirrors v1 getFormLinkRecords behaviour for share-form link picker)
  it('applies link field custom filter to candidate query (T3109)', async () => {
    const table = buildTable();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    // manyMany → no candidateSpec; without the fix, spec would be undefined entirely
    // filter uses the v1 IFilter format: { conjunction, filterSet: [...items] }
    const hostTable = buildHostTableReferencing(table, 'manyMany', {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: statusField.id().toString(),
            operator: 'is',
            value: 'Open',
          },
        ],
      } as unknown as LinkFieldConfigValue['filter'],
    });
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
      filterLinkCellCandidate: hostLinkField.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    // The link field's custom filter must produce a spec even though manyMany has no candidateSpec
    expect(captured.spec).toBeDefined();
  });

  it('applies filterByViewId from link field as effective view when no viewId in query (T3109)', async () => {
    const table = buildTable();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const view = table.views()[0]!;
    // Give the view a default filter — the handler should pick it up via filterByViewId
    const tableWithDefaults = TableUpdateViewQueryDefaultsSpec.create([
      {
        viewId: view.id(),
        queryDefaults: ViewQueryDefaults.create({
          filter: {
            fieldId: statusField.id().toString(),
            operator: 'is',
            value: 'Open',
          },
          sort: [],
          manualSort: false,
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();

    const hostTable = buildHostTableReferencing(table, 'manyMany', {
      filterByViewId: view.id().toString(),
    });
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), tableWithDefaults);
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
      tableId: tableWithDefaults.id().toString(),
      fieldKeyType: FieldKeyType.Id,
      filterLinkCellCandidate: hostLinkField.id().toString(),
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    // The view's default filter should be applied via filterByViewId
    expect(captured.spec).toBeDefined();
  });

  it('passes an explicit empty visible-field list when the view hides every searchable field', async () => {
    const table = buildTable();
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const view = table.views()[0]!;
    const baseMeta = view.columnMeta()._unsafeUnwrap().toDto();
    const tableWithHiddenFields = TableUpdateViewColumnMetaSpec.create([
      {
        viewId: view.id(),
        fieldId: titleField.id(),
        columnMeta: ViewColumnMeta.create({
          ...baseMeta,
          [titleField.id().toString()]: {
            ...(baseMeta[titleField.id().toString()] ?? {}),
            hidden: true,
          },
          [statusField.id().toString()]: {
            ...(baseMeta[statusField.id().toString()] ?? {}),
            hidden: true,
          },
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), tableWithHiddenFields);

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
      tableId: tableWithHiddenFields.id().toString(),
      viewId: view.id().toString(),
      search: ['hello', '', true],
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(
      (captured.options as { search?: { visibleFieldIds?: unknown[] } }).search?.visibleFieldIds
    ).toEqual([]);
  });
});
