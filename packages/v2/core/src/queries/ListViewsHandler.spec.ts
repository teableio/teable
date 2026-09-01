import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { GridView } from '../domain/table/views/types/GridView';
import { KanbanView } from '../domain/table/views/types/KanbanView';
import { ViewAuditMetadata } from '../domain/table/views/ViewAuditMetadata';
import { ViewColumnMeta } from '../domain/table/views/ViewColumnMeta';
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import { ViewProperties } from '../domain/table/views/ViewProperties';
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { ListViewsHandler } from './ListViewsHandler';
import { ListViewsQuery } from './ListViewsQuery';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

const initializeView = (
  view: GridView | KanbanView,
  options: {
    withAuditMetadata?: boolean;
    columnMeta?: Record<string, unknown>;
    queryDefaults?: ViewQueryDefaults;
  } = {}
) => {
  view
    .setColumnMeta(
      ViewColumnMeta.rehydrate(
        options.columnMeta ?? {
          [fieldId.toString()]: { order: 0, width: 220 },
        }
      )._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view
    .setQueryDefaults(options.queryDefaults ?? ViewQueryDefaults.rehydrate({})._unsafeUnwrap())
    ._unsafeUnwrap();
  if (options.withAuditMetadata !== false) {
    view
      .setAuditMetadata(
        ViewAuditMetadata.rehydrate({
          createdBy: 'system',
          createdTime: '2026-07-27T00:00:00.000Z',
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
  }
  return view;
};

const buildTable = (options: { secondViewAuditMetadata?: boolean } = {}) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Views')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const baseTable = builder.build()._unsafeUnwrap();

  const gridView = initializeView(
    GridView.create({
      id: ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap(),
      name: ViewName.create('First')._unsafeUnwrap(),
      properties: ViewProperties.create({
        description: 'Rich view',
        isLocked: true,
        enableShare: true,
        shareId: 'shr-list',
        shareMeta: { allowCopy: true },
      })._unsafeUnwrap(),
    })._unsafeUnwrap(),
    {
      columnMeta: {
        [fieldId.toString()]: {
          order: 0,
          visible: true,
          hidden: false,
          width: 220,
          required: true,
          statisticFunc: 'count',
          legacyFlag: true,
        },
        staleField: { order: 1, width: 300 },
      },
      queryDefaults: ViewQueryDefaults.rehydrate(
        {
          sort: [{ fieldId: fieldId.toString(), order: 'asc' }],
          manualSort: false,
          group: [{ fieldId: fieldId.toString(), order: 'desc' }],
        },
        {
          sourceFilter: {
            conjunction: 'and',
            filterSet: [{ fieldId: fieldId.toString(), operator: 'is', value: 'Open' }],
          },
        }
      )._unsafeUnwrap(),
    }
  );
  gridView.setOptions({ frozenColumnCount: 1 })._unsafeUnwrap();

  const kanbanView = initializeView(
    KanbanView.create({
      id: ViewId.create(`viw${'b'.repeat(16)}`)._unsafeUnwrap(),
      name: ViewName.create('Second')._unsafeUnwrap(),
    })._unsafeUnwrap(),
    {
      withAuditMetadata: options.secondViewAuditMetadata !== false,
      columnMeta: {
        [fieldId.toString()]: {
          order: 0,
          visible: true,
          hidden: false,
          width: 220,
          required: true,
          statisticFunc: 'count',
          legacyFlag: true,
        },
      },
    }
  );

  return Table.rehydrate({
    id: baseTable.id(),
    baseId: baseTable.baseId(),
    name: baseTable.name(),
    fields: baseTable.getFields(),
    views: [gridView, kanbanView],
    primaryFieldId: baseTable.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('ListViewsQuery', () => {
  it('creates a nominal Table ID', () => {
    const table = buildTable();
    const result = ListViewsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap();

    expect(result.tableId.equals(table.id())).toBe(true);
    expect(result.viewIds).toBeUndefined();
  });

  it('rejects an invalid Table ID', () => {
    const result = ListViewsQuery.create({ tableId: 'invalid' });

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
  });

  it('validates and deduplicates an optional View projection', () => {
    const table = buildTable();
    const viewId = table.views()[1].id().toString();
    const result = ListViewsQuery.create({
      tableId: table.id().toString(),
      viewIds: [viewId, viewId],
    })._unsafeUnwrap();

    expect(result.viewIds?.map((id) => id.toString())).toEqual([viewId]);
    expect(
      ListViewsQuery.create({
        tableId: table.id().toString(),
        viewIds: ['invalid'],
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('ListViewsHandler', () => {
  it('projects every View child in aggregate order and preserves public properties', async () => {
    const context = createContext();
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListViewsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListViewsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().views).toEqual([
      {
        id: `viw${'a'.repeat(16)}`,
        name: 'First',
        type: 'grid',
        description: 'Rich view',
        options: { frozenColumnCount: 1 },
        filter: {
          conjunction: 'and',
          filterSet: [{ fieldId: fieldId.toString(), operator: 'is', value: 'Open' }],
        },
        sort: {
          sortObjs: [{ fieldId: fieldId.toString(), order: 'asc' }],
          manualSort: false,
        },
        group: [{ fieldId: fieldId.toString(), order: 'desc' }],
        isLocked: true,
        enableShare: true,
        shareId: 'shr-list',
        shareMeta: { allowCopy: true },
        createdBy: 'system',
        createdTime: '2026-07-27T00:00:00.000Z',
        columnMeta: {
          [fieldId.toString()]: {
            order: 0,
            width: 220,
            hidden: false,
            statisticFunc: 'count',
          },
        },
      },
      {
        id: `viw${'b'.repeat(16)}`,
        name: 'Second',
        type: 'kanban',
        createdBy: 'system',
        createdTime: '2026-07-27T00:00:00.000Z',
        columnMeta: { [fieldId.toString()]: { order: 0, visible: true } },
      },
    ]);
  });

  it('maps a missing Table aggregate to table.not_found', async () => {
    const table = buildTable();
    const handler = new ListViewsHandler(new MemoryTableRepository(), new NoopLogger());

    const result = await handler.handle(
      createContext(),
      ListViewsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'table.not_found',
      message: 'Table not found',
    });
  });

  it('returns only projected View children in aggregate order', async () => {
    const context = createContext();
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListViewsHandler(repository, new NoopLogger());
    const projectedId = table.views()[1].id().toString();

    const result = await handler.handle(
      context,
      ListViewsQuery.create({
        tableId: table.id().toString(),
        viewIds: [projectedId, `viw${'z'.repeat(16)}`],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().views.map((view) => view.id)).toEqual([projectedId]);
  });

  it('returns an empty projection without loading the repository', async () => {
    const table = buildTable();
    const repository = {
      findOne: async () => {
        throw new Error('repository should not be called');
      },
    } as unknown as ITableRepository;
    const handler = new ListViewsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      createContext(),
      ListViewsQuery.create({
        tableId: table.id().toString(),
        viewIds: [],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().views).toEqual([]);
  });

  it('propagates unexpected Table repository failures', async () => {
    const table = buildTable();
    const repository = {
      findOne: async () => err(domainError.unexpected({ message: 'query failed' })),
    } as unknown as ITableRepository;
    const handler = new ListViewsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      createContext(),
      ListViewsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });

  it('fails when any hydrated View child is missing required projection metadata', async () => {
    const context = createContext();
    const table = buildTable({ secondViewAuditMetadata: false });
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListViewsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListViewsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('ViewAuditMetadata not set');
  });

  it('does not project metadata from unauthorized View children', async () => {
    const context = createContext();
    const table = buildTable({ secondViewAuditMetadata: false });
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListViewsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListViewsQuery.create({
        tableId: table.id().toString(),
        viewIds: [table.views()[0].id().toString()],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().views.map((view) => view.id)).toEqual([
      table.views()[0].id().toString(),
    ]);
  });
});
