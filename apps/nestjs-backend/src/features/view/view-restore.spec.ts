import { IdPrefix } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { RawOpType } from '../../share-db/interface';
import { ViewService } from './view.service';

// The view doc is removed by a del op on delete, so the restore must publish
// a create op: an edit op on a revived doc is skipped by the table/view query
// poll strategy and subscribers would never re-add the view to their list.
describe('ViewService.restoreView', () => {
  const tableId = 'tblTest0000000001';
  const viewId = 'viwTest0000000001';

  const build = (found: { version: number } | null) => {
    const findFirst = vi.fn().mockResolvedValue(found);
    const update = vi.fn().mockResolvedValue(undefined);
    const saveRawOps = vi.fn();
    const prisma = { view: { findFirst, update } };
    // raw ops only reach ShareDB from the outermost $tx commit callback, and
    // trash/undo callers do not open one themselves
    const $tx = vi.fn(async (fn: (client: typeof prisma) => Promise<void>) => fn(prisma));
    const prismaService = { $tx, txClient: () => prisma };
    const cls = { get: vi.fn().mockReturnValue('usrTest') };
    const service = new ViewService(
      cls as never,
      { saveRawOps } as never,
      prismaService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never
    );
    return { service, $tx, findFirst, update, saveRawOps };
  };

  it('revives the row and publishes a create op at the pre-restore version', async () => {
    const { service, $tx, findFirst, update, saveRawOps } = build({ version: 3 });

    await service.restoreView(tableId, viewId);

    expect($tx).toHaveBeenCalledTimes(1);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: viewId, tableId, deletedTime: { not: null } } })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: viewId },
        data: expect.objectContaining({ version: 4, deletedTime: null }),
      })
    );
    expect(saveRawOps).toHaveBeenCalledWith(tableId, RawOpType.Create, IdPrefix.View, [
      { docId: viewId, version: 3 },
    ]);
  });

  it('rejects restoring a view that is not deleted', async () => {
    const { service, update, saveRawOps } = build(null);

    await expect(service.restoreView(tableId, viewId)).rejects.toThrow('View not found');
    expect(update).not.toHaveBeenCalled();
    expect(saveRawOps).not.toHaveBeenCalled();
  });
});
