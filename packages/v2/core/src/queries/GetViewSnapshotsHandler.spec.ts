import { describe, expect, it } from 'vitest';

import { BaseId } from '../domain/base/BaseId';
import { ActorId } from '../domain/shared/ActorId';
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
import { ViewQueryDefaults } from '../domain/table/views/ViewQueryDefaults';
import { ViewVersion } from '../domain/table/views/ViewVersion';
import type { IExecutionContext } from '../ports/ExecutionContext';
import { MemoryTableRepository } from '../ports/memory/MemoryTableRepository';
import { GetViewSnapshotsHandler } from './GetViewSnapshotsHandler';
import { GetViewSnapshotsQuery } from './GetViewSnapshotsQuery';

const context: IExecutionContext = {
  actorId: ActorId.create('actor')._unsafeUnwrap(),
};
const fieldId = FieldId.create(`fld${'a'.repeat(16)}`)._unsafeUnwrap();

const createView = (suffix: string, version?: number) => {
  const view = GridView.create({
    id: ViewId.create(`viw${suffix.repeat(16)}`)._unsafeUnwrap(),
    name: ViewName.create(`View ${suffix}`)._unsafeUnwrap(),
  })._unsafeUnwrap();
  view
    .setColumnMeta(
      ViewColumnMeta.rehydrate({
        [fieldId.toString()]: { order: 0, width: 200 },
        [`fld${'z'.repeat(16)}`]: { order: 1, width: 300 },
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  view.setQueryDefaults(ViewQueryDefaults.rehydrate({})._unsafeUnwrap())._unsafeUnwrap();
  view
    .setAuditMetadata(
      ViewAuditMetadata.rehydrate({
        createdBy: 'actor',
        createdTime: '2026-07-29T00:00:00.000Z',
      })._unsafeUnwrap()
    )
    ._unsafeUnwrap();
  if (version !== undefined) {
    view.setVersion(ViewVersion.rehydrate(version)._unsafeUnwrap())._unsafeUnwrap();
  }
  return view;
};

const buildTable = (secondVersion: number | null = 9) => {
  const builder = Table.builder()
    .withBaseId(BaseId.create(`bse${'a'.repeat(16)}`)._unsafeUnwrap())
    .withId(TableId.create(`tbl${'a'.repeat(16)}`)._unsafeUnwrap())
    .withName(TableName.create('Snapshot table')._unsafeUnwrap());
  builder
    .field()
    .singleLineText()
    .withId(fieldId)
    .withName(FieldName.create('Title')._unsafeUnwrap())
    .done();
  builder.view().defaultGrid().done();
  const baseTable = builder.build()._unsafeUnwrap();

  return Table.rehydrate({
    id: baseTable.id(),
    baseId: baseTable.baseId(),
    name: baseTable.name(),
    fields: baseTable.getFields(),
    views: [createView('a', 3), createView('b', secondVersion ?? undefined)],
    primaryFieldId: baseTable.primaryFieldId(),
  })._unsafeUnwrap();
};

describe('GetViewSnapshotsQuery', () => {
  it('validates every nominal ID and preserves an empty request', () => {
    const table = buildTable();
    const empty = GetViewSnapshotsQuery.create({
      tableId: table.id().toString(),
      viewIds: [],
    })._unsafeUnwrap();

    expect(empty.viewIds).toEqual([]);
    expect(
      GetViewSnapshotsQuery.create({
        tableId: table.id().toString(),
        viewIds: ['invalid'],
      })._unsafeUnwrapErr().code
    ).toBe('validation.invalid');
  });
});

describe('GetViewSnapshotsHandler', () => {
  it('returns requested View children in request order with versions and sanitized metadata', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetViewSnapshotsHandler(repository);
    const requestedIds = [table.views()[1].id().toString(), table.views()[0].id().toString()];

    const result = await handler.handle(
      context,
      GetViewSnapshotsQuery.create({
        tableId: table.id().toString(),
        viewIds: requestedIds,
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots).toMatchObject([
      {
        id: requestedIds[0],
        version: 9,
        view: {
          id: requestedIds[0],
          version: 9,
          columnMeta: { [fieldId.toString()]: { order: 0, width: 200 } },
        },
      },
      {
        id: requestedIds[1],
        version: 3,
        view: {
          id: requestedIds[1],
          version: 3,
          columnMeta: { [fieldId.toString()]: { order: 0, width: 200 } },
        },
      },
    ]);
  });

  it('returns an empty result without loading a Table', async () => {
    const handler = new GetViewSnapshotsHandler(new MemoryTableRepository());

    const result = await handler.handle(
      context,
      GetViewSnapshotsQuery.create({
        tableId: `tbl${'a'.repeat(16)}`,
        viewIds: [],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrap().snapshots).toEqual([]);
  });

  it('rejects missing and duplicate child IDs with the legacy not-found semantics', async () => {
    const table = buildTable();
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetViewSnapshotsHandler(repository);
    const existingId = table.views()[0].id().toString();

    const missing = await handler.handle(
      context,
      GetViewSnapshotsQuery.create({
        tableId: table.id().toString(),
        viewIds: [existingId, `viw${'z'.repeat(16)}`],
      })._unsafeUnwrap()
    );
    const duplicate = await handler.handle(
      context,
      GetViewSnapshotsQuery.create({
        tableId: table.id().toString(),
        viewIds: [existingId, existingId],
      })._unsafeUnwrap()
    );

    expect(missing._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      message: `View not found: viw${'z'.repeat(16)}`,
    });
    expect(duplicate._unsafeUnwrapErr()).toMatchObject({
      code: 'view.not_found',
      message: `Duplicate view ids requested: ${existingId}`,
    });
  });

  it('fails when persisted View version metadata is unavailable', async () => {
    const table = buildTable(null);
    const repository = new MemoryTableRepository();
    await repository.insert(context, table);
    const handler = new GetViewSnapshotsHandler(repository);

    const result = await handler.handle(
      context,
      GetViewSnapshotsQuery.create({
        tableId: table.id().toString(),
        viewIds: [table.views()[1].id().toString()],
      })._unsafeUnwrap()
    );

    expect(result._unsafeUnwrapErr().message).toBe('ViewVersion not set');
  });
});
