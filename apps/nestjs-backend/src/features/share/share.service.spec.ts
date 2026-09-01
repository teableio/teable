import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { ViewType } from '@teable/core';
import { vi } from 'vitest';
import { GlobalModule } from '../../global/global.module';
import type { IShareViewInfo } from './share-auth.service';
import { ShareModule } from './share.module';
import { ShareService } from './share.service';

describe('ShareService', () => {
  let service: ShareService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [GlobalModule, ShareModule],
    }).compile();

    service = module.get<ShareService>(ShareService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('ShareService.getShareViewV2', () => {
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
      { pluginInstall: { findFirst: legacyPluginRead } } as never,
      {} as never,
      { getFieldsByQuery: legacyFieldRead } as never,
      { getFields: fieldRead } as never,
      { getRecords: legacyRecordRead } as never,
      {} as never,
      {} as never,
      { getRecords: recordRead } as never,
      {} as never,
      {} as never,
      {} as never,
      { getPluginInstall: pluginRead } as never,
      { getRowCount: vi.fn() } as never,
      { get: vi.fn() } as never,
      {} as never,
      {} as never
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

    const result = await fixture.service.getShareViewV2(gridShareInfo);

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

    const result = await fixture.service.getShareViewV2({
      ...gridShareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result.records).toEqual([]);
    expect(fixture.recordRead).not.toHaveBeenCalled();
  });

  it('keeps link-share visible fields bounded while retaining the primary Field', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getShareViewV2({
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

    const result = await fixture.service.getShareViewV2({
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

    await fixture.service.getViewRecordsV2(gridShareInfo, {
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

    await fixture.service.getViewRecordsV2(
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

    const result = await fixture.service.getViewRecordsV2({
      ...gridShareInfo,
      shareMeta: { includeRecords: false },
    });

    expect(result).toEqual({ records: [] });
    expect(fixture.fieldRead).not.toHaveBeenCalled();
    expect(fixture.recordRead).not.toHaveBeenCalled();
  });
});
