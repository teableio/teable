import { err, ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { flattenAndSpecs } from '../domain/shared/specification/composeAndSpecs';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { RecordId } from '../domain/table/records/RecordId';
import { RecordByIdsSpec } from '../domain/table/records/specs/RecordByIdsSpec';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordCollaboratorQueryRepository } from '../ports/TableRecordQueryRepository';
import type { IUserLookupService } from '../ports/UserLookupService';
import { GetRecordCollaboratorsHandler } from './GetRecordCollaboratorsHandler';
import { GetRecordCollaboratorsQuery } from './GetRecordCollaboratorsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create(`usr${'a'.repeat(16)}`)._unsafeUnwrap(),
};
const id = (prefix: 'bse' | 'tbl' | 'fld', seed: string) => `${prefix}${seed.repeat(16)}`;

const buildTable = () => {
  const tableId = TableId.create(id('tbl', 't'))._unsafeUnwrap();
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const userFieldId = FieldId.create(id('fld', 'u'))._unsafeUnwrap();
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
  builder.view().defaultGrid().done();
  return { table: builder.build()._unsafeUnwrap(), tableId, userFieldId, primaryFieldId };
};

const createRecordRepository = (userIds: ReadonlyArray<string>) => {
  const findDistinctUserIds = vi.fn<ITableRecordCollaboratorQueryRepository['findDistinctUserIds']>(
    async () => ok(userIds)
  );
  const repository: ITableRecordCollaboratorQueryRepository = {
    findDistinctUserIds,
    find: async () => err(new Error('not used') as never),
    findOne: async () => err(new Error('not used') as never),
    async *findStream() {},
  };
  return { repository, findDistinctUserIds };
};

const createUserLookup = () => {
  const listUsersByIds = vi.fn(async () =>
    ok([
      { id: 'usr-alice', name: 'Alice', email: 'alice@example.com', avatarUrl: 'alice.png' },
      { id: 'usr-bob', name: 'Bob', email: 'bob@example.com', avatarUrl: null },
    ])
  );
  return {
    service: {
      listUsersByIds,
      listTableUsersByIdentifiers: vi.fn(),
    } as unknown as IUserLookupService,
    listUsersByIds,
  };
};

describe('GetRecordCollaboratorsQuery', () => {
  it('defaults pagination and rejects malformed identifiers', () => {
    const fixture = buildTable();
    const query = GetRecordCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      fieldId: fixture.userFieldId.toString(),
      skip: 5,
    })._unsafeUnwrap();

    expect(query.pagination.limit().toNumber()).toBe(50);
    expect(query.pagination.offset().toNumber()).toBe(5);
    expect(
      GetRecordCollaboratorsQuery.create({
        tableId: 'invalid',
        fieldId: 'invalid',
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetRecordCollaboratorsHandler', () => {
  it('looks up referenced users with email and applies search plus pagination', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const records = createRecordRepository(['usr-alice', 'usr-bob']);
    const users = createUserLookup();
    const handler = new GetRecordCollaboratorsHandler(
      tableRepository,
      records.repository,
      users.service
    );
    const query = GetRecordCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      fieldId: fixture.userFieldId.toString(),
      search: 'bob',
      take: 10,
    })._unsafeUnwrap();

    const result = (await handler.handle(context, query))._unsafeUnwrap();

    expect(records.findDistinctUserIds).toHaveBeenCalledOnce();
    expect(users.listUsersByIds).toHaveBeenCalledWith(['usr-alice', 'usr-bob']);
    expect(result.collaborators).toEqual([
      {
        userId: 'usr-bob',
        userName: 'Bob',
        email: 'bob@example.com',
        avatar: null,
      },
    ]);
  });

  it('rejects a non-user Field', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const handler = new GetRecordCollaboratorsHandler(
      tableRepository,
      createRecordRepository([]).repository,
      createUserLookup().service
    );
    const query = GetRecordCollaboratorsQuery.create({
      tableId: fixture.tableId.toString(),
      fieldId: fixture.primaryFieldId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrapErr().code).toBe(
      'record_collaborators.field_not_user_related'
    );
  });

  it('limits collaborator values to the row and conditional field scopes', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const records = createRecordRepository(['usr-alice']);
    const handler = new GetRecordCollaboratorsHandler(
      tableRepository,
      records.repository,
      createUserLookup().service
    );
    const recordSpec = RecordByIdsSpec.create([
      RecordId.create(`rec${'r'.repeat(16)}`)._unsafeUnwrap(),
    ]);
    const visibleWhen = RecordByIdsSpec.create([
      RecordId.create(`rec${'v'.repeat(16)}`)._unsafeUnwrap(),
    ]);
    const query = GetRecordCollaboratorsQuery.create(
      {
        tableId: fixture.tableId.toString(),
        fieldId: fixture.userFieldId.toString(),
      },
      {
        queryScope: {
          recordSpec,
          fieldMasks: [
            {
              fieldId: fixture.userFieldId.toString(),
              visibleWhen,
            },
          ],
        },
      }
    )._unsafeUnwrap();

    await handler.handle(context, query);

    const scopedSpec = records.findDistinctUserIds.mock.calls[0]?.[3];
    expect(flattenAndSpecs(scopedSpec)).toEqual([recordSpec, visibleWhen]);
  });

  it('rejects a collaborator field excluded by the readable field scope', async () => {
    const fixture = buildTable();
    const tableRepository = new MemoryTableRepository();
    await tableRepository.insert(context, fixture.table);
    const records = createRecordRepository([]);
    const handler = new GetRecordCollaboratorsHandler(
      tableRepository,
      records.repository,
      createUserLookup().service
    );
    const query = GetRecordCollaboratorsQuery.create(
      {
        tableId: fixture.tableId.toString(),
        fieldId: fixture.userFieldId.toString(),
      },
      { queryScope: { readableFieldIds: new Set() } }
    )._unsafeUnwrap();

    const result = await handler.handle(context, query);

    expect(result._unsafeUnwrapErr().code).toBe('record_collaborators.field_forbidden');
    expect(records.findDistinctUserIds).not.toHaveBeenCalled();
  });
});
