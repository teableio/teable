import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewType } from '@teable/core';
import { vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import type { IShareViewInfo } from './share-auth.service';
import { ShareSocketService } from './share-socket.service';
import { ShareModule } from './share.module';
import { ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      imports: [GlobalModule, ShareModule],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  afterEach(async () => {
    await module.close();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('ShareService.getShareView', () => {
  const createFixture = () => {
    const legacyFieldRead = vi.fn();
    const legacyRecordRead = vi.fn();
    const legacyPluginRead = vi.fn();
    const fieldRead = vi.fn().mockResolvedValue([
      { id: 'fldPrimary', isPrimary: true },
      { id: 'fldVisible', isPrimary: false },
    ]);
    const recordRead = vi.fn().mockResolvedValue({
      records: [{ id: 'recOne', fields: { fldPrimary: 'One', fldVisible: 'Visible' } }],
      extra: { groupPoints: [] },
    });
    const pluginRead = vi.fn().mockResolvedValue({
      pluginId: 'plgOne',
      pluginInstallId: 'pliOne',
      name: 'Plugin',
      storage: { mode: 'sheet' },
      url: 'https://plugin.example',
    });
    const service = new ShareService(
      { getFields: fieldRead } as never,
      {} as never,
      { getRecords: recordRead } as never,
      { assertQueryFieldsVisible: vi.fn().mockResolvedValue(undefined) } as never,
      { getPluginInstall: pluginRead } as never,
      { getRowCount: vi.fn() } as never,
      { get: vi.fn() } as never
    );
    return {
      service,
      fieldRead,
      recordRead,
      pluginRead,
      legacyFieldRead,
      legacyRecordRead,
      legacyPluginRead,
    };
  };

  const gridShareInfo = {
    shareId: 'shrOne',
    tableId: 'tblOne',
    shareMeta: { includeRecords: true },
    view: {
      id: 'viwOne',
      name: 'Grid',
      type: ViewType.Grid,
      columnMeta: {},
      group: [{ fieldId: 'fldVisible', order: 'asc' }],
    },
  } as IShareViewInfo;

  it('composes fields and first-page records only from v2 services', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getShareView(gridShareInfo);

    expect(fixture.fieldRead).toHaveBeenCalledWith('tblOne', {
      viewId: 'viwOne',
      filterHidden: true,
    });
    expect(fixture.recordRead).toHaveBeenCalledWith(
      'tblOne',
      expect.objectContaining({
        viewId: 'viwOne',
        take: 50,
        projection: ['fldPrimary', 'fldVisible'],
      })
    );
    expect(result.records).toHaveLength(1);
    expect(fixture.legacyFieldRead).not.toHaveBeenCalled();
    expect(fixture.legacyRecordRead).not.toHaveBeenCalled();
    expect(fixture.legacyPluginRead).not.toHaveBeenCalled();
  });

  it('does not query records when aggregate share metadata disables them', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getShareView({
      ...gridShareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result.records).toEqual([]);
    expect(fixture.recordRead).not.toHaveBeenCalled();
  });

  it('keeps link-share visible fields bounded while retaining the primary Field', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getShareView({
      shareId: 'fldLink',
      tableId: 'tblForeign',
      linkOptions: {
        filterByViewId: 'viwForeign',
        visibleFieldIds: ['fldVisible'],
      },
      shareMeta: { includeRecords: true },
    });

    expect(result.fields.map((field) => field.id)).toEqual(['fldPrimary', 'fldVisible']);
    expect(fixture.recordRead).toHaveBeenCalledWith(
      'tblForeign',
      expect.objectContaining({
        viewId: 'viwForeign',
        projection: ['fldPrimary', 'fldVisible'],
      })
    );
  });

  it('loads PluginInstallation through the v2 port and merges plugin extra', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getShareView({
      ...gridShareInfo,
      view: {
        ...gridShareInfo.view!,
        type: ViewType.Plugin,
      },
    });

    expect(fixture.pluginRead).toHaveBeenCalledWith('tblOne', 'viwOne');
    expect(result.extra).toEqual({
      groupPoints: [],
      plugin: {
        pluginId: 'plgOne',
        pluginInstallId: 'pliOne',
        name: 'Plugin',
        storage: { mode: 'sheet' },
        url: 'https://plugin.example',
      },
    });
    expect(fixture.legacyPluginRead).not.toHaveBeenCalled();
  });

  it('bounds requested record projections to v2-visible Fields', async () => {
    const fixture = createFixture();

    await fixture.service.getViewRecords(gridShareInfo, {
      skip: 5,
      take: 20,
      projection: ['fldHidden'],
      orderBy: [{ fieldId: 'fldVisible', order: 'desc' }],
    });

    expect(fixture.recordRead).toHaveBeenCalledWith(
      'tblOne',
      expect.objectContaining({
        viewId: 'viwOne',
        skip: 5,
        take: 20,
        projection: ['fldPrimary', 'fldVisible'],
        orderBy: [{ fieldId: 'fldVisible', order: 'desc' }],
      })
    );
    expect(fixture.legacyFieldRead).not.toHaveBeenCalled();
    expect(fixture.legacyRecordRead).not.toHaveBeenCalled();
  });

  it('keeps selected link records outside the configured candidate View/filter scope', async () => {
    const fixture = createFixture();

    await fixture.service.getViewRecords(
      {
        shareId: 'fldLink',
        tableId: 'tblForeign',
        linkOptions: {
          filterByViewId: 'viwCandidates',
          filter: {
            conjunction: 'and',
            filterSet: [{ fieldId: 'fldVisible', operator: 'is', value: 'candidate' }],
          },
        },
        shareMeta: { includeRecords: true },
      },
      {
        filterLinkCellSelected: 'fldLink',
        selectedRecordIds: ['recSelected'],
      }
    );

    expect(fixture.recordRead).toHaveBeenCalledWith(
      'tblForeign',
      expect.objectContaining({
        viewId: undefined,
        ignoreViewQuery: true,
        filter: undefined,
        selectedRecordIds: ['recSelected'],
        projection: ['fldPrimary', 'fldVisible'],
      })
    );
  });

  it('returns early without any Field or Record query when records are disabled', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getViewRecords({
      ...gridShareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result).toEqual({ records: [] });
    expect(fixture.fieldRead).not.toHaveBeenCalled();
    expect(fixture.recordRead).not.toHaveBeenCalled();
  });
});

describe('ShareService record-sharing guards', () => {
  const createGuardFixture = () => {
    const getCalendarDailyCollection = vi.fn();
    const copy = vi.fn();
    const assertQueryFieldsVisible = vi.fn().mockResolvedValue(undefined);
    const service = new ShareService(
      {} as never,
      {} as never,
      {} as never,
      { assertQueryFieldsVisible } as never,
      {} as never,
      { getCalendarDailyCollection, getCopy: copy } as never,
      { get: vi.fn() } as never
    );
    return { service, getCalendarDailyCollection, copy, assertQueryFieldsVisible };
  };

  const shareInfoWith = (shareMeta: Record<string, unknown>) =>
    ({
      shareId: 'shrGuard',
      tableId: 'tblGuard',
      shareMeta,
      view: { id: 'viwGuard', name: 'Guard', type: ViewType.Grid, columnMeta: {} },
    }) as unknown as IShareViewInfo;

  it('calendar: returns an empty collection and runs no aggregation when includeRecords is false', async () => {
    const { service, getCalendarDailyCollection, assertQueryFieldsVisible } = createGuardFixture();

    const result = await service.getViewCalendarDailyCollection(
      shareInfoWith({ includeRecords: false }),
      {} as never
    );

    expect(result).toEqual({ countMap: {}, records: [] });
    expect(getCalendarDailyCollection).not.toHaveBeenCalled();
    expect(assertQueryFieldsVisible).not.toHaveBeenCalled();
  });

  it('copy: resolves the selected header through native copy when includeRecords is false', async () => {
    const { service, copy, assertQueryFieldsVisible } = createGuardFixture();
    const expected = { content: '', header: [{ id: 'fldSelected' }] };
    copy.mockResolvedValue(expected);

    const result = await service.copy(
      shareInfoWith({ includeRecords: false, allowCopy: true }),
      {} as never
    );

    expect(result).toEqual(expected);
    expect(copy).toHaveBeenCalledWith(
      shareInfoWith({ includeRecords: false, allowCopy: true }),
      {},
      false
    );
    expect(assertQueryFieldsVisible).toHaveBeenCalled();
  });

  it('copy: still rejects when copying is not allowed', async () => {
    const { service, copy } = createGuardFixture();

    await expect(
      service.copy(shareInfoWith({ includeRecords: true, allowCopy: false }), {} as never)
    ).rejects.toThrow('not allowed to copy');
    expect(copy).not.toHaveBeenCalled();
  });
});

describe('ShareService visible-field search scoping', () => {
  const createSearchFixture = () => {
    const fieldRead = vi.fn().mockResolvedValue([
      { id: 'fldPrimary', isPrimary: true },
      { id: 'fldVisible', isPrimary: false },
      { id: 'fldHiddenInLink', isPrimary: false },
    ]);
    const recordRead = vi.fn().mockResolvedValue({ records: [] });
    const getRowCount = vi.fn().mockResolvedValue({ rowCount: 0 });
    const getSearchCount = vi.fn().mockResolvedValue({ count: 0 });
    const getSearchIndex = vi.fn().mockResolvedValue(null);
    const getCopy = vi.fn().mockResolvedValue({ content: '', header: [] });
    const shareSocketService = new ShareSocketService(
      {} as never,
      { getSocketDocIds: vi.fn() } as never,
      { getFields: fieldRead } as never
    );
    const service = new ShareService(
      { getFields: fieldRead } as never,
      {} as never,
      { getRecords: recordRead } as never,
      shareSocketService,
      {} as never,
      { getRowCount, getSearchCount, getSearchIndex, getCopy } as never,
      { get: vi.fn() } as never
    );
    return { service, recordRead, getRowCount, getSearchCount, getSearchIndex, getCopy };
  };

  const linkShareInfo = {
    shareId: 'fldLink',
    tableId: 'tblForeign',
    shareMeta: { includeRecords: true, allowCopy: true },
    linkOptions: {
      foreignTableId: 'tblForeign',
      filterByViewId: 'viwCandidates',
      visibleFieldIds: ['fldVisible'],
    },
  } as unknown as IShareViewInfo;

  it('bounds field-less search to visible fields across records, counts, search index, and copy', async () => {
    const fixture = createSearchFixture();
    const search: [string, string, boolean] = ['secret', '', true];

    await fixture.service.getViewRecords(linkShareInfo, { search });
    await fixture.service.getViewRowCount(linkShareInfo, { search });
    await fixture.service.getShareSearchCount(linkShareInfo, { search } as never);
    await fixture.service.getShareSearchIndex(linkShareInfo, { search } as never);
    await fixture.service.copy(linkShareInfo, { ranges: '[[0,0],[0,0]]', search } as never);

    expect(fixture.recordRead).toHaveBeenCalledWith(
      'tblForeign',
      expect.objectContaining({ search: ['secret', 'fldPrimary,fldVisible', true] })
    );
    expect(fixture.getRowCount).toHaveBeenCalledWith(
      linkShareInfo,
      expect.objectContaining({ search: ['secret', 'fldPrimary,fldVisible', true] })
    );
    expect(fixture.getSearchCount).toHaveBeenCalledWith(
      linkShareInfo,
      expect.objectContaining({ search: ['secret', 'fldPrimary,fldVisible', true] })
    );
    expect(fixture.getSearchIndex).toHaveBeenCalledWith(
      linkShareInfo,
      expect.objectContaining({ search: ['secret', 'fldPrimary,fldVisible', true] })
    );
    expect(fixture.getCopy).toHaveBeenCalledWith(
      linkShareInfo,
      expect.objectContaining({ search: ['secret', 'fldPrimary,fldVisible', true] }),
      false
    );
  });
});
