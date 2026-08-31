import { err, ok } from 'neverthrow';
import { FieldId, FieldType, TableByIdSpec, TableId, ViewId, v2CoreTokens } from '@teable/v2-core';
import { v2MetaDbTokens } from '@teable/v2-adapter-db-postgres-pg';
import { describe, expect, it, vi } from 'vitest';
import { SharedViewAccessV2Service } from './shared-view-access-v2.service';

/* eslint-disable @typescript-eslint/naming-convention */
const createFixture = (identity?: { id: string; table_id: string }) => {
  const query = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst: vi.fn().mockResolvedValue(identity),
  };
  query.select.mockReturnValue(query);
  query.where.mockReturnValue(query);
  const db = {
    selectFrom: vi.fn().mockReturnValue(query),
  };
  const resolve = vi.fn().mockReturnValue(db);
  const v2ContainerService = {
    getContainer: vi.fn().mockResolvedValue({ resolve }),
  };
  const viewOpenApiV2Service = {
    getView: vi.fn(),
  };
  const service = new SharedViewAccessV2Service(
    v2ContainerService as never,
    viewOpenApiV2Service as never
  );
  return { service, db, query, resolve, viewOpenApiV2Service };
};

describe('SharedViewAccessV2Service', () => {
  it('resolves aggregate identity with Kysely and loads the View through Table', async () => {
    const fixture = createFixture({ id: 'viwShared', table_id: 'tblShared' });
    fixture.viewOpenApiV2Service.getView.mockResolvedValue({
      id: 'viwShared',
      enableShare: true,
      shareId: 'shrShared',
      shareMeta: { includeRecords: true },
    });

    await expect(fixture.service.findByShareId('shrShared')).resolves.toEqual({
      shareId: 'shrShared',
      tableId: 'tblShared',
      view: expect.objectContaining({ id: 'viwShared' }),
      shareMeta: { includeRecords: true },
    });

    expect(fixture.resolve).toHaveBeenCalledWith(v2MetaDbTokens.db);
    expect(fixture.db.selectFrom).toHaveBeenCalledWith('view');
    expect(fixture.query.where).toHaveBeenNthCalledWith(1, 'share_id', '=', 'shrShared');
    expect(fixture.query.where).toHaveBeenNthCalledWith(2, 'enable_share', '=', true);
    expect(fixture.query.where).toHaveBeenNthCalledWith(3, 'deleted_time', 'is', null);
    expect(fixture.viewOpenApiV2Service.getView).toHaveBeenCalledWith(
      'tblShared',
      'viwShared',
      expect.objectContaining({ actorId: expect.anything() })
    );
  });

  it('returns undefined without loading a Table when the active share index misses', async () => {
    const fixture = createFixture();

    await expect(fixture.service.findByShareId('shrMissing')).resolves.toBeUndefined();
    expect(fixture.viewOpenApiV2Service.getView).not.toHaveBeenCalled();
  });

  it.each([
    { enableShare: false, shareId: 'shrShared' },
    { enableShare: true, shareId: 'shrRotated' },
  ])('rejects stale aggregate share state: %j', async (view) => {
    const fixture = createFixture({ id: 'viwShared', table_id: 'tblShared' });
    fixture.viewOpenApiV2Service.getView.mockResolvedValue({
      id: 'viwShared',
      ...view,
    });

    await expect(fixture.service.findByShareId('shrShared')).resolves.toBeUndefined();
  });
});

const hostTableId = `tbl${'h'.repeat(16)}`;
const middleTableId = `tbl${'m'.repeat(16)}`;
const targetTableId = `tbl${'t'.repeat(16)}`;
const linkFieldId = `fld${'a'.repeat(16)}`;
const lookupFieldId = `fld${'b'.repeat(16)}`;
const innerLinkFieldId = `fld${'c'.repeat(16)}`;
const filterByViewId = `viw${'v'.repeat(16)}`;

const createLinkField = (params: { foreignTableId: string; filterByViewId?: string }) => ({
  type: () => FieldType.link(),
  foreignTableId: () => TableId.create(params.foreignTableId)._unsafeUnwrap(),
  filterByViewId: () =>
    params.filterByViewId ? ViewId.create(params.filterByViewId)._unsafeUnwrap() : undefined,
  visibleFieldIds: () => undefined,
  config: () => ({ filter: () => undefined }),
});

const createLookupField = (innerFieldId: string) => ({
  type: () => FieldType.lookup(),
  lookupFieldId: () => FieldId.create(innerFieldId)._unsafeUnwrap(),
});

const createTableStub = (tableId: string, field: unknown) => ({
  id: () => TableId.create(tableId)._unsafeUnwrap(),
  getField: () => ok(field),
});

const createLinkShareFixture = (params: {
  fieldTableIds: Record<string, string>;
  tables: Record<string, { getField: () => unknown; id: () => unknown }>;
}) => {
  let fieldId: string | undefined;
  const query = {
    select: vi.fn(),
    where: vi.fn(),
    executeTakeFirst: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.where.mockImplementation((column: string, _op: string, value: unknown) => {
    if (column === 'id') fieldId = value as string;
    return query;
  });
  query.executeTakeFirst.mockImplementation(async () => {
    const tableId = fieldId ? params.fieldTableIds[fieldId] : undefined;
    return tableId ? { table_id: tableId } : undefined;
  });
  const db = {
    selectFrom: vi.fn().mockReturnValue(query),
  };
  const findOne = vi.fn(async (_context: unknown, spec: unknown) => {
    if (!(spec instanceof TableByIdSpec)) {
      return err({ message: 'unexpected spec' });
    }
    const table = params.tables[spec.tableId().toString()];
    return table ? ok(table) : err({ message: 'not found' });
  });
  const resolve = vi.fn((token: unknown) => {
    if (token === v2MetaDbTokens.db) return db;
    if (token === v2CoreTokens.tableRepository) return { findOne };
    return undefined;
  });
  const service = new SharedViewAccessV2Service(
    { getContainer: vi.fn().mockResolvedValue({ resolve }) } as never,
    { getView: vi.fn() } as never
  );
  return { service, db, query, findOne, resolve };
};

describe('SharedViewAccessV2Service.findLinkShareTarget', () => {
  it('loads the whole Table then reads the Link Field child', async () => {
    const fixture = createLinkShareFixture({
      fieldTableIds: { [linkFieldId]: hostTableId },
      tables: {
        [hostTableId]: createTableStub(
          hostTableId,
          createLinkField({ foreignTableId: targetTableId, filterByViewId })
        ),
      },
    });

    await expect(fixture.service.findLinkShareTarget(linkFieldId)).resolves.toEqual({
      hostTableId,
      tableId: targetTableId,
      linkOptions: { filterByViewId, visibleFieldIds: undefined, filter: undefined },
    });
    expect(fixture.db.selectFrom).toHaveBeenCalledWith('field');
    expect(fixture.query.select).toHaveBeenCalledWith('table_id');
    expect(fixture.findOne).toHaveBeenCalledTimes(1);
    expect(fixture.findOne.mock.calls[0]?.[1]).toBeInstanceOf(TableByIdSpec);
  });

  it('walks lookup-of-link Fields after loading each host Table', async () => {
    const fixture = createLinkShareFixture({
      fieldTableIds: {
        [lookupFieldId]: hostTableId,
        [innerLinkFieldId]: middleTableId,
      },
      tables: {
        [hostTableId]: createTableStub(hostTableId, createLookupField(innerLinkFieldId)),
        [middleTableId]: createTableStub(
          middleTableId,
          createLinkField({ foreignTableId: targetTableId, filterByViewId })
        ),
      },
    });

    await expect(fixture.service.findLinkShareTarget(lookupFieldId)).resolves.toEqual({
      hostTableId,
      tableId: targetTableId,
      linkOptions: { filterByViewId, visibleFieldIds: undefined, filter: undefined },
    });
    expect(fixture.findOne).toHaveBeenCalledTimes(2);
    expect(fixture.findOne.mock.calls[0]?.[1]).toBeInstanceOf(TableByIdSpec);
    expect(fixture.findOne.mock.calls[1]?.[1]).toBeInstanceOf(TableByIdSpec);
  });
});
