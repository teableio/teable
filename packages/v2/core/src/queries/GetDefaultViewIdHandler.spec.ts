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
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { GetDefaultViewIdHandler } from './GetDefaultViewIdHandler';
import { GetDefaultViewIdQuery } from './GetDefaultViewIdQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Default View')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .done();
  builder
    .view()
    .grid()
    .withId(ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(ViewName.create('First')._unsafeUnwrap())
    .done();
  builder
    .view()
    .grid()
    .withId(ViewId.create(`viw${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(ViewName.create('Second')._unsafeUnwrap())
    .done();
  return builder.build()._unsafeUnwrap();
};

describe('GetDefaultViewIdQuery', () => {
  it('creates a nominal Table ID', () => {
    const table = buildTable();
    const query = GetDefaultViewIdQuery.create({
      tableId: table.id().toString(),
    })._unsafeUnwrap();

    expect(query.tableId.equals(table.id())).toBe(true);
  });

  it.each([undefined, {}, { tableId: 'invalid' }])('rejects invalid input: %j', (input) => {
    const result = GetDefaultViewIdQuery.create(input);

    expect(result._unsafeUnwrapErr().code).toBe('validation.invalid');
  });
});

describe('GetDefaultViewIdHandler', () => {
  it('returns the first ordered View child selected by the Table aggregate', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetDefaultViewIdHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      GetDefaultViewIdQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().viewId).toBe(`viw${'a'.repeat(16)}`);
  });

  it('maps a missing Table aggregate to table.not_found', async () => {
    const table = buildTable();
    const handler = new GetDefaultViewIdHandler(new MemoryTableRepository(), new NoopLogger());

    const result = await handler.handle(
      context,
      GetDefaultViewIdQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'table.not_found',
      message: 'Table not found',
    });
  });

  it('returns view.not_found when a rehydrated Table has no active View child', async () => {
    const table = buildTable();
    const emptyTable = Table.rehydrate({
      id: table.id(),
      baseId: table.baseId(),
      name: table.name(),
      fields: table.getFields(),
      views: [],
      primaryFieldId: table.primaryFieldId(),
    })._unsafeUnwrap();
    const repository = new MemoryTableRepository();
    await repository.insert(context, emptyTable);
    const handler = new GetDefaultViewIdHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      GetDefaultViewIdQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      message: `View not found with tableId: ${table.id().toString()}`,
    });
  });

  it('propagates unexpected Table repository failures', async () => {
    const table = buildTable();
    const repository = {
      findOne: async () => err(domainError.unexpected({ message: 'query failed' })),
    } as unknown as ITableRepository;
    const handler = new GetDefaultViewIdHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      GetDefaultViewIdQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });
});
