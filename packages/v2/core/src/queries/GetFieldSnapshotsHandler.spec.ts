import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
import { FieldId } from '../domain/table/fields/FieldId';
import { FieldName } from '../domain/table/fields/FieldName';
import { FieldVersion } from '../domain/table/fields/FieldVersion';
import { Table } from '../domain/table/Table';
import { TableId } from '../domain/table/TableId';
import { TableName } from '../domain/table/TableName';
import { ViewId } from '../domain/table/views/ViewId';
import { ViewName } from '../domain/table/views/ViewName';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import { GetFieldSnapshotsHandler } from './GetFieldSnapshotsHandler';
import { GetFieldSnapshotsQuery } from './GetFieldSnapshotsQuery';

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
  const table = builder.build()._unsafeUnwrap();
  table.getFields()[0]!.setVersion(FieldVersion.rehydrate(3)._unsafeUnwrap())._unsafeUnwrap();
  table.getFields()[1]!.setVersion(FieldVersion.rehydrate(9)._unsafeUnwrap())._unsafeUnwrap();
  return table;
};

describe('GetFieldSnapshotsQuery', () => {
  it('validates every nominal ID and preserves an empty request', () => {
    const table = buildTable();
    const empty = GetFieldSnapshotsQuery.create({
      tableId: table.id().toString(),
      fieldIds: [],
    })._unsafeUnwrap();

    expect(empty.fieldIds).toEqual([]);
    expect(
      GetFieldSnapshotsQuery.create({
        tableId: table.id().toString(),
        fieldIds: ['invalid'],
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetFieldSnapshotsHandler', () => {
  it('returns requested Field children in request order with versions', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetFieldSnapshotsHandler(repository);
    const requestedIds = [
      table.getFields()[1]!.id().toString(),
      table.getFields()[0]!.id().toString(),
    ];

    const result = await handler.handle(
      context,
      GetFieldSnapshotsQuery.create({
        tableId: table.id().toString(),
        fieldIds: requestedIds,
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots.map((snapshot) => snapshot.id)).toEqual(requestedIds);
    expect(result._unsafeUnwrap().snapshots.map((snapshot) => snapshot.version)).toEqual([9, 3]);
  });

  it('returns an empty result without loading a Table', async () => {
    const handler = new GetFieldSnapshotsHandler(new MemoryTableRepository());

    const result = await handler.handle(
      context,
      GetFieldSnapshotsQuery.create({
        tableId: `tbl${'a'.repeat(16)}`,
        fieldIds: [],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots).toEqual([]);
  });

  it('omits missing fields and duplicate ids like v1 snapshot-bulk', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetFieldSnapshotsHandler(repository);
    const existingId = table.getFields()[0]!.id().toString();

    const result = await handler.handle(
      context,
      GetFieldSnapshotsQuery.create({
        tableId: table.id().toString(),
        fieldIds: [existingId, `fld${'z'.repeat(16)}`, existingId],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots.map((snapshot) => snapshot.id)).toEqual([existingId]);
  });

  it('omits fields without a persisted version instead of failing the bulk', async () => {
    const table = buildTable();
    table.getFields()[1]!.setVersion(FieldVersion.rehydrate(9)._unsafeUnwrap());
    const unversioned = Table.builder()
      .withBaseId(BaseId.create(`bse${'c'.repeat(16)}`)._unsafeUnwrap())
      .withId(TableId.create(`tbl${'c'.repeat(16)}`)._unsafeUnwrap())
      .withName(TableName.create('Unversioned')._unsafeUnwrap());
    unversioned
      .field()
      .singleLineText()
      .withId(FieldId.create(`fld${'c'.repeat(16)}`)._unsafeUnwrap())
      .withName(FieldName.create('Title')._unsafeUnwrap())
      .done();
    unversioned
      .view()
      .grid()
      .withId(ViewId.create(`viw${'c'.repeat(16)}`)._unsafeUnwrap())
      .withName(ViewName.create('Grid')._unsafeUnwrap())
      .done();
    const tableWithoutVersion = unversioned.build()._unsafeUnwrap();
    const repository = new MemoryTableRepository();
    await repository.insert(context, tableWithoutVersion);
    const handler = new GetFieldSnapshotsHandler(repository);

    const result = await handler.handle(
      context,
      GetFieldSnapshotsQuery.create({
        tableId: tableWithoutVersion.id().toString(),
        fieldIds: [tableWithoutVersion.getFields()[0]!.id().toString()],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots).toEqual([]);
  });

  it('returns an empty result when the Table is missing', async () => {
    const handler = new GetFieldSnapshotsHandler(new MemoryTableRepository());

    const result = await handler.handle(
      context,
      GetFieldSnapshotsQuery.create({
        tableId: `tbl${'z'.repeat(16)}`,
        fieldIds: [`fld${'z'.repeat(16)}`],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots).toEqual([]);
  });
});
