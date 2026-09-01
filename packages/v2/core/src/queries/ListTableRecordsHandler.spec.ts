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
import type { UserConditionSpec } from '../domain/table/records/specs/UserConditionSpec';
import { NoopRecordConditionSpecVisitor } from '../domain/table/records/specs/visitors/NoopRecordConditionSpecVisitor';
import { TableRecord } from '../domain/table/records/TableRecord';
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
import type {
  ITableQueryObservability,
  TableQueryObservabilityEvent,
  TableQuerySearchValidationEvent,
} from '../ports/TableQueryObservability';
import type {
  ITableRecordQueryRepository,
  ITableRecordQueryResult,
} from '../ports/TableRecordQueryRepository';
import type { TableRecordReadModel } from '../ports/TableRecordReadModel';
import type { ITableRepository } from '../ports/TableRepository';
import { ListTableRecordsHandler } from './ListTableRecordsHandler';
import { ListTableRecordsQuery } from './ListTableRecordsQuery';
import { buildRecordConditionSpec } from './RecordFilterMapper';

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

    const captured: { spec?: unknown; options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec, options) => {
        captured.spec = spec;
        captured.options = options;
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
    expect(
      (
        captured.options as {
          projectionFieldIds?: unknown;
          includeTotal?: boolean;
        }
      ).projectionFieldIds
    ).toBeUndefined();
    expect((captured.options as { includeTotal?: boolean }).includeTotal).toBe(false);
  });

  it('passes empty projection and includeTotal false to the query repository', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.options = options;
        return ok({
          records: [{ id: 'rec1', fields: {}, version: 1 }],
          total: 1,
        });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create({
      tableId: table.id().toString(),
      fieldKeyType: FieldKeyType.Id,
      projection: [],
      includeTotal: false,
    });
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result.isOk()).toBe(true);
    expect(
      (
        captured.options as {
          projectionFieldIds?: ReadonlyArray<{ toString(): string }>;
          includeTotal?: boolean;
        }
      ).projectionFieldIds?.map((fieldId) => fieldId.toString())
    ).toEqual([]);
    expect((captured.options as { includeTotal?: boolean }).includeTotal).toBe(false);
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

  it('rejects client filters on statically unreadable fields before querying records', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        filter: {
          fieldId: statusField.id().toString(),
          operator: 'is',
          value: 'Open',
        },
      },
      {
        queryScope: {
          readableFieldIds: new Set([titleField.id().toString()]),
        },
      }
    );
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result._unsafeUnwrapErr().code).toBe('record.filter.unreadable_field');
    expect(findCalled).toBe(false);
  });

  it('strips unreadable client filters on the search-index path instead of rejecting', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };
    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        fieldKeyType: FieldKeyType.Id,
        search: ['1', '', true],
        includeSearchMatches: true,
        searchIndexMode: 'matched',
        filter: {
          fieldId: statusField.id().toString(),
          operator: 'is',
          value: 'Open',
        },
      },
      {
        queryScope: {
          readableFieldIds: new Set([titleField.id().toString()]),
        },
      }
    )._unsafeUnwrap();
    const result = await new ListTableRecordsHandler(
      tableRepository,
      recordQueryRepo,
      new NoopLogger()
    ).handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(findCalled).toBe(true);
  });

  it.each([
    {
      kind: 'sort',
      query: (tableId: string, statusId: string) => ({
        tableId,
        sort: [{ fieldId: statusId, order: 'asc' as const }],
      }),
      code: 'record.sort.unreadable_field',
    },
    {
      kind: 'group',
      query: (tableId: string, statusId: string) => ({
        tableId,
        groupBy: [statusId],
      }),
      code: 'record.group.unreadable_field',
    },
  ])(
    'rejects client $kind on statically unreadable fields before querying records',
    async ({ query, code }) => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();

      let findCalled = false;
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async () => {
          findCalled = true;
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const queryResult = ListTableRecordsQuery.create(
        query(table.id().toString(), statusField.id().toString()),
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString()]),
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), queryResult);

      expect(result._unsafeUnwrapErr().code).toBe(code);
      expect(findCalled).toBe(false);
    }
  );

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
      restore: async (_context, _table) => err(domainError.notFound({ message: 'Not found' })),
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
      {
        column: '__auto_number',
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
        column: undefined,
      },
      {
        fieldId: statusField.id().toString(),
        direction: 'asc',
        column: undefined,
      },
      {
        fieldId: undefined,
        column: `__row_${view.id().toString()}`,
        direction: 'asc',
      },
      {
        fieldId: undefined,
        column: '__auto_number',
        direction: 'asc',
      },
    ]);
  });

  it('limits visible-row search and sorting to readable fields', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
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

    const queryResult = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        sort: [{ fieldId: titleField.id().toString(), order: 'desc' }],
        search: ['hello', '', true],
        fieldKeyType: FieldKeyType.Id,
      },
      {
        recordReadQuerySource: {
          tableName: 'base.table',
          cteName: 'read_source',
          cteSql: 'select * from base.table',
          enabledFieldIds: [titleField.id().toString()],
        },
      }
    );
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

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

  it('rejects mixed client filter groups when any nested condition is unreadable', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const queryResult = ListTableRecordsQuery.create(
      {
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
      },
      {
        recordReadQuerySource: {
          tableName: 'base.table',
          cteName: 'read_source',
          cteSql: 'select * from base.table',
          enabledFieldIds: [statusField.id().toString()],
        },
      }
    );
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), queryResult._unsafeUnwrap());

    expect(result._unsafeUnwrapErr().code).toBe('record.filter.unreadable_field');
    expect(findCalled).toBe(false);
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

  it('records the repository fallback instead of the requested generated search path', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const generatedPath = {
      kind: 'generated_tsvector' as const,
      generatedColumnName: '__tqops_search_vector',
      languageConfig: 'simple',
      searchScope: 'all_fields' as const,
      coveredFieldIds: table.fieldIds(),
    };
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () =>
        ok({
          records: [],
          total: 0,
          searchAccessPath: {
            requested: 'generated_tsvector',
            used: 'default',
            fallbackReason: 'generated_tsvector_unavailable',
          },
        } as unknown as ITableRecordQueryResult),
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };
    const requests: TableQueryObservabilityEvent[] = [];
    const fallbacks: TableQueryObservabilityEvent[] = [];
    const observability: ITableQueryObservability = {
      recordRequest: (event) => requests.push(event),
      recordError: () => undefined,
      recordSearchFallback: (event) => fallbacks.push(event),
      recordSearchValidation: (_event: TableQuerySearchValidationEvent) => undefined,
    };
    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        search: ['Alpha', '', true],
      },
      { recordSearchAccessPath: generatedPath }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(
      tableRepository,
      recordQueryRepo,
      new NoopLogger(),
      observability
    );

    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(requests[requests.length - 1]).toMatchObject({
      accessPath: 'fallback',
      searchMode: 'ilike',
      fallbackReason: 'generated_tsvector_unavailable',
    });
    expect(fallbacks).toHaveLength(1);
  });

  it('defaults projection to queryScope.readableFieldIds when client projection is omitted', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();

    const captured: { options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.options = options;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      { tableId: table.id().toString() },
      { queryScope: { readableFieldIds: new Set([titleId]) } }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(
      (
        captured.options as {
          projectionFieldIds?: ReadonlyArray<{ toString(): string }>;
        }
      ).projectionFieldIds?.map((id) => id.toString())
    ).toEqual([titleId]);
  });

  it('defaults projection to empty array for empty readableFieldIds allow-list', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);

    const captured: { options?: unknown } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.options = options;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      { tableId: table.id().toString() },
      { queryScope: { readableFieldIds: new Set() } }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(
      (
        captured.options as {
          projectionFieldIds?: ReadonlyArray<{ toString(): string }>;
        }
      ).projectionFieldIds?.map((id) => id.toString())
    ).toEqual([]);
  });

  it('ANDs queryScope.recordSpec into the query plan', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();

    const recordSpec = {
      isSatisfiedBy: () => true,
      accept: (visitor: { visit?: (spec: unknown) => void }) => {
        visitor.visit?.(recordSpec);
        return ok(undefined);
      },
    } as never;

    const captured: { spec?: { accept?: (v: unknown) => unknown } } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, spec) => {
        captured.spec = spec as { accept?: (v: unknown) => unknown };
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        filter: {
          fieldId: titleField.id().toString(),
          operator: 'contains',
          value: 'x',
        },
      },
      { queryScope: { recordSpec } }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeDefined();
  });

  it('expands projection with mask dependency fields and evaluates visibleWhen', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const statusId = statusField.id().toString();

    const openRecordId = createRecordId('o').toString();
    const closedRecordId = createRecordId('c').toString();
    const visibilityByRecordId = new Map<string, boolean>([
      [openRecordId, true],
      [closedRecordId, false],
    ]);
    const visibleWhen = {
      field: () => statusField,
      isSatisfiedBy: (record: { id: () => { toString: () => string } }) =>
        visibilityByRecordId.get(record.id().toString()) ?? false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    const captured: { projection?: string[] } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.projection = (
          options as { projectionFieldIds?: ReadonlyArray<{ toString(): string }> }
        ).projectionFieldIds?.map((id) => id.toString());
        return ok({
          records: [
            {
              id: openRecordId,
              version: 1,
              fields: { [titleId]: 'Visible', [statusId]: 'Open' },
            },
            {
              id: closedRecordId,
              version: 1,
              fields: { [titleId]: 'Hidden', [statusId]: 'Closed' },
            },
          ],
          total: 2,
        });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        fieldKeyType: FieldKeyType.Id,
        projection: [titleId],
      },
      {
        queryScope: {
          // Status not statically returned, but required for mask evaluation
          readableFieldIds: new Set([titleId]),
          fieldMasks: [{ fieldId: titleId, visibleWhen }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    // Mask dep Status must be projected for evaluation
    expect(captured.projection).toContain(statusId);
    const records = result._unsafeUnwrap().records;
    expect(records).toHaveLength(2);
    // Status never returned to client (only Title in projection)
    expect(records[0]?.fields).toEqual({ [titleId]: 'Visible' });
    expect(records[1]?.fields).not.toHaveProperty(titleId);
    expect(records[0]?.fields).not.toHaveProperty(statusId);
    expect(records[1]?.fields).not.toHaveProperty(statusId);
  });

  it('keeps all table fields when masks expand an allow-all read without projection', async () => {
    const builder = Table.builder()
      .withBaseId(createBaseId('m'))
      .withName(TableName.create('Masked Records')._unsafeUnwrap());
    builder.field().singleLineText().withName(FieldName.create('Title')._unsafeUnwrap()).done();
    builder
      .field()
      .singleSelect()
      .withName(FieldName.create('Status')._unsafeUnwrap())
      .withOptions([selectOption('Open')])
      .done();
    builder.field().singleLineText().withName(FieldName.create('Notes')._unsafeUnwrap()).done();
    builder.view().defaultGrid().done();
    const table = builder.build()._unsafeUnwrap();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleId = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap()
      .id()
      .toString();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const statusId = statusField.id().toString();
    const notesId = table
      .getField((field) => field.name().toString() === 'Notes')
      ._unsafeUnwrap()
      .id()
      .toString();

    const recordId = createRecordId('m').toString();
    const visibleWhen = {
      field: () => statusField,
      isSatisfiedBy: () => true,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    const captured: { projection?: string[] } = {};
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async (_context, _table, _spec, options) => {
        captured.projection = (
          options as { projectionFieldIds?: ReadonlyArray<{ toString(): string }> }
        ).projectionFieldIds?.map((id) => id.toString());
        return ok({
          records: [
            {
              id: recordId,
              version: 1,
              fields: { [titleId]: 'Visible', [statusId]: 'Open', [notesId]: 'Keep me' },
            },
          ],
          total: 1,
        });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      { tableId: table.id().toString(), fieldKeyType: FieldKeyType.Id },
      {
        // readableFieldIds undefined (allow-all) + no projection: masks must
        // not collapse the projection to dependency fields only.
        queryScope: { fieldMasks: [{ fieldId: titleId, visibleWhen }] },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(captured.projection).toEqual(expect.arrayContaining([titleId, statusId, notesId]));
    const records = result._unsafeUnwrap().records;
    expect(records).toHaveLength(1);
    expect(records[0]?.fields).toEqual({
      [titleId]: 'Visible',
      [statusId]: 'Open',
      [notesId]: 'Keep me',
    });
  });

  it('rejects right-hand field references to statically unreadable fields', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        filter: {
          fieldId: titleField.id().toString(),
          operator: 'is',
          value: { type: 'field', fieldId: statusField.id().toString() },
        },
      },
      {
        queryScope: {
          // Title allowed, Status denied — right-hand field references must fail closed.
          readableFieldIds: new Set([titleField.id().toString()]),
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result._unsafeUnwrapErr().code).toBe('record.filter.unreadable_field');
    expect(findCalled).toBe(false);
  });

  it('rejects filter RHS field-references to conditionally masked fields (never fail-open)', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        filter: {
          fieldId: titleField.id().toString(),
          operator: 'is',
          value: { type: 'field', fieldId: statusField.id().toString() },
        },
      },
      {
        queryScope: {
          // Both fields statically readable — mask alone must still reject RHS.
          readableFieldIds: new Set([titleField.id().toString(), statusField.id().toString()]),
          fieldMasks: [{ fieldId: statusField.id().toString(), visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toMatch(/conditionally masked/i);
    expect(findCalled).toBe(false);
  });

  it('passes a conditionally masked client sort to the repository', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        sort: [{ fieldId: titleField.id().toString(), order: 'asc' }],
      },
      {
        queryScope: {
          readableFieldIds: new Set([titleField.id().toString()]),
          fieldMasks: [{ fieldId: titleField.id().toString(), visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(findCalled).toBe(true);
  });

  it('passes a masked client groupBy as group metadata (not sort-only)', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    // Mimic OpenAPI: groupBy also folded into sort.
    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        groupBy: [titleId],
        sort: [{ fieldId: titleId, order: 'asc' }],
      },
      {
        queryScope: {
          readableFieldIds: new Set([titleId]),
          fieldMasks: [{ fieldId: titleId, visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().appliedGroup).toEqual([{ fieldId: titleId, order: 'asc' }]);
    expect(findCalled).toBe(true);
  });

  it('resolves and passes a masked groupBy by field name', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleField = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap();
    const titleId = titleField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    // groupBy uses name while sort is folded with the same fieldKeyType (name).
    // Handler must resolve group keys to IDs before subtracting from sort.
    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        fieldKeyType: FieldKeyType.Name,
        groupBy: ['Title'],
        sort: [{ fieldId: 'Title', order: 'asc' }],
      },
      {
        queryScope: {
          readableFieldIds: new Set([titleId]),
          fieldMasks: [{ fieldId: titleId, visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().appliedGroup).toEqual([{ fieldId: titleId, order: 'asc' }]);
    expect(findCalled).toBe(true);
  });

  it.each([
    {
      label: 'id',
      fieldKey: (field: { id: () => { toString: () => string } }) => field.id().toString(),
    },
    {
      label: 'name',
      fieldKey: (field: { name: () => { toString: () => string } }) => field.name().toString(),
    },
    {
      label: 'dbFieldName',
      fieldKey: (field: {
        dbFieldName: () => {
          _unsafeUnwrap: () => { value: () => { _unsafeUnwrap: () => string } };
        };
      }) => field.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap(),
    },
  ])('passes explicit search on a masked field by $label', async ({ fieldKey }) => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const statusId = statusField.id().toString();
    statusField.setDbFieldName(DbFieldName.rehydrate('status_masked_col')._unsafeUnwrap());

    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;

    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };

    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        search: ['secret', fieldKey(statusField), true],
      },
      {
        queryScope: {
          readableFieldIds: new Set([statusId]),
          fieldMasks: [{ fieldId: statusId, visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(findCalled).toBe(true);
  });

  it('passes grid-list targeted search on a masked field with search matches', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap();
    const statusId = statusField.id().toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;
    let findCalled = false;
    const recordQueryRepo: ITableRecordQueryRepository = {
      find: async () => {
        findCalled = true;
        return ok({ records: [], total: 0 });
      },
      findOne: async () => err(domainError.notFound({ message: 'Not found' })),
      async *findStream() {},
    };
    const query = ListTableRecordsQuery.create(
      {
        tableId: table.id().toString(),
        search: ['secret', statusId, true],
        includeSearchMatches: true,
      },
      {
        queryScope: {
          readableFieldIds: new Set([statusId]),
          fieldMasks: [{ fieldId: statusId, visibleWhen: neverVisible }],
        },
      }
    )._unsafeUnwrap();
    const result = await new ListTableRecordsHandler(
      tableRepository,
      recordQueryRepo,
      new NoopLogger()
    ).handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(findCalled).toBe(true);
  });

  it('filters view default sort/group by the final field allow-list', async () => {
    const table = buildTable();
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
          sort: [
            { fieldId: statusField.id().toString(), order: 'asc' },
            { fieldId: titleField.id().toString(), order: 'desc' },
          ],
          group: [{ fieldId: statusField.id().toString(), order: 'asc' }],
          manualSort: false,
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();

    const tableRepository = new MemoryTableRepository();
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

    const query = ListTableRecordsQuery.create(
      {
        tableId: tableWithDefaults.id().toString(),
        viewId: view.id().toString(),
        fieldKeyType: FieldKeyType.Id,
      },
      {
        queryScope: {
          // Status not allowed — view sort/group on Status must be stripped
          readableFieldIds: new Set([titleField.id().toString()]),
        },
      }
    )._unsafeUnwrap();
    const handler = new ListTableRecordsHandler(tableRepository, recordQueryRepo, new NoopLogger());
    const result = await handler.handle(createContext(), query);

    expect(result.isOk()).toBe(true);
    expect(captured.spec).toBeUndefined();
    const orderBy = (
      captured.options as {
        orderBy?: Array<{ fieldId?: { toString: () => string }; column?: string }>;
      }
    ).orderBy;
    const fieldIds = (orderBy ?? [])
      .map((item) => item.fieldId?.toString())
      .filter((id): id is string => Boolean(id));
    expect(fieldIds).toEqual([titleField.id().toString()]);
    expect(fieldIds).not.toContain(statusField.id().toString());
  });

  describe('queryScope authorization matrix', () => {
    it('builds grouped metadata from the same permission and client-filter scope', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const titleId = titleField.id().toString();
      const statusId = statusField.id().toString();
      const rowScope = buildRecordConditionSpec(table, {
        fieldId: statusId,
        operator: 'isNot',
        value: 'Private',
      })._unsafeUnwrap();
      const captured: { spec?: unknown; options?: unknown } = {};
      const groups = [
        { fields: { [statusId]: 'Open' }, count: 2 },
        { fields: { [statusId]: 'Closed' }, count: 1 },
      ];
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, spec, options) => {
          captured.spec = spec;
          captured.options = options;
          return ok({ records: [], total: 3, groups });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          filter: { fieldId: titleId, operator: 'contains', value: 'ticket' },
          sort: [{ fieldId: statusId, order: 'asc' }],
          groupBy: [statusId],
        },
        {
          queryScope: { recordSpec: rowScope },
          includeGroupMetadata: true,
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result._unsafeUnwrap().groups).toEqual(groups);
      expect(result._unsafeUnwrap().appliedGroup).toEqual([{ fieldId: statusId, order: 'asc' }]);
      expect(
        (
          captured.options as {
            groupBy?: Array<{ fieldId: { toString(): string }; direction: string }>;
          }
        ).groupBy
      ).toEqual([{ fieldId: statusField.id(), direction: 'asc', groupIdentityCollation: true }]);

      const combinedSpec = captured.spec as {
        isSatisfiedBy(record: TableRecord): boolean;
      };
      const matching = TableRecord.fromRawFieldValues({
        id: createRecordId('g').toString(),
        tableId: table.id(),
        fields: { [titleId]: 'ticket 1', [statusId]: 'Open' },
      })._unsafeUnwrap();
      const deniedByFilter = TableRecord.fromRawFieldValues({
        id: createRecordId('h').toString(),
        tableId: table.id(),
        fields: { [titleId]: 'note', [statusId]: 'Open' },
      })._unsafeUnwrap();
      const deniedByScope = TableRecord.fromRawFieldValues({
        id: createRecordId('i').toString(),
        tableId: table.id(),
        fields: { [titleId]: 'ticket 2', [statusId]: 'Private' },
      })._unsafeUnwrap();
      expect(combinedSpec.isSatisfiedBy(matching)).toBe(true);
      expect(combinedSpec.isSatisfiedBy(deniedByFilter)).toBe(false);
      expect(combinedSpec.isSatisfiedBy(deniedByScope)).toBe(false);
    });

    it('returns only records satisfying both the permission row scope and client filter', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const titleId = titleField.id().toString();
      const statusId = statusField.id().toString();
      const rowScope = buildRecordConditionSpec(table, {
        fieldId: statusId,
        operator: 'is',
        value: 'Open',
      })._unsafeUnwrap();
      const fixtures = [
        {
          id: createRecordId('a').toString(),
          fields: { [titleId]: 'filter match', [statusId]: 'Open' },
          version: 1,
        },
        {
          id: createRecordId('b').toString(),
          fields: { [titleId]: 'scope only', [statusId]: 'Open' },
          version: 1,
        },
        {
          id: createRecordId('c').toString(),
          fields: { [titleId]: 'filter match', [statusId]: null },
          version: 1,
        },
      ] satisfies TableRecordReadModel[];
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, spec) => {
          const records = fixtures.filter((record) => {
            if (!spec) return true;
            const domainRecord = TableRecord.fromRawFieldValues({
              id: record.id,
              tableId: table.id(),
              fields: record.fields,
            })._unsafeUnwrap();
            return spec.isSatisfiedBy(domainRecord);
          });
          return ok({ records, total: records.length });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          filter: {
            fieldId: titleId,
            operator: 'contains',
            value: 'filter',
          },
        },
        { queryScope: { recordSpec: rowScope } }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result._unsafeUnwrap().records.map((record) => record.id)).toEqual([
        createRecordId('a').toString(),
      ]);
    });

    it('includes conditionally masked fields in all-fields visible-row search', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const captured: { searchFieldIds?: string[] } = {};
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, _spec, options) => {
          captured.searchFieldIds = options?.search?.visibleFieldIds?.map((id) => id.toString());
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          search: ['hidden-only-value', '', true],
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString(), statusField.id().toString()]),
            fieldMasks: [{ fieldId: statusField.id().toString(), visibleWhen: neverVisible }],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(captured.searchFieldIds).toEqual([
        titleField.id().toString(),
        statusField.id().toString(),
      ]);
    });

    it('keeps all-fields search when every readable field is conditionally masked', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const captured: { searchFieldIds?: string[] } = {};
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, _spec, options) => {
          captured.searchFieldIds = options?.search?.visibleFieldIds?.map((id) => id.toString());
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          search: ['hidden-only-value', '', true],
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString(), statusField.id().toString()]),
            fieldMasks: [
              { fieldId: titleField.id().toString(), visibleWhen: neverVisible },
              { fieldId: statusField.id().toString(), visibleWhen: neverVisible },
            ],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(captured.searchFieldIds).toEqual([
        titleField.id().toString(),
        statusField.id().toString(),
      ]);
    });

    it('drops search-index hits on cells stripped by field masks', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const titleId = titleField.id().toString();
      const statusId = statusField.id().toString();
      const recordId = createRecordId('a');
      const alwaysVisible = {
        isSatisfiedBy: () => true,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async () =>
          ok({
            records: [
              {
                id: recordId.toString(),
                version: 1,
                fields: { [titleId]: '11', [statusId]: '13' },
              },
            ],
            total: 1,
            searchMatches: [
              { index: 1, fieldId: titleField.id(), recordId },
              { index: 1, fieldId: statusField.id(), recordId },
            ],
          }),
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          search: ['1', '', true],
          includeSearchMatches: true,
          searchIndexMode: 'matched',
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleId, statusId]),
            fieldMasks: [
              { fieldId: titleId, visibleWhen: alwaysVisible },
              { fieldId: statusId, visibleWhen: neverVisible },
            ],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().searchMatches).toEqual([
        { index: 1, fieldId: titleField.id(), recordId },
      ]);
    });

    it('reindexes matched search-index hits after dropping hidden-only rows', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const titleId = titleField.id().toString();
      const statusId = statusField.id().toString();
      const hiddenOnlyRecordId = createRecordId('a');
      const visibleRecordId = createRecordId('b');
      const alwaysVisible = {
        isSatisfiedBy: () => true,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async () =>
          ok({
            records: [
              {
                id: hiddenOnlyRecordId.toString(),
                version: 1,
                fields: { [titleId]: 'xx', [statusId]: '13' },
              },
              {
                id: visibleRecordId.toString(),
                version: 1,
                fields: { [titleId]: '11', [statusId]: 'xx' },
              },
            ],
            total: 2,
            searchMatches: [
              { index: 1, fieldId: statusField.id(), recordId: hiddenOnlyRecordId },
              { index: 2, fieldId: titleField.id(), recordId: visibleRecordId },
            ],
          }),
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          search: ['1', '', true],
          includeSearchMatches: true,
          searchIndexMode: 'matched',
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleId, statusId]),
            fieldMasks: [
              { fieldId: titleId, visibleWhen: alwaysVisible },
              { fieldId: statusId, visibleWhen: neverVisible },
            ],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().searchMatches).toEqual([
        { index: 1, fieldId: titleField.id(), recordId: visibleRecordId },
      ]);
    });

    it('includes masked fields in all-fields search-index and drops hidden cell hits', async () => {
      const table = buildTable();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), table);
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const titleId = titleField.id().toString();
      const statusId = statusField.id().toString();
      const visibleRecordId = createRecordId('a');
      const hiddenRecordId = createRecordId('b');
      const visibilityByRecordId = new Map<string, boolean>([
        [visibleRecordId.toString(), true],
        [hiddenRecordId.toString(), false],
      ]);
      const titleVisibleWhen = {
        isSatisfiedBy: (record: { id: () => { toString: () => string } }) =>
          visibilityByRecordId.get(record.id().toString()) ?? false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const captured: {
        rowSearchFieldIds?: string[];
        matchSearchFieldIds?: string[];
        projectionFieldIds?: string[];
      } = {};
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, _spec, options) => {
          captured.rowSearchFieldIds = options?.search?.visibleFieldIds?.map((id) => id.toString());
          captured.matchSearchFieldIds = options?.searchFieldMatchesSearch?.visibleFieldIds?.map(
            (id) => id.toString()
          );
          captured.projectionFieldIds = options?.projectionFieldIds?.map((id) => id.toString());
          return ok({
            records: [
              {
                id: visibleRecordId.toString(),
                version: 1,
                fields: { [titleId]: '11', [statusId]: 'Open' },
              },
              {
                id: hiddenRecordId.toString(),
                version: 1,
                fields: { [titleId]: '21', [statusId]: 'Closed' },
              },
            ],
            total: 2,
            searchMatches: [
              { index: 1, fieldId: titleField.id(), recordId: visibleRecordId },
              { index: 2, fieldId: titleField.id(), recordId: hiddenRecordId },
            ],
          });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          search: ['1', '', false],
          includeSearchMatches: true,
          searchIndexMode: 'matched',
        },
        {
          queryScope: {
            readableFieldIds: new Set(),
            fieldMasks: [{ fieldId: titleId, visibleWhen: titleVisibleWhen }],
          },
          searchFieldScope: 'visible',
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(captured.rowSearchFieldIds).toBeUndefined();
      expect(captured.matchSearchFieldIds).toContain(titleId);
      expect(captured.projectionFieldIds).toContain(titleId);
      expect(result._unsafeUnwrap().searchMatches).toEqual([
        { index: 1, fieldId: titleField.id(), recordId: visibleRecordId },
      ]);
    });

    it('keeps conditionally masked fields in view-default sort and group', async () => {
      const table = buildTable();
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
            sort: [
              { fieldId: statusField.id().toString(), order: 'asc' },
              { fieldId: titleField.id().toString(), order: 'desc' },
            ],
            group: [{ fieldId: statusField.id().toString(), order: 'asc' }],
            manualSort: false,
          })._unsafeUnwrap(),
        },
      ])
        .mutate(table)
        ._unsafeUnwrap();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), tableWithDefaults);
      const captured: { orderByFieldIds?: Array<string | undefined> } = {};
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, _spec, options) => {
          captured.orderByFieldIds = options?.orderBy?.map((item) =>
            'fieldId' in item ? item.fieldId.toString() : undefined
          );
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const query = ListTableRecordsQuery.create(
        {
          tableId: tableWithDefaults.id().toString(),
          viewId: view.id().toString(),
          fieldKeyType: FieldKeyType.Id,
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString(), statusField.id().toString()]),
            fieldMasks: [{ fieldId: statusField.id().toString(), visibleWhen: neverVisible }],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(captured.orderByFieldIds).toContain(titleField.id().toString());
      expect(captured.orderByFieldIds).toContain(statusField.id().toString());
    });

    it('strips an echoed view.group on a statically unreadable field', async () => {
      const table = buildTable();
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const view = table.views()[0]!;
      const statusId = statusField.id().toString();
      const tableWithDefaults = TableUpdateViewQueryDefaultsSpec.create([
        {
          viewId: view.id(),
          queryDefaults: ViewQueryDefaults.create({
            group: [{ fieldId: statusId, order: 'asc' }],
            manualSort: false,
          })._unsafeUnwrap(),
        },
      ])
        .mutate(table)
        ._unsafeUnwrap();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), tableWithDefaults);
      let findCalled = false;
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async () => {
          findCalled = true;
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const query = ListTableRecordsQuery.create(
        {
          tableId: tableWithDefaults.id().toString(),
          viewId: view.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          groupBy: [statusId],
          sort: [{ fieldId: statusId, order: 'asc' }],
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString()]),
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().appliedGroup).toBeUndefined();
      expect(findCalled).toBe(true);
    });

    it('keeps an echoed view.group on a conditionally masked field', async () => {
      const table = buildTable();
      const titleField = table
        .getField((field) => field.name().toString() === 'Title')
        ._unsafeUnwrap();
      const statusField = table
        .getField((field) => field.name().toString() === 'Status')
        ._unsafeUnwrap();
      const view = table.views()[0]!;
      const statusId = statusField.id().toString();
      const tableWithDefaults = TableUpdateViewQueryDefaultsSpec.create([
        {
          viewId: view.id(),
          queryDefaults: ViewQueryDefaults.create({
            group: [{ fieldId: statusId, order: 'asc' }],
            manualSort: false,
          })._unsafeUnwrap(),
        },
      ])
        .mutate(table)
        ._unsafeUnwrap();
      const tableRepository = new MemoryTableRepository();
      await tableRepository.insert(createContext(), tableWithDefaults);
      const captured: { orderByFieldIds?: Array<string | undefined> } = {};
      const recordQueryRepo: ITableRecordQueryRepository = {
        find: async (_context, _table, _spec, options) => {
          captured.orderByFieldIds = options?.orderBy?.map((item) =>
            'fieldId' in item ? item.fieldId.toString() : undefined
          );
          return ok({ records: [], total: 0 });
        },
        findOne: async () => err(domainError.notFound({ message: 'Not found' })),
        async *findStream() {},
      };
      const neverVisible = {
        isSatisfiedBy: () => false,
        mutate: () => ok(undefined as never),
        accept: () => ok(undefined),
      } as never;
      const query = ListTableRecordsQuery.create(
        {
          tableId: tableWithDefaults.id().toString(),
          viewId: view.id().toString(),
          fieldKeyType: FieldKeyType.Id,
          groupBy: [statusId],
          sort: [{ fieldId: statusId, order: 'asc' }],
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleField.id().toString(), statusId]),
            fieldMasks: [{ fieldId: statusId, visibleWhen: neverVisible }],
          },
        }
      )._unsafeUnwrap();

      const result = await new ListTableRecordsHandler(
        tableRepository,
        recordQueryRepo,
        new NoopLogger()
      ).handle(createContext(), query);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().appliedGroup).toEqual([{ fieldId: statusId, order: 'asc' }]);
      expect(captured.orderByFieldIds).toContain(statusId);
    });
  });
});
