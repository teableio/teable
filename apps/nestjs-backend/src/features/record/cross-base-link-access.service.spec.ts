import { ForbiddenException } from '@nestjs/common';
import { APP_ROBOT_ID } from '@teable/core';
import type { ClsService } from 'nestjs-cls';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { CrossBaseLinkAccessService } from './cross-base-link-access.service';

const HOST_TABLE_ID = `tbl${'h'.repeat(16)}`;
const FOREIGN_TABLE_ID = `tbl${'f'.repeat(16)}`;
const OTHER_FOREIGN_TABLE_ID = `tbl${'o'.repeat(16)}`;
const HOST_BASE_ID = `bse${'h'.repeat(16)}`;
const FOREIGN_BASE_ID = `bse${'f'.repeat(16)}`;
const CALLER_ID = `usr${'c'.repeat(16)}`;
const ACCESS_TOKEN_ID = `tkn${'a'.repeat(16)}`;

type LinkFieldRow = {
  id: string;
  name: string;
  dbFieldName: string;
  options: string | null;
  isLookup: boolean | null;
};

const buildService = (
  options: {
    userId?: string | undefined;
    clsValues?: Record<string, unknown>;
    tableMeta?: Array<{ id: string; baseId: string }>;
    linkFields?: LinkFieldRow[];
    validPermissions?: Mock;
  } = {}
) => {
  const fieldFindMany = vi.fn().mockResolvedValue(options.linkFields ?? []);
  const tableMetaFindMany = vi.fn().mockResolvedValue(options.tableMeta ?? []);
  const validPermissions = options.validPermissions ?? vi.fn().mockResolvedValue(['record|read']);
  const clsValues: Record<string, unknown> = {
    'user.id': 'userId' in options ? options.userId : CALLER_ID,
    accessTokenId: ACCESS_TOKEN_ID,
    ...options.clsValues,
  };
  const cls = { get: (key: string) => clsValues[key] } as unknown as ClsService;
  const service = new CrossBaseLinkAccessService(
    {
      txClient: () => ({
        field: { findMany: fieldFindMany },
        tableMeta: { findMany: tableMetaFindMany },
      }),
    } as never,
    { validPermissions } as never,
    cls
  );
  return { service, fieldFindMany, tableMetaFindMany, validPermissions };
};

describe('CrossBaseLinkAccessService', () => {
  it('validates record|read on a foreign table from another base', async () => {
    const { service, validPermissions } = buildService({
      tableMeta: [
        { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
        { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      ],
    });

    await service.assertForeignTableReadable(HOST_TABLE_ID, FOREIGN_TABLE_ID);

    expect(validPermissions).toHaveBeenCalledTimes(1);
    expect(validPermissions).toHaveBeenCalledWith(
      FOREIGN_TABLE_ID,
      ['record|read'],
      ACCESS_TOKEN_ID
    );
  });

  it('propagates the foreign-table rejection to the caller', async () => {
    const rejection = new Error('not allowed to operate record|read');
    const { service } = buildService({
      tableMeta: [
        { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
        { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      ],
      validPermissions: vi.fn().mockRejectedValue(rejection),
    });

    await expect(service.assertForeignTableReadable(HOST_TABLE_ID, FOREIGN_TABLE_ID)).rejects.toBe(
      rejection
    );
  });

  it.each([
    ['a foreign table in the same base', { id: FOREIGN_TABLE_ID, baseId: HOST_BASE_ID }],
    ['the host table itself', { id: HOST_TABLE_ID, baseId: HOST_BASE_ID }],
  ])('skips the permission check for %s', async (_label, extraTableMeta) => {
    const { service, validPermissions } = buildService({
      tableMeta: [{ id: HOST_TABLE_ID, baseId: HOST_BASE_ID }, extraTableMeta],
    });

    await service.assertForeignTableReadable(HOST_TABLE_ID, extraTableMeta.id);

    expect(validPermissions).not.toHaveBeenCalled();
  });

  it('leaves a missing foreign table to the caller not-found handling', async () => {
    const { service, validPermissions } = buildService({
      tableMeta: [{ id: HOST_TABLE_ID, baseId: HOST_BASE_ID }],
    });

    await service.assertForeignTableReadable(HOST_TABLE_ID, FOREIGN_TABLE_ID);

    expect(validPermissions).not.toHaveBeenCalled();
  });

  it.each([
    ['an internal job without a user', undefined],
    ['an app robot token', APP_ROBOT_ID],
  ])('skips both the query and the check for %s', async (_label, userId) => {
    const { service, tableMetaFindMany, validPermissions } = buildService({
      userId,
      tableMeta: [
        { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
        { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      ],
    });

    await service.assertForeignTableReadable(HOST_TABLE_ID, FOREIGN_TABLE_ID);

    expect(validPermissions).not.toHaveBeenCalled();
    expect(tableMetaFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ['a temp-auth base context', 'tempAuthBaseId'],
    ['a share view', 'shareViewId'],
  ])('skips principals scoped by %s', async (_label, clsKey) => {
    const { service, validPermissions } = buildService({
      clsValues: { [clsKey]: 'scoped-value' },
      tableMeta: [
        { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
        { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      ],
    });

    await service.assertForeignTableReadable(HOST_TABLE_ID, FOREIGN_TABLE_ID);

    expect(validPermissions).not.toHaveBeenCalled();
  });

  it('checks only the written link fields and ignores lookups and untouched links', async () => {
    const writtenLinkField: LinkFieldRow = {
      id: `fld${'w'.repeat(16)}`,
      name: 'Written Link',
      dbFieldName: 'col_written_link',
      // The client-supplied baseId claims the host base; the check must trust
      // the table row instead, which places the target in another base.
      options: JSON.stringify({ foreignTableId: FOREIGN_TABLE_ID, baseId: HOST_BASE_ID }),
      isLookup: null,
    };
    const untouchedLinkField: LinkFieldRow = {
      id: `fld${'u'.repeat(16)}`,
      name: 'Untouched Link',
      dbFieldName: 'col_untouched_link',
      options: JSON.stringify({ foreignTableId: OTHER_FOREIGN_TABLE_ID }),
      isLookup: null,
    };
    const lookupField: LinkFieldRow = {
      id: writtenLinkField.id,
      name: writtenLinkField.name,
      dbFieldName: writtenLinkField.dbFieldName,
      options: JSON.stringify({ foreignTableId: OTHER_FOREIGN_TABLE_ID }),
      isLookup: true,
    };
    const { service, validPermissions } = buildService({
      linkFields: [writtenLinkField, untouchedLinkField, lookupField],
      tableMeta: [
        { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
        { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
        { id: OTHER_FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      ],
    });

    await service.assertForeignTablesReadable(HOST_TABLE_ID, [writtenLinkField.id]);

    expect(validPermissions).toHaveBeenCalledTimes(1);
    expect(validPermissions).toHaveBeenCalledWith(
      FOREIGN_TABLE_ID,
      ['record|read'],
      ACCESS_TOKEN_ID
    );
  });
  describe('readableForeignTableIds', () => {
    const SAME_BASE_TABLE_ID = `tbl${'s'.repeat(16)}`;
    const tableMeta = [
      { id: HOST_TABLE_ID, baseId: HOST_BASE_ID },
      { id: SAME_BASE_TABLE_ID, baseId: HOST_BASE_ID },
      { id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
      { id: OTHER_FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID },
    ];
    const candidates = [SAME_BASE_TABLE_ID, FOREIGN_TABLE_ID, OTHER_FOREIGN_TABLE_ID];

    it('keeps the host base and the foreign tables the caller can read, and drops the rest', async () => {
      const validPermissions = vi.fn(async (tableId: string) => {
        if (tableId === OTHER_FOREIGN_TABLE_ID) {
          throw new ForbiddenException('not allowed to operate record|read');
        }
        return ['record|read'];
      });
      const { service } = buildService({ tableMeta, validPermissions });

      const readable = await service.readableForeignTableIds(HOST_TABLE_ID, candidates);

      expect([...readable]).toEqual([SAME_BASE_TABLE_ID, FOREIGN_TABLE_ID]);
      expect(validPermissions).toHaveBeenCalledTimes(2);
      expect(validPermissions).toHaveBeenCalledWith(
        FOREIGN_TABLE_ID,
        ['record|read'],
        ACCESS_TOKEN_ID
      );
      expect(validPermissions).not.toHaveBeenCalledWith(
        SAME_BASE_TABLE_ID,
        expect.anything(),
        expect.anything()
      );
    });

    it('places a trashed table in its base as well', async () => {
      const { service, tableMetaFindMany } = buildService({ tableMeta });

      await service.readableForeignTableIds(HOST_TABLE_ID, candidates);

      expect(tableMetaFindMany.mock.calls[0][0].where).toEqual({
        id: { in: [HOST_TABLE_ID, ...candidates] },
      });
    });

    it('leaves out a table that cannot be placed in a base', async () => {
      const { service, validPermissions } = buildService({
        tableMeta: [{ id: HOST_TABLE_ID, baseId: HOST_BASE_ID }],
      });

      const readable = await service.readableForeignTableIds(HOST_TABLE_ID, [FOREIGN_TABLE_ID]);

      expect(readable.size).toBe(0);
      expect(validPermissions).not.toHaveBeenCalled();
    });

    it('returns nothing when the host table itself is unknown', async () => {
      const { service } = buildService({
        tableMeta: [{ id: FOREIGN_TABLE_ID, baseId: FOREIGN_BASE_ID }],
      });

      const readable = await service.readableForeignTableIds(HOST_TABLE_ID, [FOREIGN_TABLE_ID]);

      expect(readable.size).toBe(0);
    });

    it('does not turn an infrastructure failure into a refusal', async () => {
      const failure = new Error('connection terminated');
      const { service } = buildService({
        tableMeta,
        validPermissions: vi.fn().mockRejectedValue(failure),
      });

      await expect(service.readableForeignTableIds(HOST_TABLE_ID, candidates)).rejects.toBe(
        failure
      );
    });

    it.each([
      ['an internal job without a user', { userId: undefined }],
      ['a robot', { userId: APP_ROBOT_ID }],
      ['a base-scoped token', { clsValues: { tempAuthBaseId: HOST_BASE_ID } }],
      ['a share view', { clsValues: { shareViewId: 'shrShareView' } }],
    ])('keeps everything for %s, whose reach is decided elsewhere', async (_label, options) => {
      const { service, tableMetaFindMany, validPermissions } = buildService({
        tableMeta,
        validPermissions: vi.fn().mockRejectedValue(new ForbiddenException()),
        ...options,
      });

      const readable = await service.readableForeignTableIds(HOST_TABLE_ID, candidates);

      expect([...readable]).toEqual(candidates);
      expect(tableMetaFindMany).not.toHaveBeenCalled();
      expect(validPermissions).not.toHaveBeenCalled();
    });
  });
});
