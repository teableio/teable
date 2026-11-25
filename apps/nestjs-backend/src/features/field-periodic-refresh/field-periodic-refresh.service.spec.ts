import { metrics } from '@opentelemetry/api';
import { FieldType, HttpErrorCode } from '@teable/core';
import type { PrismaService } from '@teable/db-main-prisma';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import type { ClsService } from 'nestjs-cls';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CacheService } from '../../cache/cache.service';
import { CustomHttpException } from '../../custom.exception';
import type { IClsStore } from '../../types/cls';
import type { DataDbHealthService } from '../space/data-db-health.service';
import type { V2ContainerService } from '../v2/v2-container.service';
import { FieldPeriodicRefreshStateService } from './field-periodic-refresh-state.service';
import { FieldPeriodicRefreshService } from './field-periodic-refresh.service';
import type { IPeriodicRefreshEntitlementPort } from './periodic-refresh-entitlement.port';
import { PeriodicRefreshMetricsService } from './periodic-refresh-metrics.service';

const BASE_ID = `bse${'a'.repeat(16)}`;
const SPACE_ID = `spc${'b'.repeat(16)}`;
const TABLE_ID = `tbl${'c'.repeat(16)}`;
const FIELD_ID = `fld${'d'.repeat(16)}`;

const makeRelativeLookupFieldRow = (stateOverride?: Record<string, unknown>) => ({
  id: FIELD_ID,
  tableId: TABLE_ID,
  type: FieldType.SingleLineText,
  options: JSON.stringify({}),
  isLookup: true,
  isConditionalLookup: true,
  lookupOptions: JSON.stringify({
    foreignTableId: `tbl${'e'.repeat(16)}`,
    lookupFieldId: `fld${'f'.repeat(16)}`,
    filter: {
      conjunction: 'and',
      filterSet: [
        {
          fieldId: `fld${'g'.repeat(16)}`,
          operator: 'is',
          value: { mode: 'today', timeZone: 'Asia/Shanghai' },
        },
      ],
    },
  }),
  needsPeriodicRefresh: true,
  refreshCadence: 'day',
  periodicRefreshState: stateOverride ?? {
    fieldId: FIELD_ID,
    tableId: TABLE_ID,
    baseId: BASE_ID,
    enabled: true,
    timeZone: 'Asia/Shanghai',
    containsNowPrecision: false,
    lastStatus: 'idle',
    lastRefreshedAt: null,
    lastRefreshedLocalDate: null,
    lastRangeHash: null,
    lastError: null,
    pendingTaskId: null,
    pendingLocalDate: null,
    pendingRangeHash: null,
    pendingStartedAt: null,
  },
  table: {
    baseId: BASE_ID,
    base: { spaceId: SPACE_ID },
  },
});

const createPrismaMock = (fieldRow: ReturnType<typeof makeRelativeLookupFieldRow>) => {
  const tx = {
    field: {
      findFirst: vi.fn().mockResolvedValue(fieldRow),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    fieldPeriodicRefreshState: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation(async ({ create, update }) => ({
        fieldId: FIELD_ID,
        tableId: TABLE_ID,
        baseId: BASE_ID,
        enabled: create?.enabled ?? true,
        timeZone: update?.timeZone ?? create?.timeZone ?? 'Asia/Shanghai',
        containsNowPrecision: update?.containsNowPrecision ?? create?.containsNowPrecision ?? false,
        lastStatus: update?.lastStatus ?? create?.lastStatus ?? 'completed',
        lastRefreshedAt: update?.lastRefreshedAt ?? create?.lastRefreshedAt ?? null,
        lastRefreshedLocalDate:
          update?.lastRefreshedLocalDate ?? create?.lastRefreshedLocalDate ?? null,
        lastRangeHash: update?.lastRangeHash ?? create?.lastRangeHash ?? null,
        lastError: update?.lastError ?? null,
        pendingTaskId: update?.pendingTaskId ?? create?.pendingTaskId ?? null,
        pendingLocalDate: update?.pendingLocalDate ?? create?.pendingLocalDate ?? null,
        pendingRangeHash: update?.pendingRangeHash ?? create?.pendingRangeHash ?? null,
        pendingStartedAt: update?.pendingStartedAt ?? create?.pendingStartedAt ?? null,
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return {
    prisma: { txClient: () => tx } as unknown as PrismaService,
    tx,
  };
};

describe('FieldPeriodicRefreshService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates rapid manual refreshes within 30s without acquiring tenant container', async () => {
    const { prisma } = createPrismaMock(makeRelativeLookupFieldRow());
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const cacheService = {
      setnx: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    } as unknown as CacheService;
    const refreshField = vi.fn().mockResolvedValue(
      ok({
        mode: 'sync',
        stageCount: 1,
        estimatedRowCount: 5,
        updatedTableIds: [TABLE_ID],
      })
    );
    const v2ContainerService = {
      getContainerForBase: vi.fn().mockResolvedValue({
        isRegistered: () => false,
        resolve: (token: symbol) =>
          token === v2RecordRepositoryPostgresTokens.periodicFieldRefreshEngine
            ? { refreshField }
            : undefined,
      }),
    } as unknown as V2ContainerService;
    const cls = { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>;

    const service = new FieldPeriodicRefreshService(
      prisma,
      cacheService,
      v2ContainerService,
      stateService,
      cls
    );

    const first = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'manual',
    });
    const second = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'manual',
    });

    expect(first.status).toBe('refreshed');
    expect(second.status).toBe('deduped');
    expect(v2ContainerService.getContainerForBase).toHaveBeenCalledTimes(1);
    expect(refreshField).toHaveBeenCalledTimes(1);
  });

  it('short-circuits scheduled refresh via rangeHash without opening tenant container', async () => {
    const fixedNow = new Date('2026-11-23T04:00:00.000Z'); // 12:00 Asia/Shanghai
    const { prisma, tx } = createPrismaMock(makeRelativeLookupFieldRow());
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const refreshField = vi.fn().mockResolvedValue(
      ok({
        mode: 'sync',
        stageCount: 1,
        estimatedRowCount: 5,
        updatedTableIds: [TABLE_ID],
      })
    );
    const v2ContainerService = {
      getContainerForBase: vi.fn().mockResolvedValue({
        isRegistered: () => false,
        resolve: () => ({ refreshField }),
      }),
    } as unknown as V2ContainerService;

    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn() } as unknown as CacheService,
      v2ContainerService,
      stateService,
      { get: () => undefined, getId: () => '' } as unknown as ClsService<IClsStore>
    );

    const first = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'scheduled',
      now: fixedNow,
    });
    expect(first.status).toBe('refreshed');
    const savedHash = tx.fieldPeriodicRefreshState.upsert.mock.calls[0]![0].update.lastRangeHash;
    expect(typeof savedHash).toBe('string');
    expect(savedHash.length).toBeGreaterThan(0);

    tx.field.findFirst.mockResolvedValueOnce(
      makeRelativeLookupFieldRow({
        fieldId: FIELD_ID,
        tableId: TABLE_ID,
        baseId: BASE_ID,
        enabled: true,
        timeZone: 'Asia/Shanghai',
        containsNowPrecision: false,
        lastStatus: 'completed',
        lastRefreshedAt: fixedNow,
        lastRefreshedLocalDate: '2026-11-23',
        lastRangeHash: savedHash,
        lastError: null,
        pendingTaskId: null,
        pendingLocalDate: null,
        pendingRangeHash: null,
        pendingStartedAt: null,
      })
    );

    const second = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'scheduled',
      now: new Date('2026-11-23T06:00:00.000Z'), // still 2026-11-23 in Asia/Shanghai
    });

    expect(second.status).toBe('skipped_unchanged');
    expect(v2ContainerService.getContainerForBase).toHaveBeenCalledTimes(1);
  });

  it('skips unhealthy BYODB and records skipped_db_unhealthy without hitting tenant container', async () => {
    const { prisma, tx } = createPrismaMock(makeRelativeLookupFieldRow());
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const v2ContainerService = {
      getContainerForBase: vi.fn(),
    } as unknown as V2ContainerService;
    const dataDbHealthService = {
      getHealthStateForBase: vi.fn().mockResolvedValue('unreachable'),
    } as unknown as DataDbHealthService;

    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn() } as unknown as CacheService,
      v2ContainerService,
      stateService,
      { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>,
      dataDbHealthService
    );

    const res = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'manual',
    });

    expect(res.status).toBe('skipped_db_unhealthy');
    expect(res.mode).toBe('none');
    expect(v2ContainerService.getContainerForBase).not.toHaveBeenCalled();
    expect(tx.fieldPeriodicRefreshState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ lastStatus: 'skipped_db_unhealthy' }),
      })
    );
    expect(tx.field.update).not.toHaveBeenCalled();
  });

  it('requires entitlement to enable automatic refresh but allows disabling a downgraded field', async () => {
    const row = makeRelativeLookupFieldRow();
    row.periodicRefreshState.lastStatus = 'paused_plan_downgrade';
    const { prisma, tx } = createPrismaMock(row);
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const entitlement: IPeriodicRefreshEntitlementPort = {
      canAutoRefreshSpace: vi.fn().mockResolvedValue(false),
      assertAutoRefreshAllowed: vi
        .fn()
        .mockRejectedValue(
          new CustomHttpException('Upgrade required', HttpErrorCode.PAYMENT_REQUIRED)
        ),
    };

    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn() } as unknown as CacheService,
      { getContainerForBase: vi.fn() } as unknown as V2ContainerService,
      stateService,
      { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>,
      undefined,
      entitlement
    );

    await expect(
      service.updatePeriodicRefresh(TABLE_ID, FIELD_ID, { enabled: true })
    ).rejects.toThrow('Upgrade required');
    expect(entitlement.assertAutoRefreshAllowed).toHaveBeenCalledWith(SPACE_ID);

    await expect(
      service.updatePeriodicRefresh(TABLE_ID, FIELD_ID, { enabled: false })
    ).resolves.toMatchObject({
      fieldId: FIELD_ID,
      periodicRefresh: { enabled: false, lastStatus: 'idle' },
    });
    expect(entitlement.assertAutoRefreshAllowed).toHaveBeenCalledTimes(1);
    expect(tx.fieldPeriodicRefreshState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ enabled: false }) })
    );
  });

  it('clears only the pause on an unchanged, enabled state snapshot', async () => {
    const { prisma, tx } = createPrismaMock(makeRelativeLookupFieldRow());
    const lastModifiedTime = new Date('2026-11-23T00:15:00.000Z');
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    await stateService.clearPausedPlanDowngrade([{ fieldId: FIELD_ID, lastModifiedTime }]);

    expect(tx.fieldPeriodicRefreshState.updateMany).toHaveBeenCalledWith({
      where: {
        enabled: true,
        lastStatus: 'paused_plan_downgrade',
        OR: [{ fieldId: FIELD_ID, lastModifiedTime }],
      },
      data: { lastStatus: 'idle', lastError: null },
    });
  });

  it('skips stale automatic work after disabling refresh and still allows manual refresh', async () => {
    const row = makeRelativeLookupFieldRow();
    const { prisma } = createPrismaMock(row);
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const refreshField = vi.fn().mockResolvedValue(
      ok({
        mode: 'sync',
        stageCount: 1,
        estimatedRowCount: 5,
        updatedTableIds: [TABLE_ID],
      })
    );

    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn().mockResolvedValue(true) } as unknown as CacheService,
      {
        getContainerForBase: vi.fn().mockResolvedValue({
          isRegistered: () => false,
          resolve: () => ({ refreshField }),
        }),
      } as unknown as V2ContainerService,
      stateService,
      { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>
    );

    await expect(
      service.updatePeriodicRefresh(TABLE_ID, FIELD_ID, { enabled: true })
    ).rejects.toThrow('Enterprise Edition or Cloud Business plan');

    await expect(
      service.updatePeriodicRefresh(TABLE_ID, FIELD_ID, { enabled: false })
    ).resolves.toMatchObject({
      fieldId: FIELD_ID,
      periodicRefresh: { enabled: false },
    });

    row.periodicRefreshState.enabled = false;
    for (const trigger of ['scheduled', 'lazy'] as const) {
      await expect(
        service.triggerRefresh({ tableId: TABLE_ID, fieldId: FIELD_ID, trigger })
      ).resolves.toMatchObject({ status: 'skipped_unchanged', mode: 'none' });
    }
    expect(refreshField).not.toHaveBeenCalled();

    const manual = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'manual',
    });
    expect(manual.status).toBe('refreshed');
  });

  it('writes queued pending state without advancing lastRangeHash/lastRefreshedAt on async enqueue', async () => {
    const prevSucceededAt = new Date('2026-11-22T00:05:00.000Z');
    const prevRow = makeRelativeLookupFieldRow({
      fieldId: FIELD_ID,
      tableId: TABLE_ID,
      baseId: BASE_ID,
      enabled: true,
      timeZone: 'Asia/Shanghai',
      containsNowPrecision: false,
      lastStatus: 'completed',
      lastRefreshedAt: prevSucceededAt,
      lastRefreshedLocalDate: '2026-11-22',
      lastRangeHash: 'r:prev-day',
      lastError: null,
      pendingTaskId: null,
      pendingLocalDate: null,
      pendingRangeHash: null,
      pendingStartedAt: null,
    });
    const { prisma, tx } = createPrismaMock(prevRow);
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const refreshField = vi.fn().mockResolvedValue(
      ok({
        mode: 'async',
        taskId: 'cuo-123',
        stageCount: 2,
        estimatedRowCount: 5000,
        updatedTableIds: [TABLE_ID],
      })
    );
    const v2ContainerService = {
      getContainerForBase: vi.fn().mockResolvedValue({
        isRegistered: () => false,
        resolve: () => ({ refreshField }),
      }),
    } as unknown as V2ContainerService;

    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn().mockResolvedValue(true) } as unknown as CacheService,
      v2ContainerService,
      stateService,
      { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>
    );

    const now = new Date('2026-11-23T04:00:00.000Z');
    const res = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'manual',
      now,
    });

    expect(res.status).toBe('queued');
    expect(res.mode).toBe('async');
    expect(res.taskId).toBe('cuo-123');
    expect(res.refreshedAt).toBeNull();
    expect(tx.field.update).not.toHaveBeenCalled();
    expect(tx.field.updateMany).not.toHaveBeenCalled();
    expect(refreshField).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        periodicRefreshMeta: expect.objectContaining({
          sourceFieldId: FIELD_ID,
          sourceTableId: TABLE_ID,
          localDate: '2026-11-23',
          timeZone: 'Asia/Shanghai',
        }),
      })
    );

    const upsertArg = tx.fieldPeriodicRefreshState.upsert.mock.calls[0]![0];
    expect(upsertArg.update).toMatchObject({
      lastStatus: 'queued',
      pendingTaskId: 'cuo-123',
      pendingLocalDate: '2026-11-23',
      pendingStartedAt: now,
    });
    expect(upsertArg.update.lastRefreshedAt).toBeUndefined();
    expect(upsertArg.update.lastRefreshedLocalDate).toBeUndefined();
    expect(upsertArg.update.lastRangeHash).toBeUndefined();
  });

  it('deduplicates active in-flight scheduled ticks without re-enqueuing', async () => {
    const startedAt = new Date('2026-11-23T00:05:00.000Z');
    const { prisma, tx } = createPrismaMock(
      makeRelativeLookupFieldRow({
        fieldId: FIELD_ID,
        tableId: TABLE_ID,
        baseId: BASE_ID,
        enabled: true,
        timeZone: 'Asia/Shanghai',
        containsNowPrecision: false,
        lastStatus: 'queued',
        lastRefreshedAt: null,
        lastRefreshedLocalDate: null,
        lastRangeHash: null,
        lastError: null,
        pendingTaskId: 'cuo-existing',
        pendingLocalDate: '2026-11-23',
        pendingRangeHash: null,
        pendingStartedAt: startedAt,
      })
    );
    const service = new FieldPeriodicRefreshService(
      prisma,
      { setnx: vi.fn() } as unknown as CacheService,
      { getContainerForBase: vi.fn() } as unknown as V2ContainerService,
      new FieldPeriodicRefreshStateService(prisma),
      { get: () => undefined, getId: () => '' } as unknown as ClsService<IClsStore>
    );

    // Populate matching pendingRangeHash using computePeriodicRefreshRangeHash
    const { computePeriodicRefreshRangeHash } = await import('@teable/core');
    const expectedHash = computePeriodicRefreshRangeHash(
      {
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        options: {},
        lookupOptions: JSON.parse(makeRelativeLookupFieldRow().lookupOptions),
      },
      new Date('2026-11-23T00:15:00.000Z')
    )!.rangeHash;
    tx.field.findFirst.mockResolvedValueOnce(
      makeRelativeLookupFieldRow({
        fieldId: FIELD_ID,
        tableId: TABLE_ID,
        baseId: BASE_ID,
        enabled: true,
        timeZone: 'Asia/Shanghai',
        containsNowPrecision: false,
        lastStatus: 'queued',
        lastRefreshedAt: null,
        lastRefreshedLocalDate: null,
        lastRangeHash: null,
        lastError: null,
        pendingTaskId: 'cuo-existing',
        pendingLocalDate: '2026-11-23',
        pendingRangeHash: expectedHash,
        pendingStartedAt: startedAt,
      })
    );

    const res = await service.triggerRefresh({
      tableId: TABLE_ID,
      fieldId: FIELD_ID,
      trigger: 'scheduled',
      now: new Date('2026-11-23T00:15:00.000Z'),
    });
    expect(res.status).toBe('queued');
    expect(res.taskId).toBe('cuo-existing');
  });

  it('records bounded OTel counter and histogram metrics for refresh runs and config updates', async () => {
    const counters = new Map<string, ReturnType<typeof vi.fn>>();
    const histograms = new Map<string, ReturnType<typeof vi.fn>>();
    vi.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: (name: string) => {
        const add = vi.fn();
        counters.set(name, add);
        return { add };
      },
      createHistogram: (name: string) => {
        const record = vi.fn();
        histograms.set(name, record);
        return { record };
      },
    } as never);

    const metricsService = new PeriodicRefreshMetricsService();
    const { prisma } = createPrismaMock(makeRelativeLookupFieldRow());
    const stateService = new FieldPeriodicRefreshStateService(prisma);
    const cacheService = {
      setnx: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    } as unknown as CacheService;
    const v2ContainerService = {
      getContainerForBase: vi.fn().mockResolvedValue({
        isRegistered: () => false,
        resolve: () => ({
          refreshField: vi.fn().mockResolvedValue(
            ok({
              mode: 'sync',
              stageCount: 1,
              estimatedRowCount: 3,
              updatedTableIds: [TABLE_ID],
            })
          ),
        }),
      }),
    } as unknown as V2ContainerService;
    const entitlement: IPeriodicRefreshEntitlementPort = {
      canAutoRefreshSpace: vi.fn().mockResolvedValue(false),
      assertAutoRefreshAllowed: vi
        .fn()
        .mockRejectedValue(
          new CustomHttpException('Upgrade required', HttpErrorCode.PAYMENT_REQUIRED)
        ),
    };

    const service = new FieldPeriodicRefreshService(
      prisma,
      cacheService,
      v2ContainerService,
      stateService,
      { get: () => 'usr_1', getId: () => 'req_1' } as unknown as ClsService<IClsStore>,
      undefined,
      entitlement,
      metricsService
    );

    await service.triggerRefresh({ tableId: TABLE_ID, fieldId: FIELD_ID, trigger: 'manual' });
    await service.triggerRefresh({ tableId: TABLE_ID, fieldId: FIELD_ID, trigger: 'manual' });
    await expect(
      service.updatePeriodicRefresh(TABLE_ID, FIELD_ID, { enabled: true })
    ).rejects.toThrow('Upgrade required');

    const runsAdd = counters.get('periodic_refresh.runs.total')!;
    const durationRecord = histograms.get('periodic_refresh.duration_ms')!;
    const configAdd = counters.get('periodic_refresh.config_updates.total')!;

    expect(runsAdd).toHaveBeenNthCalledWith(1, 1, {
      trigger: 'manual',
      outcome: 'refreshed',
      mode: 'sync',
    });
    expect(runsAdd).toHaveBeenNthCalledWith(2, 1, {
      trigger: 'manual',
      outcome: 'deduped',
      mode: 'none',
    });
    expect(durationRecord).toHaveBeenNthCalledWith(1, expect.any(Number), {
      trigger: 'manual',
      outcome: 'refreshed',
      mode: 'sync',
    });
    expect(configAdd).toHaveBeenCalledWith(1, { enabled: 'true', outcome: 'denied' });
  });
});
