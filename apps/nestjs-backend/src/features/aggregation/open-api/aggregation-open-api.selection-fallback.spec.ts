import { describe, expect, it, vi } from 'vitest';
import { AggregationOpenApiController } from './aggregation-open-api.controller';

describe('AggregationOpenApiController selection v1 fallback attribution', () => {
  const tableId = `tbl${'t'.repeat(16)}`;
  const viewId = `viw${'v'.repeat(16)}`;
  const query = { viewId, skip: 0, take: 5, selectedRecordIds: [`rec${'r'.repeat(16)}`] };

  it('stamps unsupported_feature when forced v2 cannot serve the selection query', async () => {
    const cls = {
      get: vi.fn((key: string) => (key === 'useV2' ? true : undefined)),
      set: vi.fn(),
    };
    const aggregationOpenApiV2Service = {
      tryGetSelectionAggregation: vi.fn().mockResolvedValue(undefined),
    };
    const aggregationOpenApiService = {
      getSelectionAggregation: vi.fn().mockResolvedValue({ aggregations: [] }),
    };
    const controller = new AggregationOpenApiController(
      aggregationOpenApiService as never,
      aggregationOpenApiV2Service as never,
      {} as never,
      cls as never,
      {} as never,
      {} as never
    );

    await expect(controller.getSelectionAggregation(tableId, query as never)).resolves.toEqual({
      aggregations: [],
    });
    expect(aggregationOpenApiV2Service.tryGetSelectionAggregation).toHaveBeenCalledWith(
      tableId,
      query
    );
    expect(cls.set).toHaveBeenCalledWith('useV2', false);
    expect(cls.set).toHaveBeenCalledWith('v2Reason', 'unsupported_feature');
    expect(aggregationOpenApiService.getSelectionAggregation).toHaveBeenCalledWith(tableId, query);
  });

  it('keeps v2 attribution when the v2 selection query succeeds', async () => {
    const cls = {
      get: vi.fn((key: string) => (key === 'useV2' ? true : undefined)),
      set: vi.fn(),
    };
    const v2Result = { aggregations: [{ fieldId: `fld${'f'.repeat(16)}`, total: null }] };
    const aggregationOpenApiV2Service = {
      tryGetSelectionAggregation: vi.fn().mockResolvedValue(v2Result),
    };
    const aggregationOpenApiService = {
      getSelectionAggregation: vi.fn(),
    };
    const controller = new AggregationOpenApiController(
      aggregationOpenApiService as never,
      aggregationOpenApiV2Service as never,
      {} as never,
      cls as never,
      {} as never,
      {} as never
    );

    await expect(controller.getSelectionAggregation(tableId, query as never)).resolves.toBe(
      v2Result
    );
    expect(cls.set).not.toHaveBeenCalled();
    expect(aggregationOpenApiService.getSelectionAggregation).not.toHaveBeenCalled();
  });
});
