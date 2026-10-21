/* eslint-disable @typescript-eslint/naming-convention */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { PrismaService } from '@teable/db-main-prisma';
import {
  ComputedFieldUpdater,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateOutboxConfig,
} from '@teable/v2-adapter-table-repository-postgres';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createField,
  createRecords,
  createTable,
  initApp,
  permanentDeleteTable,
} from './utils/init-app';

/**
 * Dedicated PostgreSQL + Redis only; never point at a running perf-lab database.
 * NEST_FRONTIER_E2E=true FORCE_V2_ALL=true V2_COMPUTED_OUTBOX_BULLMQ_E2E=true
 * pnpm --filter @teable/backend exec vitest run --config vitest-e2e.config.ts
 *   test/computed-value-frontier-default-budget.e2e-spec.ts
 *
 * Both baseline and candidate execute the same workload and correctness checks.
 * NEST_FRONTIER_EXPECT_PRUNING=true adds candidate-only path-coverage assertions.
 * NEST_FRONTIER_ARTIFACT_PATH optionally writes raw per-scenario observations.
 * Leave V2_COMPUTED_UPDATE_MODE unset. With the copied EE perf config, also set
 * PERF_LAB_ENGINE_LIST=v2 PERF_LAB_COMPUTED_UPDATE_MODE=hybrid: its runtime setup
 * clears the broad EE setup's sync default before Nest boots.
 * No stage, dirty, fanout or adaptive budget is overridden by this fixture.
 */
const describeDedicated = process.env.NEST_FRONTIER_E2E === 'true' ? describe : describe.skip;
const ROOTS = 5;
const FANOUT = 1024;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const qualified = (name: string) => name.split('.').map(quote).join('.');

type StoredRow = { id: string; version: number; rounded: unknown; output: unknown };
type Observation = {
  scenario: string;
  writeMs: number;
  settledAndVerifiedMs: number;
  sql: Record<string, { count: number; elapsedMs: number }>;
  frontierInsertExamples: string[];
  executedStages: number;
  downstreamCandidateRows: number;
  downstreamSteps: number;
  coveredRootScopes: number;
  changedChildVersions: number;
  versionDeltaHistogram: Record<string, number>;
  rowVersions: Array<{
    ordinal: number;
    before: number;
    after: number;
    delta: number;
    updateOldVersions: number[];
  }>;
};

const queryText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string')
    return value.text;
  return '';
};

const queryCategory = (statement: string): string => {
  const text = statement.trim().toLowerCase();
  if (text.includes('computed_update_change_frontier')) {
    if (/\binsert\s+into\s+"?computed_update_change_frontier/.test(text)) return 'frontierInsert';
    if (/\bdelete\s+from\s+"?computed_update_change_frontier/.test(text)) return 'frontierCleanup';
    return 'frontierRead';
  }
  if (text.includes('tmp_computed_dirty') && text.startsWith('select count(')) return 'dirtyCount';
  if (text.includes('computed_update_outbox')) return 'outbox';
  return 'otherPgClient';
};

describeDedicated('actual-value frontier with default Nest worker budgets', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let appUrl: string;
  let cookie: string;
  let sourceId = '';
  let childId = '';
  let active: Observation | undefined;
  let completed = false;
  let effectiveConfig: ComputedUpdateOutboxConfig | undefined;
  let activeVersions = new Map<string, number[]>();
  const cleanupIds: string[] = [];
  const observations: Observation[] = [];
  const restorers: Array<() => void> = [];
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    expect(process.env.FORCE_V2_ALL).toBe('true');
    // Hybrid is the unset production default; the literal 'hybrid' is invalid.
    expect(process.env.V2_COMPUTED_UPDATE_MODE).toBeUndefined();
    const ctx = await initApp();
    app = ctx.app;
    appUrl = ctx.appUrl;
    cookie = ctx.cookie;
    prisma = app.get(PrismaService);

    // Observe the real pg driver, without replacing SQL or changing scheduling.
    // Times are client wall time and can overlap; these are not server CPU times.
    const originalQuery = Client.prototype.query;
    const querySpy = vi.spyOn(Client.prototype, 'query').mockImplementation(function (
      this: Client,
      ...args
    ) {
      const observation = active;
      const statement = queryText(args[0]);
      const category = queryCategory(statement);
      const start = performance.now();
      if (observation) {
        const counter = (observation.sql[category] ??= { count: 0, elapsedMs: 0 });
        counter.count++;
        if (category === 'frontierInsert' && observation.frontierInsertExamples.length < 3)
          observation.frontierInsertExamples.push(statement);
      }
      const result = Reflect.apply(originalQuery, this, args);
      if (observation && result && typeof result.then === 'function') {
        const finish = () => {
          observation.sql[category].elapsedMs += performance.now() - start;
        };
        void result.then(finish, finish);
      }
      return result;
    });
    restorers.push(() => querySpy.mockRestore());

    const originalExecute = ComputedFieldUpdater.prototype.executePreparedSteps;
    const executeSpy = vi
      .spyOn(ComputedFieldUpdater.prototype, 'executePreparedSteps')
      .mockImplementation(async function (this: ComputedFieldUpdater, ...args) {
        const observation = active;
        const versions = activeVersions;
        const result = await originalExecute.apply(this, args);
        if (observation && result.isOk()) {
          observation.executedStages++;
          for (const step of result.value.changesByStep) {
            if (step.tableId !== childId) continue;
            for (const record of step.recordChanges) {
              const recorded = versions.get(record.recordId) ?? [];
              recorded.push(record.oldVersion);
              versions.set(record.recordId, recorded);
            }
          }
          const childTraces = result.value.traceInfos.filter((step) => step.tableId === childId);
          observation.downstreamSteps += childTraces.length;
          observation.downstreamCandidateRows += childTraces.reduce(
            (sum, step) => sum + step.dirtyRecordCount,
            0
          );
        }
        return result;
      });
    restorers.push(() => executeSpy.mockRestore());

    const originalCollect = ComputedFieldUpdater.prototype.collectStageOutputSeedGroups;
    const collectSpy = vi
      .spyOn(ComputedFieldUpdater.prototype, 'collectStageOutputSeedGroups')
      .mockImplementation(async function (this: ComputedFieldUpdater, ...args) {
        const observation = active;
        const result = await originalCollect.apply(this, args);
        if (
          observation &&
          result.isOk() &&
          'valuePrunedTableIds' in result.value &&
          Array.isArray(result.value.valuePrunedTableIds) &&
          result.value.valuePrunedTableIds.includes(sourceId)
        ) {
          observation.coveredRootScopes++;
        }
        return result;
      });
    restorers.push(() => collectSpy.mockRestore());
  }, 120_000);

  afterAll(async () => {
    if (process.env.NEST_FRONTIER_ARTIFACT_PATH)
      writeFileSync(
        process.env.NEST_FRONTIER_ARTIFACT_PATH,
        JSON.stringify(
          {
            status: completed ? 'complete' : 'incomplete_or_failed',
            interruptedScenario: active?.scenario,
            fixture: 'Nest/default-budget/5x1024',
            roots: ROOTS,
            fanout: FANOUT,
            effectiveConfig,
            mode: process.env.V2_COMPUTED_UPDATE_MODE ?? 'hybrid-default',
            observations,
            notes: [
              'No production budget overrides.',
              'pg.Client counts exclude Prisma engine verification queries.',
              'SQL elapsed totals may overlap; no throughput claim from three sequential mutations.',
              'Baseline and candidate use identical full stored-value and actual UPDATE continuity assertions.',
              'Compare rowVersions by ordinal: any baseline/candidate delta difference remains an explicit review item.',
            ],
          },
          null,
          2
        )
      );
    active = undefined;
    restorers.reverse().forEach((restore) => restore());
    for (const tableId of cleanupIds.reverse()) await permanentDeleteTable(baseId, tableId);
    await app?.close();
  }, 120_000);

  const waitUntil = async (assertion: () => Promise<void>, timeoutMs = 120_000) => {
    const deadline = performance.now() + timeoutMs;
    let lastError: unknown;
    while (performance.now() < deadline) {
      try {
        await assertion();
        return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw lastError ?? new Error('Default-budget frontier did not settle');
  };

  const outboxEmpty = async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) AS count FROM computed_update_outbox WHERE base_id = $1',
      baseId
    );
    expect(Number(rows[0].count)).toBe(0);
    const dead = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) AS count FROM computed_update_dead_letter WHERE base_id = $1',
      baseId
    );
    expect(Number(dead[0].count), 'Failed computed work must not count as settled').toBe(0);
  };

  // Three complete sequential business mutations intentionally share one seeded fixture.
  // eslint-disable-next-line sonarjs/cognitive-complexity
  it('preserves every value and version across unchanged, mixed and all-changed bulk updates', async () => {
    const source = await createTable(baseId, {
      name: `frontier_customers_${Date.now()}`,
      fields: [
        { name: 'Title', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
      ],
      records: Array.from({ length: ROOTS }, (_, i) => ({
        fields: { Title: `customer-${i}`, Amount: 1.1 },
      })),
    });
    sourceId = source.id;
    cleanupIds.push(sourceId);
    const amount = source.fields.find((field) => field.name === 'Amount')!;
    const rounded = await createField(sourceId, {
      name: 'Rounded amount',
      type: FieldType.Formula,
      options: { expression: `ROUND({${amount.id}}, 0)` },
    });
    // Observe storage chosen by the normal HTTP field-creation path; never force
    // generated-column metadata off merely to make frontier coverage possible.
    const sourceMeta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: sourceId },
      select: { dbTableName: true },
    });
    const storage = await prisma.$queryRawUnsafe<Array<{ attgenerated: string }>>(
      'SELECT attgenerated::text AS attgenerated FROM pg_attribute WHERE attrelid = to_regclass($1) AND attname = $2',
      qualified(sourceMeta.dbTableName),
      rounded.dbFieldName
    );
    expect(storage).toEqual([{ attgenerated: '' }]);
    const child = await createTable(baseId, {
      name: `frontier_orders_${Date.now()}`,
      records: [],
      fields: [{ name: 'Title', type: FieldType.SingleLineText }],
    });
    childId = child.id;
    cleanupIds.push(childId);
    const link = await createField(childId, {
      name: 'Customer',
      type: FieldType.Link,
      options: { relationship: Relationship.ManyOne, foreignTableId: sourceId, isOneWay: true },
    });
    const lookup = await createField(childId, {
      name: 'Rounded lookup',
      type: FieldType.Number,
      isLookup: true,
      lookupOptions: { foreignTableId: sourceId, linkFieldId: link.id, lookupFieldId: rounded.id },
    });
    const output = await createField(childId, {
      name: 'Invoice amount',
      type: FieldType.Formula,
      options: { expression: `SUM({${lookup.id}}) * 10` },
    });
    const owners = new Map<string, number>();
    const ordinals = new Map<string, number>();
    const titleId = child.fields[0].id;
    for (let offset = 0; offset < ROOTS * FANOUT; offset += 100) {
      const batch = await createRecords(childId, {
        fieldKeyType: FieldKeyType.Id,
        records: Array.from({ length: Math.min(100, ROOTS * FANOUT - offset) }, (_, j) => {
          const ordinal = offset + j;
          return {
            fields: {
              [titleId]: `order-${ordinal}`,
              [link.id]: { id: source.records[Math.floor(ordinal / FANOUT)].id },
            },
          };
        }),
      });
      batch.records.forEach((record, j) => {
        owners.set(record.id, Math.floor((offset + j) / FANOUT));
        ordinals.set(record.id, offset + j);
      });
    }
    const meta = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: childId },
      select: { dbTableName: true },
    });
    const snapshot = () =>
      prisma.$queryRawUnsafe<StoredRow[]>(
        `SELECT "__id" AS id, "__version" AS version, ${quote(lookup.dbFieldName)} AS rounded, ${quote(output.dbFieldName)} AS output FROM ${qualified(meta.dbTableName)} ORDER BY "__id"`
      );
    const validate = (rows: StoredRow[], expected: number[]) => {
      expect(rows).toHaveLength(ROOTS * FANOUT);
      for (const row of rows) {
        const owner = owners.get(row.id);
        expect(owner).toBeDefined();
        const value = expected[owner!];
        expect(row.rounded).toEqual(lookup.isMultipleCellValue ? [value] : value);
        expect(Number(row.output)).toBe(value * 10);
      }
    };
    await waitUntil(async () => {
      await outboxEmpty();
      validate(await snapshot(), [1, 1, 1, 1, 1]);
    });
    const container = await app.get(V2ContainerService).getContainerForBase(baseId);
    effectiveConfig = container.resolve<ComputedUpdateOutboxConfig>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
    );
    const scenarios = [
      { name: 'unchanged', amounts: [1.2, 1.2, 1.2, 1.2, 1.2], rounded: [1, 1, 1, 1, 1] },
      { name: 'mixed', amounts: [1.8, 1.3, 1.3, 1.3, 1.3], rounded: [2, 1, 1, 1, 1] },
      { name: 'all-changed', amounts: [2.8, 2.8, 2.8, 2.8, 2.8], rounded: [3, 3, 3, 3, 3] },
    ];
    let previousRounded = [1, 1, 1, 1, 1];
    for (const scenario of scenarios) {
      const before = new Map((await snapshot()).map((row) => [row.id, row.version]));
      const observation: Observation = {
        scenario: scenario.name,
        writeMs: 0,
        settledAndVerifiedMs: 0,
        sql: {},
        frontierInsertExamples: [],
        executedStages: 0,
        downstreamCandidateRows: 0,
        downstreamSteps: 0,
        coveredRootScopes: 0,
        changedChildVersions: 0,
        versionDeltaHistogram: {},
        rowVersions: [],
      };
      observations.push(observation);
      activeVersions = new Map();
      active = observation;
      const start = performance.now();
      const response = await fetch(`${appUrl}/api/table/${sourceId}/record`, {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          fieldKeyType: FieldKeyType.Id,
          records: source.records.map((record, i) => ({
            id: record.id,
            fields: { [amount.id]: scenario.amounts[i] },
          })),
        }),
      });
      observation.writeMs = performance.now() - start;
      expect(response.status, await response.text()).toBe(200);
      expect(response.headers.get('x-teable-v2')).toBe('true');
      await waitUntil(async () => {
        await outboxEmpty();
        validate(await snapshot(), scenario.rounded);
      });
      observation.settledAndVerifiedMs = performance.now() - start;
      active = undefined;
      for (const row of await snapshot()) {
        const changed =
          scenario.rounded[owners.get(row.id)!] !== previousRounded[owners.get(row.id)!];
        const delta = row.version - before.get(row.id)!;
        const updateOldVersions = [...(activeVersions.get(row.id) ?? [])].sort((a, b) => a - b);
        // Do not assume equal update counts under different default stage plans.
        // Record every delta for baseline/PR comparison, and check actual write
        // continuity. A difference requires review, not automatic acceptance.
        expect(delta).toBe(updateOldVersions.length);
        expect(updateOldVersions).toEqual(
          Array.from({ length: delta }, (_, i) => before.get(row.id)! + i)
        );
        if (changed) expect(delta).toBeGreaterThan(0);
        else expect(delta).toBe(0);
        observation.rowVersions.push({
          ordinal: ordinals.get(row.id)!,
          before: before.get(row.id)!,
          after: row.version,
          delta,
          updateOldVersions,
        });
        observation.changedChildVersions += delta > 0 ? 1 : 0;
        observation.versionDeltaHistogram[String(delta)] =
          (observation.versionDeltaHistogram[String(delta)] ?? 0) + 1;
      }
      if (process.env.NEST_FRONTIER_EXPECT_PRUNING === 'true') {
        expect(observation.sql.frontierInsert?.count ?? 0).toBeGreaterThan(0);
        // The collector reports proven coverage even if every covered row changed.
        expect(observation.coveredRootScopes).toBeGreaterThan(0);
        if (scenario.name === 'unchanged') expect(observation.downstreamCandidateRows).toBe(0);
        if (scenario.name === 'mixed')
          expect(observation.downstreamCandidateRows).toBeLessThan(ROOTS * FANOUT);
      }
      observation.rowVersions.sort((a, b) => a.ordinal - b.ordinal);
      previousRounded = scenario.rounded;
    }
    completed = true;
  }, 300_000);
});
