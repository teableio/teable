import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewId } from '../domain/table/views/ViewId';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRecordQueryRepository } from '../ports/TableRecordQueryRepository';
import { GetViewLinkRecordsHandler } from './GetViewLinkRecordsHandler';
import { GetViewLinkRecordsQuery } from './GetViewLinkRecordsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};
const id = (prefix: 'bse' | 'tbl' | 'fld' | 'viw', seed: string) => `${prefix}${seed.repeat(16)}`;

const buildTable = () => {
  const tableId = TableId.create(id('tbl', 't'))._unsafeUnwrap();
  const foreignTableId = TableId.create(id('tbl', 'f'))._unsafeUnwrap();
  const primaryFieldId = FieldId.create(id('fld', 'p'))._unsafeUnwrap();
  const lookupFieldId = FieldId.create(id('fld', 'l'))._unsafeUnwrap();
  const linkFieldId = FieldId.create(id('fld', 'k'))._unsafeUnwrap();
  const viewId = ViewId.create(id('viw', 'v'))._unsafeUnwrap();
  const targetBuilder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(foreignTableId)
    .withName(TableName.create('Target')._unsafeUnwrap());
  targetBuilder
    .field()
    .singleLineText()
    .withId(lookupFieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .primary()
    .done();
  targetBuilder.view().defaultGrid().done();
  const targetTable = targetBuilder.build()._unsafeUnwrap();

  const builder = Table.builder()
    .withBaseId(BaseId.create(id('bse', 'b'))._unsafeUnwrap())
    .withId(tableId)
    .withName(TableName.create('Host')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(primaryFieldId)
    .withName(FieldName.create('Name')._unsafeUnwrap())
    .primary()
    .done();
  builder
    .field()
    .link()
    .withId(linkFieldId)
    .withName(FieldName.create('Link')._unsafeUnwrap())
    .withConfig(
      LinkFieldConfig.create({
        relationship: 'manyOne',
        foreignTableId: foreignTableId.toString(),
        lookupFieldId: lookupFieldId.toString(),
        isOneWay: true,
      })._unsafeUnwrap()
    )
    .done();
  builder.view().plugin().withId(viewId).defaultName().done();
  return {
    table: builder.build()._unsafeUnwrap(),
    targetTable,
    tableId,
    viewId,
    linkFieldId,
    foreignTableId,
  };
};

const recordRepository: ITableRecordQueryRepository = {
  find: async () =>
    ok({
      records: [{ id: `rec${'r'.repeat(16)}`, fields: { [id('fld', 'l')]: 'Alpha' }, version: 1 }],
      total: 1,
    }),
  findOne: async () => err(new Error('not used') as never),
  async *findStream() {},
};

describe('GetViewLinkRecordsQuery', () => {
  it('validates aggregate identifiers and request mode', () => {
    expect(
      GetViewLinkRecordsQuery.create({
        tableId: 'invalid',
        viewId: 'invalid',
        fieldId: 'invalid',
        requestType: 'other',
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });

  it('defaults take when only skip is provided and rejects invalid windows', () => {
    const fixture = buildTable();
    const query = GetViewLinkRecordsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.linkFieldId.toString(),
      skip: 5,
    })._unsafeUnwrap();

    expect(query.pagination.limit().toNumber()).toBe(100);
    expect(query.pagination.offset().toNumber()).toBe(5);
    expect(
      GetViewLinkRecordsQuery.create({
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        fieldId: fixture.linkFieldId.toString(),
        take: 1001,
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
    expect(
      GetViewLinkRecordsQuery.create({
        tableId: fixture.tableId.toString(),
        viewId: fixture.viewId.toString(),
        fieldId: fixture.linkFieldId.toString(),
        skip: -1,
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetViewLinkRecordsHandler', () => {
  it('loads the owning Table and returns its domain query plan', async () => {
    const fixture = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, fixture.table);
    await repository.insert(context, fixture.targetTable);
    const handler = new GetViewLinkRecordsHandler(repository, recordRepository);
    const query = GetViewLinkRecordsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.linkFieldId.toString(),
      requestType: 'candidate',
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrap().records).toEqual([
      { id: `rec${'r'.repeat(16)}`, title: 'Alpha' },
    ]);
  });

  it('maps a missing partial aggregate to View not found', async () => {
    const fixture = buildTable();
    const handler = new GetViewLinkRecordsHandler(new MemoryTableRepository(), recordRepository);
    const query = GetViewLinkRecordsQuery.create({
      tableId: fixture.tableId.toString(),
      viewId: fixture.viewId.toString(),
      fieldId: fixture.linkFieldId.toString(),
    })._unsafeUnwrap();

    expect((await handler.handle(context, query))._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      tags: ['not-found'],
    });
  });
});
