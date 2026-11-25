import { IdPrefix } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';

import { RawOpType } from '../../share-db/interface';
import { TableSnapshotReadService } from './table-snapshot-read.service';
import { TableService } from './table.service';

describe('TableService actor metadata publication', () => {
  it('uses the existing Table Edit baseline without rewriting committed capability or creating a table', () => {
    const rawMap = { ['tbl_bseTest']: {} };
    const saveRawOps = vi.fn().mockReturnValue(rawMap);
    const service = new TableService(
      {} as never,
      {} as never,
      {} as never,
      { saveRawOps } as never,
      {} as never,
      {} as never,
      {} as never
    );

    expect(service.publishActorStorageVersion('bseTest', 'tblTest', 7)).toBe(rawMap);
    expect(saveRawOps).toHaveBeenCalledExactlyOnceWith('bseTest', RawOpType.Edit, IdPrefix.Table, [
      {
        docId: 'tblTest',
        version: 7,
        data: [
          { p: ['actorStorageVersion'], od: 0, oi: 1 },
          { p: ['version'], od: 7, oi: 8 },
        ],
      },
    ]);
  });

  it.each([0, 1] as const)(
    'serializes actual capability %s in existing table snapshots',
    async (actorStorageVersion) => {
      const createdTime = new Date('2026-10-01T00:00:00.000Z');
      const table = { id: 'tblTest', version: 7, actorStorageVersion, createdTime };
      const prisma = {
        txClient: () => ({ tableMeta: { findMany: async () => [table] } }),
      } as never;
      const service = new TableService(
        {} as never,
        prisma,
        {} as never,
        {} as never,
        new TableSnapshotReadService(prisma, {
          getBaseShareVisibleResourceIds: vi.fn().mockResolvedValue(undefined),
        } as never),
        {} as never,
        {} as never
      );
      const result = await service.getSnapshotBulk('bseTest', ['tblTest'], {
        ignoreDefaultViewId: true,
      });
      expect(JSON.parse(JSON.stringify(result))).toMatchObject([
        {
          id: 'tblTest',
          v: 7,
          type: 'json0',
          data: { actorStorageVersion },
        },
      ]);
    }
  );
});
