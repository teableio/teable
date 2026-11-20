import { HttpErrorCode } from '@teable/core';
import { describe, expect, it, vi } from 'vitest';
import { ShareSocketService, scopeSearchToVisibleFields } from './share-socket.service';

const createService = (_useV2 = false) => {
  const viewService = {
    getDocIdsByQuery: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const viewOpenApiV2Service = {
    getView: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const service = new ShareSocketService(viewOpenApiV2Service as never, {} as never, {} as never);
  return { service, viewService, viewOpenApiV2Service };
};

const shareInfo = {
  shareId: 'shrTest',
  tableId: 'tblShared',
  view: { id: 'viwShared' },
} as never;

describe('ShareSocketService View reads', () => {
  it.each([true, false])(
    'loads the shared View natively regardless of feature flag (%s)',
    async (useV2) => {
      const { service, viewService, viewOpenApiV2Service } = createService(useV2);
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
    }
  );

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
    const getFields = vi.fn().mockResolvedValue([{ id: 'fldVisible', isPrimary: true }]);
    const getSocketSnapshotBulk = vi.fn().mockResolvedValue([]);
    const service = new ShareSocketService(
      {} as never,
      { getDiffIdsByIdAndFilter: vi.fn().mockResolvedValue([]), getSocketSnapshotBulk } as never,
      { getFields } as never
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

    expect(getSocketSnapshotBulk).toHaveBeenCalledWith('tblShared', ['recVisible'], {
      fldVisible: true,
    });
  });
});

const createFieldService = (_useV2 = false) => {
  const fieldService = {
    getFieldsByQuery: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const fieldOpenApiV2Service = {
    getFields: vi.fn(),
    getSnapshotBulk: vi.fn(),
  };
  const service = new ShareSocketService({} as never, {} as never, fieldOpenApiV2Service as never);
  return { service, fieldService, fieldOpenApiV2Service };
};

const fieldShareInfo = {
  shareId: 'shrTest',
  tableId: 'tblShared',
  view: { id: 'viwShared', shareMeta: { includeHiddenField: false } },
} as never;

describe('ShareSocketService Field reads', () => {
  it.each([true, false])(
    'loads shared field snapshots natively regardless of feature flag (%s)',
    async (useV2) => {
      const { service, fieldService, fieldOpenApiV2Service } = createFieldService(useV2);
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
    }
  );

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

describe('ShareSocketService visible-field search scoping', () => {
  it('bounds field-less search to visibleFieldIds while keeping explicit search fields intact', () => {
    expect(scopeSearchToVisibleFields(['secret'], ['fldPrimary', 'fldVisible'])).toEqual([
      'secret',
      'fldPrimary,fldVisible',
    ]);
    expect(scopeSearchToVisibleFields(['secret', '', true], ['fldPrimary'])).toEqual([
      'secret',
      'fldPrimary',
      true,
    ]);
    expect(
      scopeSearchToVisibleFields(['secret', 'fldVisible'], ['fldPrimary', 'fldVisible'])
    ).toEqual(['secret', 'fldVisible']);
    expect(scopeSearchToVisibleFields(['secret'], undefined)).toEqual(['secret']);
    expect(scopeSearchToVisibleFields(['secret'], [])).toBeUndefined();
  });

  it('pins field-less socket doc-id searches on link shares to exposed fields', async () => {
    const getFields = vi.fn().mockResolvedValue([
      { id: 'fldPrimary', isPrimary: true },
      { id: 'fldVisible', isPrimary: false },
      { id: 'fldHidden', isPrimary: false },
    ]);
    const getSocketDocIds = vi.fn().mockResolvedValue({ ids: [] });
    const service = new ShareSocketService(
      {} as never,
      { getSocketDocIds } as never,
      { getFields } as never
    );

    await service.getRecordDocIdsByQuery(
      {
        shareId: 'fldLink',
        tableId: 'tblForeign',
        shareMeta: { includeRecords: true },
        linkOptions: {
          foreignTableId: 'tblForeign',
          filterByViewId: 'viwCandidates',
          visibleFieldIds: ['fldVisible'],
        },
      } as never,
      { search: ['secret'] } as never
    );

    expect(getSocketDocIds).toHaveBeenCalledWith(
      'tblForeign',
      expect.objectContaining({
        search: ['secret', 'fldPrimary,fldVisible'],
        projection: ['fldPrimary', 'fldVisible'],
      })
    );
  });
});
