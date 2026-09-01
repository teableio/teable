import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldName } from '../domain/table/fields/FieldName';
import { SelectOption } from '../domain/table/fields/types/SelectOption';
import { TableUpdateViewQueryDefaultsSpec } from '../domain/table/specs/TableUpdateViewQueryDefaultsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type {
  ITableRecordCountQueryRepository,
  RecordQuerySearch,
} from '../ports/TableRecordQueryRepository';
import { CountTableRecordsHandler } from './CountTableRecordsHandler';
import { CountTableRecordsQuery } from './CountTableRecordsQuery';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const createBaseId = (seed: string) => BaseId.create(`bse${seed.repeat(16)}`)._unsafeUnwrap();
const selectOption = (name: string) => SelectOption.create({ name, color: 'blue' })._unsafeUnwrap();

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(createBaseId('a'))
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Count Records')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .singleSelect()
    .withName(FieldName.create('Status')._unsafeUnwrap())
    .withOptions([selectOption('Open')])
    .done();
  builder.view().defaultGrid().done();
  return builder.build()._unsafeUnwrap();
};

const createCountRepo = (onCount: ITableRecordCountQueryRepository['count']) => {
  const repo: ITableRecordCountQueryRepository = {
    find: async () => ok({ records: [], total: 0 }),
    findOne: async () => err(domainError.notFound({ message: 'Not found' })),
    async *findStream() {},
    count: onCount,
  };
  return repo;
};

describe('CountTableRecordsQuery', () => {
  it('builds a count query without pagination', () => {
    const table = buildTable();
    const titleId = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap()
      .id()
      .toString();
    const query = CountTableRecordsQuery.create({
      tableId: table.id().toString(),
      viewId: table.defaultView()._unsafeUnwrap().id().toString(),
      search: ['Cup', titleId, false],
    })._unsafeUnwrap();

    expect(query.tableId.equals(table.id())).toBe(true);
    expect(query.search).toEqual(['Cup', titleId, false]);
    expect(query.viewId).toBe(table.defaultView()._unsafeUnwrap().id().toString());
  });

  it.each([undefined, {}, { tableId: 'bad' }])('rejects invalid input: %j', (input) => {
    expect(CountTableRecordsQuery.create(input).isErr()).toBe(true);
  });

  it('rejects mutually exclusive link candidate and selected filters', () => {
    const table = buildTable();
    expect(
      CountTableRecordsQuery.create({
        tableId: table.id().toString(),
        filterLinkCellCandidate: 'fldcandidate',
        filterLinkCellSelected: 'fldselected',
      }).isErr()
    ).toBe(true);
  });
});

describe('CountTableRecordsHandler', () => {
  it('counts through the repository count method instead of listing rows', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleId = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap()
      .id()
      .toString();
    const captured: { findCalled: boolean; search?: RecordQuerySearch } = { findCalled: false };
    const repo = createCountRepo(async (_context, _table, _spec, options) => {
      captured.search = options?.search;
      return ok(4);
    });
    repo.find = async () => {
      captured.findCalled = true;
      return ok({ records: [], total: 0 });
    };
    const handler = new CountTableRecordsHandler(tableRepository, repo, new NoopLogger());

    const result = await handler.handle(
      createContext(),
      CountTableRecordsQuery.create({
        tableId: table.id().toString(),
        search: ['Cup', titleId, true],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().count).toBe(4);
    expect(captured.findCalled).toBe(false);
    expect(captured.search?.search.value).toBe('Cup');
    expect(captured.search?.search.affectsVisibleRows()).toBe(true);
  });

  it('keeps the stored view filter when counting', async () => {
    const table = buildTable();
    const statusField = table
      .getField((field) => field.name().toString() === 'Status')
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
                fieldId: statusField.id().toString(),
                operator: 'is',
                value: 'Open',
              },
            ],
          },
        })._unsafeUnwrap(),
      },
    ])
      .mutate(table)
      ._unsafeUnwrap();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), tableWithViewFilter);
    const captured: { spec?: unknown } = {};
    const handler = new CountTableRecordsHandler(
      tableRepository,
      createCountRepo(async (_context, _table, spec) => {
        captured.spec = spec;
        return ok(1);
      }),
      new NoopLogger()
    );

    const result = await handler.handle(
      createContext(),
      CountTableRecordsQuery.create({
        tableId: table.id().toString(),
        viewId: view.id().toString(),
        search: ['Cup', '', true],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().count).toBe(1);
    expect(captured.spec).toBeDefined();
  });

  it('narrows search fields to an explicit projection', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleId = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap()
      .id();
    const captured: { visibleFieldIds?: string[] } = {};
    const handler = new CountTableRecordsHandler(
      tableRepository,
      createCountRepo(async (_context, _table, _spec, options) => {
        captured.visibleFieldIds = options?.search?.visibleFieldIds?.map((id) => id.toString());
        return ok(2);
      }),
      new NoopLogger()
    );

    await handler.handle(
      createContext(),
      CountTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          search: ['Cup', '', true],
          projection: [titleId.toString()],
        },
        { searchFieldScope: 'projection' }
      )._unsafeUnwrap()
    );

    expect(captured.visibleFieldIds).toEqual([titleId.toString()]);
  });

  it('threads masks and searches query-only masked fields outside projection', async () => {
    const table = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(createContext(), table);
    const titleId = table
      .getField((field) => field.name().toString() === 'Title')
      ._unsafeUnwrap()
      .id()
      .toString();
    const statusId = table
      .getField((field) => field.name().toString() === 'Status')
      ._unsafeUnwrap()
      .id()
      .toString();
    const neverVisible = {
      isSatisfiedBy: () => false,
      mutate: () => ok(undefined as never),
      accept: () => ok(undefined),
    } as never;
    const captured: { visibleFieldIds?: string[]; maskFieldIds?: string[] } = {};
    const handler = new CountTableRecordsHandler(
      tableRepository,
      createCountRepo(async (_context, _table, _spec, options) => {
        captured.visibleFieldIds = options?.search?.visibleFieldIds?.map((id) => id.toString());
        captured.maskFieldIds = options?.fieldMasks?.map((mask) => mask.fieldId);
        return ok(1);
      }),
      new NoopLogger()
    );

    await handler.handle(
      createContext(),
      CountTableRecordsQuery.create(
        {
          tableId: table.id().toString(),
          search: ['Cup', '', true],
        },
        {
          queryScope: {
            readableFieldIds: new Set([titleId]),
            fieldMasks: [
              { fieldId: titleId, visibleWhen: neverVisible },
              { fieldId: statusId, visibleWhen: neverVisible },
            ],
          },
        }
      )._unsafeUnwrap()
    );

    expect(captured.visibleFieldIds).toEqual([titleId, statusId]);
    expect(captured.maskFieldIds).toEqual([titleId, statusId]);
  });
});
