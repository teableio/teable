import { v2CoreTokens, type IExecutionContext } from '@teable/v2-core';
import type { DependencyContainer } from '@teable/v2-di';
import { ok } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';

import { TableQueryDecisionPolicy } from './decisionPolicy';
import {
  reclaimDropTaskId,
  runReclaimSweepOnce,
  runSearchAccessPathRecommendSweepOnce,
} from './runners';
import { v2TableOpsTokens } from './tokens';

const NOW = new Date('2026-08-21T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('runReclaimSweepOnce', () => {
  it('uses one task id per grace epoch', () => {
    const firstEpoch = new Date('2026-08-20T00:00:00.000Z');
    const secondEpoch = new Date('2026-09-20T00:00:00.000Z');

    expect(reclaimDropTaskId('tblReclaim', 'search:all', firstEpoch)).toBe(
      reclaimDropTaskId('tblReclaim', 'search:all', firstEpoch)
    );
    expect(reclaimDropTaskId('tblReclaim', 'search:all', firstEpoch)).not.toBe(
      reclaimDropTaskId('tblReclaim', 'search:all', secondEpoch)
    );
  });

  it('disables an eligible access path for the grace period without queuing a drop', async () => {
    const beginGrace = vi.fn().mockResolvedValue(ok(true));
    const taskSave = vi.fn();
    const source = {
      listCandidates: vi.fn().mockResolvedValue(
        ok([
          {
            phase: 'active',
            tableId: 'tblReclaim',
            baseId: 'bseReclaim',
            scopeKey: 'search:all',
            configVersion: '11',
            accessPathReadyAt: new Date(NOW.getTime() - 60 * DAY_MS),
            lastSearchActivityAt: new Date(NOW.getTime() - 45 * DAY_MS),
            indexScanDelta: 0,
          },
        ])
      ),
      beginGrace,
      claimDueDrop: vi.fn(),
      releaseDueDrop: vi.fn(),
    };
    const decisionLogRepository = {
      findRecentByScope: vi.fn().mockResolvedValue(ok([])),
      save: vi.fn(async (_context, entry) => ok(entry)),
    };
    const values = new Map<symbol, unknown>([
      [v2TableOpsTokens.searchAccessPathReclaimSource, source],
      [v2TableOpsTokens.decisionPolicy, new TableQueryDecisionPolicy()],
      [v2TableOpsTokens.decisionLogRepository, decisionLogRepository],
      [v2TableOpsTokens.taskRepository, { saveIfAbsent: taskSave }],
    ]);
    const container = {
      isRegistered: (token: symbol) => token === v2TableOpsTokens.searchAccessPathReclaimSource,
      resolve: (token: symbol) => values.get(token),
    } as DependencyContainer;

    await runReclaimSweepOnce(
      container,
      {} as IExecutionContext,
      { now: () => NOW },
      undefined,
      'worker-1'
    );

    expect(beginGrace).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tableId: 'tblReclaim',
        scopeKey: 'search:all',
        expectedVersion: '11',
        dropAfter: new Date(NOW.getTime() + 7 * DAY_MS),
      })
    );
    expect(taskSave).not.toHaveBeenCalled();
    expect(decisionLogRepository.save.mock.calls[0][1].snapshot().outcome).toBe('executed');
  });

  it('queues a physical drop only after a due grace row is claimed', async () => {
    const claimDueDrop = vi.fn().mockResolvedValue(ok(true));
    const taskSave = vi.fn().mockResolvedValue(ok(true));
    const source = {
      listCandidates: vi.fn().mockResolvedValue(
        ok([
          {
            phase: 'drop_due',
            tableId: 'tblReclaim',
            baseId: 'bseReclaim',
            scopeKey: 'search:all',
            configVersion: '12',
            accessPathReadyAt: new Date(NOW.getTime() - 67 * DAY_MS),
            dropAfter: new Date(NOW.getTime() - DAY_MS),
          },
        ])
      ),
      beginGrace: vi.fn(),
      claimDueDrop,
      releaseDueDrop: vi.fn(),
    };
    const values = new Map<symbol, unknown>([
      [v2TableOpsTokens.searchAccessPathReclaimSource, source],
      [v2TableOpsTokens.decisionPolicy, new TableQueryDecisionPolicy()],
      [
        v2TableOpsTokens.decisionLogRepository,
        { findRecentByScope: vi.fn().mockResolvedValue(ok([])), save: vi.fn() },
      ],
      [v2TableOpsTokens.taskRepository, { saveIfAbsent: taskSave }],
    ]);
    const container = {
      isRegistered: (token: symbol) => token === v2TableOpsTokens.searchAccessPathReclaimSource,
      resolve: (token: symbol) => values.get(token),
    } as DependencyContainer;

    await runReclaimSweepOnce(
      container,
      {} as IExecutionContext,
      { now: () => NOW },
      undefined,
      'worker-1'
    );

    expect(claimDueDrop).toHaveBeenCalledOnce();
    expect(taskSave).toHaveBeenCalledOnce();
    expect(taskSave.mock.calls[0][1].snapshot()).toMatchObject({
      id: reclaimDropTaskId('tblReclaim', 'search:all', new Date(NOW.getTime() - DAY_MS)),
      kind: 'drop_search_access_path',
      payload: { trigger: 'reclaim', scopeKey: 'search:all' },
    });
  });
});

describe('runSearchAccessPathRecommendSweepOnce', () => {
  const wideHeat = {
    baseId: 'bse-1',
    tableId: 'tbl-wide',
    requestCount: 20,
    slowCount: 8,
    timeoutCount: 1,
    dbErrorCount: 0,
    totalDurationMs: 80_000,
    maxDurationMs: 18_000,
    windowStart: NOW,
    windowSizeSeconds: 300,
    fieldCount: 40,
    allFields: true,
  };

  it('analyzes wide all-field search heat', async () => {
    const findSearchHeatByTable = vi.fn().mockResolvedValue(ok([wideHeat]));
    const execute = vi.fn().mockResolvedValue(ok({}));
    const container = {
      isRegistered: (token: symbol) => token === v2TableOpsTokens.observationReader,
      resolve: (token: symbol) => {
        if (token === v2TableOpsTokens.observationReader) {
          return { findSearchHeatByTable };
        }
        if (token === v2TableOpsTokens.clock) {
          return { now: () => NOW };
        }
        if (token === v2CoreTokens.commandBus) {
          return { execute };
        }
        throw new Error(`unexpected token ${String(token)}`);
      },
    } as DependencyContainer;

    await runSearchAccessPathRecommendSweepOnce(container, {} as IExecutionContext);

    expect(findSearchHeatByTable).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ wideSearchFields: 30, minSlowCount: 5, limit: 10 })
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]?.observation.tableId()).toBe('tbl-wide');
    expect(execute.mock.calls[0]?.[1]?.observation.snapshot().windowSizeSeconds).toBe(86_400);
    expect(execute.mock.calls[0]?.[1]?.observation.snapshot().windowStart).toEqual(
      new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
    );
  });

  it('skips the sweep when another worker holds the recommend lease', async () => {
    const findSearchHeatByTable = vi.fn();
    const acquire = vi.fn().mockResolvedValue(ok(false));
    const container = {
      isRegistered: (token: symbol) =>
        token === v2TableOpsTokens.observationReader || token === v2TableOpsTokens.leaseRepository,
      resolve: (token: symbol) => {
        if (token === v2TableOpsTokens.observationReader) {
          return { findSearchHeatByTable };
        }
        if (token === v2TableOpsTokens.clock) {
          return { now: () => NOW };
        }
        if (token === v2TableOpsTokens.leaseRepository) {
          return { acquire };
        }
        throw new Error(`unexpected token ${String(token)}`);
      },
    } as DependencyContainer;

    await runSearchAccessPathRecommendSweepOnce(container, {} as IExecutionContext);

    expect(acquire).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        leaseKey: 'table-query-ops-search-access-path-recommend-sweep',
        ttlMs: 60 * 60 * 1000,
      })
    );
    expect(findSearchHeatByTable).not.toHaveBeenCalled();
  });
});
