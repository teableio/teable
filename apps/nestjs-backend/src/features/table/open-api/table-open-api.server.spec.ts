import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IClsStore } from '../../../types/cls';
import { TableController } from './table-open-api.controller';

const { useV2Feature } = vi.hoisted(() => ({ useV2Feature: () => () => undefined }));

vi.mock('../table.service', () => ({
  TableService: class TableService {},
}));

vi.mock('./table-open-api.service', () => ({
  TableOpenApiService: class TableOpenApiService {},
}));

vi.mock('../../table-index/table-index.service', () => ({
  TableIndexService: class TableIndexService {},
}));

vi.mock('../table-permission.service', () => ({
  TablePermissionService: class TablePermissionService {},
}));

vi.mock('./table-open-api-v2.service', () => ({
  TableOpenApiV2Service: class TableOpenApiV2Service {},
}));

vi.mock('../../v2/v2-actor-columns.service', () => ({
  V2ActorColumnsService: class V2ActorColumnsService {},
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
  PgPoolRegistry: class PgPoolRegistry {},
  PrismaService: class PrismaService {},
  MetaPrismaService: class MetaPrismaService {},
  DataPrismaService: class DataPrismaService {},
  PrismaModule: class PrismaModule {},
  getDatabaseUrl: () => '',
}));

describe('TableController.archiveTable', () => {
  const createController = (useV2: boolean) => {
    const tableOpenApiService = {
      createTable: vi.fn().mockResolvedValue({ id: 'tbl-legacy' }),
      duplicateTable: vi.fn().mockResolvedValue({ id: 'tbl-legacy-duplicate' }),
      deleteTable: vi.fn(),
      permanentDeleteTables: vi.fn(),
    };
    const tableOpenApiV2Service = {
      createTable: vi.fn().mockResolvedValue({ id: 'tbl-v2' }),
      duplicateTable: vi.fn().mockResolvedValue({ id: 'tbl-v2-duplicate' }),
      deleteTable: vi.fn(),
    };
    const cls = new ClsService<IClsStore>(new AsyncLocalStorage());

    const controller = new TableController(
      {} as never,
      tableOpenApiService as never,
      {} as never,
      {} as never,
      tableOpenApiV2Service as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      cls
    );

    // The V2 feature guard writes `useV2` into the request-scoped CLS store, so
    // every call runs inside this controller's own context instead of a stub.
    const run = <T>(work: () => Promise<T>): Promise<T> =>
      cls.run(async () => {
        cls.set('useV2', useV2);
        return await work();
      });

    return {
      controller,
      run,
      tableOpenApiService,
      tableOpenApiV2Service,
    };
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes delete-table through v2 when useV2 is enabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(true);

    await run(() => controller.archiveTable('bse1', 'tbl1'));

    expect(tableOpenApiV2Service.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1');
    expect(tableOpenApiService.deleteTable).not.toHaveBeenCalled();
  });

  it('routes create-table through v2 when useV2 is enabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(true);
    const createTableRo = { name: 'Projects', fields: [] };

    const result = await run(() => controller.createTable('bse1', createTableRo));

    expect(tableOpenApiV2Service.createTable).toHaveBeenCalledWith('bse1', createTableRo);
    expect(tableOpenApiService.createTable).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tbl-v2' });
  });

  it('keeps the legacy create-table path when useV2 is disabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(false);
    const createTableRo = { name: 'Projects', fields: [] };

    const result = await run(() => controller.createTable('bse1', createTableRo));

    expect(tableOpenApiService.createTable).toHaveBeenCalledWith('bse1', createTableRo);
    expect(tableOpenApiV2Service.createTable).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tbl-legacy' });
  });

  it('keeps the legacy delete-table path when useV2 is disabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(false);

    await run(() => controller.archiveTable('bse1', 'tbl1'));

    expect(tableOpenApiService.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1');
    expect(tableOpenApiV2Service.deleteTable).not.toHaveBeenCalled();
  });

  it('routes duplicate-table through v2 when useV2 is enabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(true);
    const duplicateTableRo = { name: 'Projects Copy', includeRecords: true };

    const result = await run(() => controller.duplicateTable('bse1', 'tbl1', duplicateTableRo));

    expect(tableOpenApiV2Service.duplicateTable).toHaveBeenCalledWith(
      'bse1',
      'tbl1',
      duplicateTableRo
    );
    expect(tableOpenApiService.duplicateTable).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tbl-v2-duplicate' });
  });

  it('keeps the legacy duplicate-table path when useV2 is disabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(false);
    const duplicateTableRo = { name: 'Projects Copy', includeRecords: false };

    const result = await run(() => controller.duplicateTable('bse1', 'tbl1', duplicateTableRo));

    expect(tableOpenApiService.duplicateTable).toHaveBeenCalledWith(
      'bse1',
      'tbl1',
      duplicateTableRo
    );
    expect(tableOpenApiV2Service.duplicateTable).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'tbl-legacy-duplicate' });
  });

  it('routes permanent delete through v2 when useV2 is enabled', async () => {
    const { controller, run, tableOpenApiService, tableOpenApiV2Service } = createController(true);

    await run(() => controller.permanentDeleteTable('bse1', 'tbl1'));

    expect(tableOpenApiV2Service.deleteTable).toHaveBeenCalledWith('bse1', 'tbl1', 'permanent');
    expect(tableOpenApiService.permanentDeleteTables).not.toHaveBeenCalled();
  });
});
