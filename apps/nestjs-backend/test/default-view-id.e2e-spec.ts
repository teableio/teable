import type { INestApplication } from '@nestjs/common';
import { ViewType } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import { getDefaultViewId, updateViewOrder } from '@teable/openapi';
import { vi } from 'vitest';

import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { TableService } from '../src/features/table/table.service';
import { getError } from './utils/get-error';
import { createTable, createView, initApp, permanentDeleteTable } from './utils/init-app';

describe('GET /api/base/:baseId/table/:tableId/default-view-id v2 (T6420)', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let tableService: TableService;
  let tableId: string;
  let defaultViewId: string;
  const baseId = globalThis.testConfig.baseId;
  let previousForceV2All: string | undefined;

  beforeAll(async () => {
    const appContext = await initApp();
    app = appContext.app;
    prismaService = app.get(PrismaService);
    tableService = app.get(TableService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    previousForceV2All = process.env.FORCE_V2_ALL;
    process.env.FORCE_V2_ALL = 'true';
    const table = await createTable(baseId, { name: 'default_view_id_v2' });
    tableId = table.id;
    defaultViewId = table.defaultViewId!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await permanentDeleteTable(baseId, tableId);
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  });

  it('returns the Table aggregate default View without invoking the legacy Prisma service', async () => {
    const legacySpy = vi
      .spyOn(tableService, 'getDefaultViewId')
      .mockRejectedValue(new Error('legacy TableService must not be used'));

    const response = await getDefaultViewId(baseId, tableId);

    expect(response.data).toEqual({ id: defaultViewId });
    expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getDefaultViewId');
    expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
    expect(legacySpy).not.toHaveBeenCalled();
  });

  it('tracks View order changes through the Table aggregate', async () => {
    const second = await createView(tableId, {
      name: 'New default',
      type: ViewType.Grid,
    });
    await updateViewOrder(tableId, second.id, {
      anchorId: defaultViewId,
      position: 'before',
    });

    const response = await getDefaultViewId(baseId, tableId);

    expect(response.data).toEqual({ id: second.id });
    expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getDefaultViewId');
  });

  it('returns view.not_found when the Table has no active View child', async () => {
    const deletedTime = new Date();
    await prismaService.view.updateMany({
      where: { tableId },
      data: { deletedTime },
    });

    try {
      const error = await getError(() => getDefaultViewId(baseId, tableId));

      expect(error).toMatchObject({
        status: 404,
        code: 'not_found',
      });
    } finally {
      await prismaService.view.updateMany({
        where: { tableId, deletedTime },
        data: { deletedTime: null },
      });
    }
  });

  it('rejects a Table outside the route Base scope before returning a sibling View', async () => {
    const error = await getError(() => getDefaultViewId(`bse${'z'.repeat(16)}`, tableId));

    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });
});
