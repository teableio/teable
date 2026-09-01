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
import { GetViewHandler } from './GetViewHandler';
import { GetViewQuery } from './GetViewQuery';
import { projectViewForQuery } from './ViewQueryProjection';

const createContext = (): IExecutionContext => ({
  actorId: ActorId.create('system')._unsafeUnwrap(),
});

const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

const buildTable = (options: { withAuditMetadata?: boolean } = {}) => {
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
  const view = GridView.create({
    id: ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap(),
    name: ViewName.create('All records')._unsafeUnwrap(),
    properties: ViewProperties.create({
      description: 'Main view',
      isLocked: true,
      enableShare: true,
      shareId: 'shr-test',
      shareMeta: { allowCopy: true },
    })._unsafeUnwrap(),
  })._unsafeUnwrap();
  view
    .setColumnMeta(
      ViewColumnMeta.rehydrate({
        [fieldId.toString()]: { order: 0, width: 220 },
        staleField: { order: 99 },
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view
    .setQueryDefaults(
      ViewQueryDefaults.rehydrate(
        {
          sort: [{ fieldId: 'staleField', order: 'desc' }],
          manualSort: false,
          group: [{ fieldId: 'staleField', order: 'asc' }],
        },
        {
          sourceFilter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'staleField', operator: 'is', value: 'Open' }],
          },
        }
      )._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view.setOptions({ frozenColumnCount: 1 })._unsafeUnwrap();
  const table = Table.rehydrate({
    id: baseTable.id(),
    baseId: baseTable.baseId(),
    name: baseTable.name(),
    fields: baseTable.getFields(),
    views: [view],
    primaryFieldId: baseTable.primaryFieldId(),
  })._unsafeUnwrap();
  if (options.withAuditMetadata !== false) {
    view
      .setAuditMetadata(
        ViewAuditMetadata.rehydrate({
          createdBy: 'system',
          createdTime: '2026-07-27T00:00:00.000Z',
          lastModifiedBy: 'editor',
          lastModifiedTime: '2026-07-27T01:00:00.000Z',
        })._unsafeUnwrap()
      )
      ._unsafeUnwrap();
  }
  return table;
};

describe('GetViewQuery', () => {
  it('creates nominal Table and View IDs', () => {
    const table = buildTable();
    const view = table.views()[0];
    const result = GetViewQuery.create({
      tableId: table.id().toString(),
      viewId: view.id().toString(),
    })._unsafeUnwrap();

    expect(result.tableId.equals(table.id())).toBe(true);
    expect(result.viewId.equals(view.id())).toBe(true);
  });

  it('rejects invalid IDs', () => {
    const result = GetViewQuery.create({ tableId: 'invalid', viewId: 'invalid' });

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
  });
});

describe('GetViewHandler', () => {
  it('loads a Table aggregate by Table and View specs and maps the selected child View', async () => {
    const context = createContext();
    const table = buildTable();
    const view = table.views()[0];
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, table);
    const handler = new GetViewHandler(tableRepository, new NoopLogger());
    const query = GetViewQuery.create({
      tableId: table.id().toString(),
      viewId: view.id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrap().view).toEqual({
      id: view.id().toString(),
      name: 'All records',
      type: 'grid',
      description: 'Main view',
      options: { frozenColumnCount: 1 },
      filter: {
        conjunction: 'and',
        filterSet: [{ fieldId: 'staleField', operator: 'is', value: 'Open' }],
      },
      sort: {
        sortObjs: [{ fieldId: 'staleField', order: 'desc' }],
        manualSort: false,
      },
      group: [{ fieldId: 'staleField', order: 'asc' }],
      isLocked: true,
      enableShare: true,
      shareId: 'shr-test',
      shareMeta: { allowCopy: true },
      createdBy: 'system',
      createdTime: '2026-07-27T00:00:00.000Z',
      lastModifiedBy: 'editor',
      lastModifiedTime: '2026-07-27T01:00:00.000Z',
      columnMeta: { [fieldId.toString()]: { order: 0, width: 220 } },
    });
  });

  it('keeps stored columnMeta when the Table field set is partial', () => {
    const table = buildTable();
    const view = table.views()[0]!;

    const complete = projectViewForQuery(table, view)._unsafeUnwrap();
    const partial = projectViewForQuery(table, view, { fieldSet: 'partial' })._unsafeUnwrap();

    expect(complete.columnMeta).toEqual({ [fieldId.toString()]: { order: 0, width: 220 } });
    expect(partial.columnMeta).toEqual({
      [fieldId.toString()]: { order: 0, width: 220 },
      staleField: { order: 99 },
    });
  });

  it('maps both an unknown Table and an unknown child View to view.not_found', async () => {
    const context = createContext();
    const table = buildTable();
    const repository = new MemoryTableRepository();
    const handler = new GetViewHandler(repository, new NoopLogger());
    const missingTableQuery = GetViewQuery.create({
      tableId: table.id().toString(),
      viewId: table.views()[0].id().toString(),
    })._unsafeUnwrap();

    const missingTable = await handler.handle(context, missingTableQuery);
    await repository.insert(context, table);
    const missingView = await handler.handle(
      context,
      GetViewQuery.create({
        tableId: table.id().toString(),
        viewId: `viw${'b'.repeat(16)}`,
      })._unsafeUnwrap()
    );

    expect(missingTable._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(missingView._unsafeUnwrapErr().code).toBe('view.not_found');
  });

  it('propagates unexpected Table repository failures', async () => {
    const table = buildTable();
    const repository = {
      findOne: async () => err(domainError.unexpected({ message: 'query failed' })),
    } as unknown as ITableRepository;
    const handler = new GetViewHandler(repository, new NoopLogger());
    const query = GetViewQuery.create({
      tableId: table.id().toString(),
      viewId: table.views()[0].id().toString(),
    })._unsafeUnwrap();

    const result = await handler.handle(createContext(), query);

    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });

  it('fails if audit metadata was not hydrated on the View child entity', async () => {
    const context = createContext();
    const metadataFreeTable = buildTable({ withAuditMetadata: false });
    const repository = new MemoryTableRepository();
    await repository.insert(context, metadataFreeTable);
    const handler = new GetViewHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      GetViewQuery.create({
        tableId: metadataFreeTable.id().toString(),
        viewId: metadataFreeTable.views()[0].id().toString(),
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('ViewAuditMetadata not set');
  });
});
