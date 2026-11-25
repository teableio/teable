import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { TableRecord } from '../domain/table/records/TableRecord';
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
const unknownActorAttribution = {
  createdByActorType: null,
  createdByActorId: null,
  lastModifiedByActorType: null,
  lastModifiedByActorId: null,
} as const;

const buildTable = (linkFilter?: unknown) => {
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
  targetBuilder
    .field()
    .user()
    .withId(FieldId.create(id('fld', 'o'))._unsafeUnwrap())
    .withName(FieldName.create('Owner')._unsafeUnwrap())
    .done();
  targetBuilder
    .field()
    .singleLineText()
    .withId(FieldId.create(id('fld', 'a'))._unsafeUnwrap())
    .withName(FieldName.create('Alias')._unsafeUnwrap())
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
        ...(linkFilter ? { filter: linkFilter } : {}),
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

const targetRecords = [
  {
    id: `rec${'a'.repeat(16)}`,
    fields: {
      [id('fld', 'l')]: 'Alpha',
      [id('fld', 'a')]: 'Alpha',
      [id('fld', 'o')]: { id: 'usrAnn', title: 'Ann' },
    },
    version: 1,
    ...unknownActorAttribution,
  },
  {
    id: `rec${'b'.repeat(16)}`,
    fields: {
      [id('fld', 'l')]: 'Beta',
      [id('fld', 'a')]: 'Other',
      [id('fld', 'o')]: { id: 'usrBob', title: 'Bob' },
    },
    version: 1,
    ...unknownActorAttribution,
  },
];

// Evaluates the condition spec in memory, so a test sees which records a filter really keeps.
const recordRepository: ITableRecordQueryRepository = {
  find: async (_context, table, spec) => {
    const records = targetRecords.filter(
      (record) =>
        !spec ||
        spec.isSatisfiedBy(
          TableRecord.fromRawFieldValues({
            id: record.id,
            tableId: table.id(),
            fields: record.fields,
          })._unsafeUnwrap()
        )
    );
    return ok({ records, total: records.length });
  },
  findOne: async () => err(new Error('not used') as never),
  async *findStream() {},
};

const listCandidateTitles = async (linkFilter: unknown, actor = context) => {
  const fixture = buildTable(linkFilter);
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
  return (await handler.handle(actor, query)).map((result) =>
    result.records.map((record) => record.title)
  );
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
    expect((await listCandidateTitles(undefined))._unsafeUnwrap()).toEqual(['Alpha', 'Beta']);
  });

  // A Link Field filter keeps whatever the editor saved: a condition still waiting for its
  // value, or one on a Field deleted since. Like v1, those are dropped, not a failed request.
  it.each([
    ['a condition without a value', { fieldId: id('fld', 'l'), operator: 'contains', value: null }],
    ['a condition on a deleted Field', { fieldId: id('fld', 'x'), operator: 'is', value: 'Alpha' }],
    [
      'a reference to a deleted Field',
      { fieldId: id('fld', 'a'), operator: 'is', value: id('fld', 'x'), isSymbol: true },
    ],
  ])('drops %s from the Link Field filter and keeps the rest', async (_name, broken) => {
    const titles = await listCandidateTitles({
      conjunction: 'and',
      filterSet: [{ fieldId: id('fld', 'l'), operator: 'is', value: 'Alpha' }, broken],
    });

    expect(titles._unsafeUnwrap()).toEqual(['Alpha']);
  });

  it.each([
    [
      'isSymbol',
      { fieldId: id('fld', 'l'), operator: 'is', value: id('fld', 'a'), isSymbol: true },
    ],
    [
      'a field value',
      {
        fieldId: id('fld', 'l'),
        operator: 'is',
        value: { type: 'field', fieldId: id('fld', 'a') },
      },
    ],
  ])('compares against another target Field referenced by %s', async (_name, condition) => {
    const titles = await listCandidateTitles({ conjunction: 'and', filterSet: [condition] });

    expect(titles._unsafeUnwrap()).toEqual(['Alpha']);
  });

  // An anonymous share reader is `anonymous`: `Owner is Me` must stay in the query and match
  // no one. Dropping it as unusable would hand the reader every candidate record.
  it.each([
    ['the signed-in reader', 'usrAnn', ['Alpha']],
    ['an anonymous reader', 'anonymous', []],
  ])('resolves a Me condition to %s', async (_name, actorId, expected) => {
    const titles = await listCandidateTitles(
      { conjunction: 'and', filterSet: [{ fieldId: id('fld', 'o'), operator: 'is', value: 'Me' }] },
      { actorId: ActorId.create(actorId)._unsafeUnwrap() }
    );

    expect(titles._unsafeUnwrap()).toEqual(expected);
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
