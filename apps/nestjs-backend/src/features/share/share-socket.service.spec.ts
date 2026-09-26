import { HttpErrorCode } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { ShareSocketService } from './share-socket.service';

const createService = (useV2 = false) => {
  const viewService = {
    getDocIdsByQuery: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const viewOpenApiV2Service = {
    getView: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const service = new ShareSocketService(
    viewService as never,
    viewOpenApiV2Service as never,
    {} as never,
    {} as never,
    { get: vi.fn().mockReturnValue(useV2) } as never
  );
  return { service, viewService, viewOpenApiV2Service };
};

const shareInfo = {
  shareId: 'shrTest',
  tableId: 'tblShared',
  view: { id: 'viwShared' },
} as never;

describe('ShareSocketService View reads', () => {
  it('loads the shared View through the v2 Table aggregate without using ViewService', async () => {
    const { service, viewService, viewOpenApiV2Service } = createService(true);
    viewOpenApiV2Service.getView.mockResolvedValue({ id: 'viwShared' });
    viewOpenApiV2Service.getSnapshotBulk.mockResolvedValue([{ id: 'viwShared' }]);

    await expect(service.getViewDocIdsByQuery(shareInfo)).resolves.toEqual({
      ids: ['viwShared'],
    });
    await expect(service.getViewSnapshotBulk(shareInfo, ['viwShared'])).resolves.toEqual([
      { id: 'viwShared' },
    ]);

    expect(viewOpenApiV2Service.getView).toHaveBeenCalledWith('tblShared', 'viwShared');
    expect(viewOpenApiV2Service.getSnapshotBulk).toHaveBeenCalledWith('tblShared', ['viwShared']);
    expect(viewService.getDocIdsByQuery).not.toHaveBeenCalled();
    expect(viewService.getSnapshotBulk).not.toHaveBeenCalled();
  });

  it('keeps the legacy path only when the v2 feature is disabled', async () => {
    const { service, viewService, viewOpenApiV2Service } = createService(false);
    viewService.getDocIdsByQuery.mockResolvedValue({ ids: ['viwShared'] });
    viewService.getSnapshotBulk.mockResolvedValue([{ id: 'viwShared' }]);

    await service.getViewDocIdsByQuery(shareInfo);
    await service.getViewSnapshotBulk(shareInfo, ['viwShared']);

    expect(viewService.getDocIdsByQuery).toHaveBeenCalledWith('tblShared', {
      includeIds: ['viwShared'],
    });
    expect(viewService.getSnapshotBulk).toHaveBeenCalledWith('tblShared', ['viwShared']);
    expect(viewOpenApiV2Service.getView).not.toHaveBeenCalled();
    expect(viewOpenApiV2Service.getSnapshotBulk).not.toHaveBeenCalled();
  });

  it('rejects a missing shared View before either persistence path', async () => {
    const { service, viewService, viewOpenApiV2Service } = createService(true);
    const missingView = { shareId: 'shrTest', tableId: 'tblShared' };

    await expect(service.getViewDocIdsByQuery(missingView)).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
    });
    await expect(service.getViewSnapshotBulk(missingView, ['viwShared'])).rejects.toMatchObject({
      code: HttpErrorCode.NOT_FOUND,
    });
    expect(viewService.getDocIdsByQuery).not.toHaveBeenCalled();
    expect(viewService.getSnapshotBulk).not.toHaveBeenCalled();
    expect(viewOpenApiV2Service.getView).not.toHaveBeenCalled();
    expect(viewOpenApiV2Service.getSnapshotBulk).not.toHaveBeenCalled();
  });

  it.each([{ ids: [] }, { ids: ['viwOther'] }, { ids: ['viwShared', 'viwOther'] }])(
    'rejects snapshot IDs outside the single shared View scope: $ids',
    async ({ ids }) => {
      const { service, viewService, viewOpenApiV2Service } = createService(true);

      await expect(service.getViewSnapshotBulk(shareInfo, ids)).rejects.toMatchObject({
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      });
      expect(viewService.getSnapshotBulk).not.toHaveBeenCalled();
      expect(viewOpenApiV2Service.getSnapshotBulk).not.toHaveBeenCalled();
    }
  );
});

describe('ShareSocketService record snapshot projection', () => {
  it('intersects a requested projection with the server-owned shared-field allow-list', async () => {
    const getFieldsByQuery = vi.fn().mockResolvedValue([{ id: 'fldVisible', isPrimary: true }]);
    const getSnapshotBulk = vi.fn().mockResolvedValue([]);
    const service = new ShareSocketService(
      {} as never,
      {} as never,
      { getFieldsByQuery } as never,
      {
        getDiffIdsByIdAndFilter: vi.fn().mockResolvedValue([]),
        getSnapshotBulk,
      } as never,
      { get: vi.fn() } as never
    );

    await service.getRecordSnapshotBulk(
      {
        shareId: 'shrTest',
        tableId: 'tblShared',
        shareMeta: { includeRecords: true },
        view: {
          id: 'viwShared',
          filter: null,
          shareMeta: { includeHiddenField: false },
        },
      } as never,
      ['recVisible'],
      true,
      { fldVisible: true, fldSecret: true }
    );

    expect(getSnapshotBulk).toHaveBeenCalledWith(
      'tblShared',
      ['recVisible'],
      { fldVisible: true },
      undefined,
      undefined,
      true
    );
  });
});

const createFieldService = (useV2 = false) => {
  const fieldService = {
    getFieldsByQuery: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const fieldOpenApiV2Service = {
    getFields: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const service = new ShareSocketService(
    {} as never,
    {} as never,
    fieldService as never,
    {} as never,
    { get: vi.fn().mockReturnValue(useV2) } as never,
    {} as never,
    fieldOpenApiV2Service as never
  );
  return { service, fieldService, fieldOpenApiV2Service };
};

const fieldShareInfo = {
  shareId: 'shrTest',
  tableId: 'tblShared',
  view: { id: 'viwShared', shareMeta: { includeHiddenField: false } },
} as never;

describe('ShareSocketService Field reads', () => {
  it('loads shared field snapshots through v2 without using FieldService', async () => {
    const { service, fieldService, fieldOpenApiV2Service } = createFieldService(true);
    fieldOpenApiV2Service.getFields.mockResolvedValue([{ id: 'fldTitle', isPrimary: true }]);
    fieldOpenApiV2Service.getSnapshotBulk.mockResolvedValue([
      { id: 'fldTitle', v: 1, type: 'json0', data: { id: 'fldTitle' } },
    ]);

    await expect(service.getFieldDocIdsByQuery(fieldShareInfo)).resolves.toEqual({
      ids: ['fldTitle'],
    });
    await expect(service.getFieldSnapshotBulk(fieldShareInfo, ['fldTitle'])).resolves.toEqual([
      { id: 'fldTitle', v: 1, type: 'json0', data: { id: 'fldTitle' } },
    ]);

    expect(fieldOpenApiV2Service.getFields).toHaveBeenCalledWith('tblShared', {
      viewId: 'viwShared',
      filterHidden: true,
    });
    expect(fieldOpenApiV2Service.getSnapshotBulk).toHaveBeenCalledWith('tblShared', ['fldTitle']);
    expect(fieldService.getFieldsByQuery).not.toHaveBeenCalled();
    expect(fieldService.getSnapshotBulk).not.toHaveBeenCalled();
  });

  it('keeps the legacy field path only when the v2 feature is disabled', async () => {
    const { service, fieldService, fieldOpenApiV2Service } = createFieldService(false);
    fieldService.getFieldsByQuery.mockResolvedValue([{ id: 'fldTitle', isPrimary: true }]);
    fieldService.getSnapshotBulk.mockResolvedValue([{ id: 'fldTitle' }]);

    await service.getFieldDocIdsByQuery(fieldShareInfo);
    await service.getFieldSnapshotBulk(fieldShareInfo, ['fldTitle']);

    expect(fieldService.getFieldsByQuery).toHaveBeenCalledWith('tblShared', {
      viewId: 'viwShared',
      filterHidden: true,
    });
    expect(fieldService.getSnapshotBulk).toHaveBeenCalledWith('tblShared', ['fldTitle']);
    expect(fieldOpenApiV2Service.getFields).not.toHaveBeenCalled();
    expect(fieldOpenApiV2Service.getSnapshotBulk).not.toHaveBeenCalled();
  });

  it('rejects snapshot IDs outside the shared field allow-list before v2 persistence', async () => {
    const { service, fieldService, fieldOpenApiV2Service } = createFieldService(true);
    fieldOpenApiV2Service.getFields.mockResolvedValue([{ id: 'fldTitle', isPrimary: true }]);

    await expect(service.getFieldSnapshotBulk(fieldShareInfo, ['fldSecret'])).rejects.toMatchObject(
      {
        code: HttpErrorCode.RESTRICTED_RESOURCE,
      }
    );
    expect(fieldOpenApiV2Service.getSnapshotBulk).not.toHaveBeenCalled();
    expect(fieldService.getSnapshotBulk).not.toHaveBeenCalled();
  });
});
