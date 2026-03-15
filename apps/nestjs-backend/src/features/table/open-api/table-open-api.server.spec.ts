import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const useV2Feature = () => () => undefined;

vi.mock('../table.service', () => ({
  TableService: class TableService {},
}));

vi.mock('./table-open-api.service', () => ({
  TableOpenApiService: class TableOpenApiService {},
}));

vi.mock('../table-index.service', () => ({
  TableIndexService: class TableIndexService {},
}));

vi.mock('../table-permission.service', () => ({
  TablePermissionService: class TablePermissionService {},
}));

vi.mock('./table-open-api-v2.service', () => ({
  TableOpenApiV2Service: class TableOpenApiV2Service {},
}));

vi.mock('../../canary/decorators/use-v2-feature.decorator', () => ({
  UseV2Feature: useV2Feature,
}));

vi.mock('../../canary/guards/v2-feature.guard', () => ({
  V2FeatureGuard: class V2FeatureGuard {},
}));

vi.mock('../../canary/interceptors/v2-indicator.interceptor', () => ({
  V2IndicatorInterceptor: class V2IndicatorInterceptor {},
}));

vi.mock('@teable/db-main-prisma', () => ({
  PrismaService: class PrismaService {},
}));

let tableControllerClass: new (...args: unknown[]) => {
  archiveTable: (baseId: string, tableId: string) => Promise<unknown>;
  permanentDeleteTable: (baseId: string, tableId: string) => Promise<unknown>;
};

describe('TableController.archiveTable', () => {
  beforeAll(async () => {
    const module = await import('./table-open-api.controller');
    tableControllerClass = module.TableController as typeof tableControllerClass;
  });

  const createController = (useV2: boolean) => {
    const tableOpenApiService = {
      deleteTable: vi.fn(),
      permanentDeleteTables: vi.fn(),
    };
    const tableOpenApiV2Service = {
      deleteTable: vi.fn(),
    };
    const cls = {
      get: vi.fn((key: string) => (key === 'useV2' ? useV2 : undefined)),
    };

    const controller = new tableControllerClass(
      {} as never,
      tableOpenApiService as never,
      {} as never,
      {} as never,
      tableOpenApiV2Service as never,
      cls as never
    );

    return {
      controller,
      tableOpenApiService,
      tableOpenApiV2Service,
    };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes delete-table through v2 when useV2 is enabled', async () => {
    const { controller, tableOpenApiService, tableOpenApiV2Service } = createController(true);

    await controller.archiveTable('bse1', 'tbl1');

    expect(tableOpenApiV2Service.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1');
    expect(tableOpenApiService.deleteTable).not.toHaveBeenCalled();
  });

  it('keeps the legacy delete-table path when useV2 is disabled', async () => {
    const { controller, tableOpenApiService, tableOpenApiV2Service } = createController(false);

    await controller.archiveTable('bse1', 'tbl1');

    expect(tableOpenApiService.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1');
    expect(tableOpenApiV2Service.deleteTable).not.toHaveBeenCalled();
  });

  it('routes permanent delete through v2 when useV2 is enabled', async () => {
    const { controller, tableOpenApiService, tableOpenApiV2Service } = createController(true);

    await controller.permanentDeleteTable('bse1', 'tbl1');

    expect(tableOpenApiV2Service.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1', 'permanent');
    expect(tableOpenApiService.permanentDeleteTables).not.toHaveBeenCalled();
  });
});
