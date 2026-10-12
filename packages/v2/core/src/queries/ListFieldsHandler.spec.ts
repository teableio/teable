import { err } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { domainError } from '../domain/shared/DomainError';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { LinkFieldConfig } from '../domain/table/fields/types/LinkFieldConfig';
import { LookupOptions } from '../domain/table/fields/types/LookupOptions';
import { SingleLineTextField } from '../domain/table/fields/types/SingleLineTextField';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import { NoopLogger } from '../ports/defaults/NoopLogger';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import type { ITableRepository } from '../ports/TableRepository';
import { ListFieldsHandler } from './ListFieldsHandler';
import { ListFieldsQuery } from './ListFieldsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
};

const buildTable = () => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Fields')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .done();
  builder
    .field()
    .number()
    .withId(FieldId.create(`fld${'b'.repeat(16)}`)._unsafeUnwrap())
    .withName(FieldName.create('Amount')._unsafeUnwrap())
    .done();
  builder
    .view()
    .grid()
    .withId(ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(ViewName.create('Grid')._unsafeUnwrap())
    .done();
  return builder.build()._unsafeUnwrap();
};

describe('ListFieldsQuery', () => {
  it('creates Table and optional View IDs', () => {
    const table = buildTable();
    const query = ListFieldsQuery.create({
      tableId: table.id().toString(),
      viewId: table.views()[0].id().toString(),
    })._unsafeUnwrap();

    expect(query.tableId.equals(table.id())).toBe(true);
    expect(query.viewId?.equals(table.views()[0].id())).toBe(true);
  });

  it('creates optional Field id hydration', () => {
    const table = buildTable();
    const fieldId = table.getFields()[1]!.id();
    const query = ListFieldsQuery.create({
      tableId: table.id().toString(),
      fieldIds: [fieldId.toString()],
    })._unsafeUnwrap();

    expect(query.fieldIds?.map((id) => id.toString())).toEqual([fieldId.toString()]);
  });

  it.each([
    undefined,
    {},
    { tableId: 'invalid' },
    { tableId: `tbl${'a'.repeat(16)}`, viewId: 'invalid' },
    { tableId: `tbl${'a'.repeat(16)}`, fieldIds: ['invalid'] },
  ])('rejects invalid input: %j', (input) => {
    expect(ListFieldsQuery.create(input)._unsafeUnwrapErr().code).toBe('validation.invalid');
  });
});

describe('ListFieldsHandler', () => {
  it('returns Field children, primary identity, and only the requested View context', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListFieldsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListFieldsQuery.create({
        tableId: table.id().toString(),
        viewId: table.views()[0].id().toString(),
      })._unsafeUnwrap()
    );

    const value = result._unsafeUnwrap();
    expect(value.fields.map((field) => field.id().toString())).toEqual([
      `fld${'a'.repeat(16)}`,
      `fld${'b'.repeat(16)}`,
    ]);
    expect(value.primaryFieldId.toString()).toBe(`fld${'a'.repeat(16)}`);
    expect(value.view?.id().toString()).toBe(`viw${'a'.repeat(16)}`);
  });

  it('returns fields without loading a requested View context', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListFieldsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListFieldsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().view).toBeUndefined();
  });

  it('returns only requested Field children while keeping primary identity', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListFieldsHandler(repository, new NoopLogger());
    const fieldId = table.getFields()[1]!.id();

    const result = await handler.handle(
      context,
      ListFieldsQuery.create({
        tableId: table.id().toString(),
        fieldIds: [fieldId.toString()],
      })._unsafeUnwrap()
    );

    const value = result._unsafeUnwrap();
    expect(value.fields.map((field) => field.id().toString())).toEqual([fieldId.toString()]);
    expect(value.primaryFieldId.toString()).toBe(`fld${'a'.repeat(16)}`);
  });

  it('keeps the host Link field when hydrating a requested Lookup field', async () => {
    const primaryId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();
    const linkId = FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap();
    const lookupId = FieldId.create(`fld${'d'.repeat(16)}`)._unsafeUnwrap();
    const foreignTableId = TableId.create(`tbl${'b'.repeat(16)}`)._unsafeUnwrap();
    const foreignLookupId = FieldId.create(`fld${'e'.repeat(16)}`)._unsafeUnwrap();
    const builder = Table.builder()
      .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
      .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Lookup Host')._unsafeUnwrap());
    builder
      .field()
      .singleLineText()
      .withId(primaryId)
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .primary()
      .done();
    builder
      .field()
      .link()
      .withId(linkId)
      .withName(FieldName.create('Link')._unsafeUnwrap())
      .withConfig(
        LinkFieldConfig.create({
          relationship: 'manyMany',
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignLookupId.toString(),
        })._unsafeUnwrap()
      )
      .done();
    builder
      .field()
      .lookup()
      .withId(lookupId)
      .withName(FieldName.create('Lookup')._unsafeUnwrap())
      .withInnerField(
        SingleLineTextField.create({
          id: FieldId.create(`fld${'f'.repeat(16)}`)._unsafeUnwrap(),
          name: FieldName.create('Inner')._unsafeUnwrap(),
        })._unsafeUnwrap()
      )
      .withLookupOptions(
        LookupOptions.create({
          linkFieldId: linkId.toString(),
          foreignTableId: foreignTableId.toString(),
          lookupFieldId: foreignLookupId.toString(),
        })._unsafeUnwrap()
      )
      .withIsMultipleCellValue(false)
      .done();
    builder
      .view()
      .grid()
      .withId(ViewId.create(`viw${'a'.repeat(16)}`)._unsafeUnwrap())
      .withName(ViewName.create('Grid')._unsafeUnwrap())
      .done();
    const table = builder.build()._unsafeUnwrap();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListFieldsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListFieldsQuery.create({
        tableId: table.id().toString(),
        fieldIds: [lookupId.toString()],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().fields.map((field) => field.id().toString())).toEqual([
      linkId.toString(),
      lookupId.toString(),
    ]);
  });

  it('distinguishes a missing requested View from a missing Table', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new ListFieldsHandler(repository, new NoopLogger());

    const missingView = await handler.handle(
      context,
      ListFieldsQuery.create({
        tableId: table.id().toString(),
        viewId: `viw${'z'.repeat(16)}`,
      })._unsafeUnwrap()
    );
    const missingTable = await new ListFieldsHandler(
      new MemoryTableRepository(),
      new NoopLogger()
    ).handle(context, ListFieldsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap());

    expect(missingView._unsafeUnwrapErr().code).toBe('view.not_found');
    expect(missingTable._unsafeUnwrapErr().code).toBe('table.not_found');
  });

  it('propagates unexpected repository errors', async () => {
    const table = buildTable();
    const repository = {
      findOne: async () => err(domainError.unexpected({ message: 'query failed' })),
    } as unknown as ITableRepository;
    const handler = new ListFieldsHandler(repository, new NoopLogger());

    const result = await handler.handle(
      context,
      ListFieldsQuery.create({ tableId: table.id().toString() })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('query failed');
  });
});
