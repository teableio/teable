import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewId } from '../domain/table/views/ViewId';
import type { ICollaboratorDirectoryService } from '../ports/CollaboratorDirectoryService';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordCollaboratorQueryRepository } from '../ports/TableRecordQueryRepository';
import { GetViewCollaboratorsHandler } from './GetViewCollaboratorsHandler';
import { GetViewCollaboratorsQuery } from './GetViewCollaboratorsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap(),
};
const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw', seed: string) => `${prefix}${seed.repeat(16)}`;

const buildTable = (viewType: 'grid' | 'form') => {
  const tableId = TableId.create(id('tbl', 't'))._unsafeUnwrap();
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const userFieldId = FieldId.create(id('fld', 'u'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(tableId)
    .withName(TableName.create('Collaborators')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .user()
    .withId(userFieldId)
    .withName(FieldName.create('Owner')._unsafeUnwrap())
    .done();
  builder.view()[viewType]().withId(viewId).defaultName().done();
  const table = builder.build()._unsafeUnwrap();
  return { table, tableId, viewId, userFieldId };
};

const createRecordRepository = (userIds: ReadonlyArray<string>) => {
  const findDistinctUserIds = vi.fn(async () => ok(userIds));
  const repository: ITableRecordCollaboratorQueryRepository = {
    findDistinctUserIds,
    find: async () => err(new Error('not used') as never),
    findOne: async () => err(new Error('not used') as never),
    async *findStream() {},
  };
  return { repository, findDistinctUserIds };
};

const createDirectory = () => {
  const listBaseUsers = vi.fn(async () =>
    ok([{ id: 'usr-base', name: 'Base User', avatar: 'base.png' }])
  );
  const listUsersByIds = vi.fn(async () =>
    ok([{ id: 'usr-ref', name: 'Referenced User', avatar: null }])
  );
  return {
    service: { listBaseUsers, listUsersByIds } satisfies ICollaboratorDirectoryService,
    listBaseUsers,
    listUsersByIds,
  };
};

describe('GetViewCollaboratorsQuery', () => {
  it('defaults pagination and rejects malformed identifiers/windows', () => {
    const fixture = buildTable('grid');
    const query = GetViewCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.userFieldId.toString(),
      skip: 5,
    })._unsafeUnwrap();

    expect(query.pagination.limit().toNumber()).toBe(50);
    expect(query.pagination.offset().toNumber()).toBe(5);
    expect(
      GetViewCollaboratorsQuery.create({ tableId: 'invalid', take: 0 })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetViewCollaboratorsHandler', () => {
  it('uses the directory directly for an all-mode Form plan', async () => {
    const fixture = buildTable('form');
    const tables = new MemoryTableRepository();
    await tables.insert(context, fixture.table);
    const records = createRecordRepository(['usr-ref']);
    const directory = createDirectory();
    const handler = new GetViewCollaboratorsHandler(tables, records.repository, directory.service);
    const query = GetViewCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      search: 'Base',
      take: 10,
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap().collaborators).toEqual([
      { userId: 'usr-base', userName: 'Base User', avatar: 'base.png' },
    ]);
    expect(directory.listBaseUsers).toHaveBeenCalledWith(
      context,
      fixture.table.baseId(),
      expect.objectContaining({ search: 'Base' })
    );
    expect(records.findDistinctUserIds).not.toHaveBeenCalled();
    expect(directory.listUsersByIds).not.toHaveBeenCalled();
  });

  it('applies the referenced plan before looking up public-safe users', async () => {
    const fixture = buildTable('grid');
    const tables = new MemoryTableRepository();
    await tables.insert(context, fixture.table);
    const records = createRecordRepository(['usr-ref', 'usr-ref']);
    const directory = createDirectory();
    const handler = new GetViewCollaboratorsHandler(tables, records.repository, directory.service);
    const query = GetViewCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.userFieldId.toString(),
      search: 'Referenced',
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap().collaborators).toEqual([
      { userId: 'usr-ref', userName: 'Referenced User', avatar: null },
    ]);
    expect(records.findDistinctUserIds).toHaveBeenCalledOnce();
    expect(directory.listUsersByIds).toHaveBeenCalledWith(
      context,
      ['usr-ref', 'usr-ref'],
      expect.objectContaining({ search: 'Referenced' })
    );
    expect(directory.listBaseUsers).not.toHaveBeenCalled();
  });

  it('returns an empty result without querying the directory when no records reference users', async () => {
    const fixture = buildTable('grid');
    const tables = new MemoryTableRepository();
    await tables.insert(context, fixture.table);
    const records = createRecordRepository([]);
    const directory = createDirectory();
    const handler = new GetViewCollaboratorsHandler(tables, records.repository, directory.service);
    const query = GetViewCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.userFieldId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap().collaborators).toEqual([]);
    expect(directory.listUsersByIds).not.toHaveBeenCalled();
  });

  it('maps a missing partial aggregate to View not found', async () => {
    const fixture = buildTable('grid');
    const records = createRecordRepository([]);
    const directory = createDirectory();
    const handler = new GetViewCollaboratorsHandler(
      new MemoryTableRepository(),
      records.repository,
      directory.service
    );
    const query = GetViewCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.userFieldId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      tags: ['not-found'],
    });
  });
});
