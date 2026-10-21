import { IdPrefix, ViewOpBuilder, ViewType } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { RawOpType } from '../../share-db/interface';
import { ViewService } from './view.service';

// Gallery cards are titled by the primary field, so a raw column-meta update (the shape
// undo/redo replays) must not be able to hide it in either the persisted row or the ops
// that ShareDB publishes; the rest of the batch and other view types stay untouched.
describe('ViewService.batchUpdateViewByOps gallery primary visibility', () => {
  const tableId = 'tblTest0000000001';
  const viewId = 'viwTest0000000001';
  const primaryFieldId = 'fldTestPrimary0001';
  const otherFieldId = 'fldTestOther000001';

  const build = (viewType: ViewType) => {
    const update = vi.fn().mockResolvedValue(undefined);
    const saveRawOps = vi.fn();
    const findMany = vi
      .fn()
      .mockResolvedValueOnce(viewType === ViewType.Gallery ? [{ id: viewId }] : [])
      .mockResolvedValueOnce([
        {
          id: viewId,
          version: 3,
          type: viewType,
          options: null,
          columnMeta: JSON.stringify({
            [primaryFieldId]: { order: 0, visible: true },
            [otherFieldId]: { order: 1, visible: true },
          }),
        },
      ]);
    const findFirst = vi.fn().mockResolvedValue({ id: primaryFieldId });
    const prisma = { view: { findMany, update }, field: { findFirst } };
    const service = new ViewService(
      { get: vi.fn().mockReturnValue('usrTest') } as never,
      { saveRawOps } as never,
      { txClient: () => prisma } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { ensureSerializedProperties: vi.fn() } as never
    );

    const ops = [
      ViewOpBuilder.editor.updateViewColumnMeta.build({
        fieldId: primaryFieldId,
        oldColumnMeta: { order: 0, visible: true },
        newColumnMeta: { order: 0, visible: false },
      }),
      ViewOpBuilder.editor.updateViewColumnMeta.build({
        fieldId: otherFieldId,
        oldColumnMeta: { order: 1, visible: true },
        newColumnMeta: { order: 1, visible: false },
      }),
    ];

    return { service, ops, update, saveRawOps, findFirst };
  };

  it('persists and emits the primary column as visible for a gallery view', async () => {
    const { service, ops, update, saveRawOps } = build(ViewType.Gallery);

    await service.batchUpdateViewByOps(tableId, { [viewId]: ops });

    const columnMeta = JSON.parse(update.mock.calls[0][0].data.columnMeta) as Record<
      string,
      { order: number; visible?: boolean }
    >;
    expect(columnMeta[primaryFieldId]).toEqual({ order: 0, visible: true });
    expect(columnMeta[otherFieldId]).toEqual({ order: 1, visible: false });

    const emittedOps = saveRawOps.mock.calls[0][3][0].data;
    expect(saveRawOps).toHaveBeenCalledWith(tableId, RawOpType.Edit, IdPrefix.View, [
      { docId: viewId, version: 3, data: expect.any(Array) },
    ]);
    expect(emittedOps[0]).toMatchObject({
      p: ['columnMeta', primaryFieldId],
      oi: { order: 0, visible: true },
    });
    expect(emittedOps[1]).toMatchObject({
      p: ['columnMeta', otherFieldId],
      oi: { order: 1, visible: false },
    });
  });

  it('leaves kanban column metadata untouched', async () => {
    const { service, ops, update, saveRawOps, findFirst } = build(ViewType.Kanban);

    await service.batchUpdateViewByOps(tableId, { [viewId]: ops });

    expect(findFirst).not.toHaveBeenCalled();
    const columnMeta = JSON.parse(update.mock.calls[0][0].data.columnMeta) as Record<
      string,
      { order: number; visible?: boolean }
    >;
    expect(columnMeta[primaryFieldId]).toEqual({ order: 0, visible: false });
    expect(saveRawOps.mock.calls[0][3][0].data).toBe(ops);
  });
});
