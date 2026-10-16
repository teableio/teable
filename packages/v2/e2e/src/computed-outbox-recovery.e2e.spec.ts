/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  computedUpdateLockKeyForRecord,
  defaultComputedUpdateOutboxConfig,
  v2RecordRepositoryPostgresTokens,
  type ComputedUpdateWorker,
  type ComputedUpdateOutboxTaskInput,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { domainError, getRandomString, v2CoreTokens, type IUnitOfWork } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { err } from 'neverthrow';
import { afterEach, describe, expect, it } from 'vitest';
import { createE2eTestContainer } from './shared/createE2eTestContainer';

type TestHarness = {
  testContainer: IV2NodeTestContainer;
  baseId: string;
  baseUrl: string;
  close(): Promise<void>;
};

const activeHarnesses = new Set<TestHarness>();

const createFieldId = () => `fld${getRandomString(16)}`;

const createHarness = async (
  options: Parameters<typeof createE2eTestContainer>[0] = {}
): Promise<TestHarness> => {
  const testContainer = await createE2eTestContainer({
    dbMode: 'postgres',
    ...options,
  });

  const app = express();
  app.use(
    createV2ExpressRouter({
      createContainer: () => testContainer.container,
    })
  );

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  // Outbox drains run CPU-heavy work between requests; keep the connection open until
  // close() so fetch never reuses a socket the idle timeout is closing (see globalTestContext.ts).
  server.keepAliveTimeout = 0;

  const address = server.address() as AddressInfo;
  const harness: TestHarness = {
    testContainer,
    baseId: testContainer.baseId.toString(),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await testContainer.dispose();
      activeHarnesses.delete(harness);
    },
  };

  activeHarnesses.add(harness);
  return harness;
};

afterEach(async () => {
  while (activeHarnesses.size > 0) {
    const harnesses = [...activeHarnesses];
    const harness = harnesses[harnesses.length - 1];
    if (!harness) break;
    await harness.close();
  }
});

const createTable = async (harness: TestHarness, payload: Record<string, unknown>) => {
  const response = await fetch(`${harness.baseUrl}/tables/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createTableOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create table: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.table;
};

const createRecord = async (
  harness: TestHarness,
  tableId: string,
  fields: Record<string, unknown>
) => {
  const response = await fetch(`${harness.baseUrl}/tables/createRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, fields }),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(201);
  const parsed = createRecordOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to create record: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.record;
};

const updateRecord = async (
  harness: TestHarness,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
) => {
  const response = await fetch(`${harness.baseUrl}/tables/updateRecord`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId, recordId, fields }),
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
  const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to update record: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.record;
};

const listRecordsWithoutDrain = async (
  harness: TestHarness,
  tableId: string
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> => {
  const params = new URLSearchParams({ tableId });
  const response = await fetch(`${harness.baseUrl}/tables/listRecords?${params.toString()}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  const rawBody = await response.json();
  expect(response.status, JSON.stringify(rawBody)).toBe(200);
  const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
  expect(parsed.success).toBe(true);
  if (!parsed.success || !parsed.data.ok) {
    throw new Error(`Failed to list records: ${JSON.stringify(rawBody)}`);
  }
  return parsed.data.data.records;
};

const parseArrayCell = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getLookupValues = (
  records: Array<{ id: string; fields: Record<string, unknown> }>,
  fieldId: string
): unknown[] => {
  if (records.length === 0) return [];
  return parseArrayCell(records[0].fields[fieldId]);
};

const waitFor = async (
  check: () => Promise<void>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
) => {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'waitFor failed'));
};

const pendingOutboxStatuses = async (harness: TestHarness) => {
  return harness.testContainer.db
    .selectFrom('computed_update_outbox')
    .select(['id', 'status'])
    .orderBy('created_at', 'asc')
    .execute();
};

const prepareLookupScenario = async (harness: TestHarness) => {
  const sourceNameFieldId = createFieldId();
  const sourceValueFieldId = createFieldId();
  const sourceTable = await createTable(harness, {
    baseId: harness.baseId,
    name: `RecoverySource_${getRandomString(6)}`,
    fields: [
      { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
      { type: 'number', id: sourceValueFieldId, name: 'Value' },
    ],
    views: [{ type: 'grid' }],
  });

  const targetNameFieldId = createFieldId();
  const linkFieldId = createFieldId();
  const lookupFieldId = createFieldId();
  const targetTable = await createTable(harness, {
    baseId: harness.baseId,
    name: `RecoveryTarget_${getRandomString(6)}`,
    fields: [
      { type: 'singleLineText', id: targetNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: linkFieldId,
        name: 'Source',
        options: {
          relationship: 'manyOne',
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: lookupFieldId,
        name: 'SourceValue',
        options: {
          linkFieldId,
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceValueFieldId,
        },
      },
    ],
    views: [{ type: 'grid' }],
  });

  await harness.testContainer.processOutbox();

  const sourceRecord = await createRecord(harness, sourceTable.id, {
    [sourceNameFieldId]: 'Source A',
    [sourceValueFieldId]: 100,
  });
  await harness.testContainer.processOutbox();

  await createRecord(harness, targetTable.id, {
    [targetNameFieldId]: 'Target A',
    [linkFieldId]: { id: sourceRecord.id },
  });

  return { targetTableId: targetTable.id, lookupFieldId };
};

const prepareLockContentionScenario = async (harness: TestHarness) => {
  const sourceNameFieldId = createFieldId();
  const sourceValueFieldId = createFieldId();
  const sourceTable = await createTable(harness, {
    baseId: harness.baseId,
    name: `ContentionSource_${getRandomString(6)}`,
    fields: [
      { type: 'singleLineText', id: sourceNameFieldId, name: 'Name', isPrimary: true },
      { type: 'number', id: sourceValueFieldId, name: 'Value' },
    ],
    views: [{ type: 'grid' }],
  });

  const targetNameFieldId = createFieldId();
  const linkFieldId = createFieldId();
  const lookupFieldId = createFieldId();
  const formulaFieldIds = Array.from({ length: 5 }, () => createFieldId());
  const targetTable = await createTable(harness, {
    baseId: harness.baseId,
    name: `ContentionTarget_${getRandomString(6)}`,
    fields: [
      { type: 'singleLineText', id: targetNameFieldId, name: 'Name', isPrimary: true },
      {
        type: 'link',
        id: linkFieldId,
        name: 'Source',
        options: {
          relationship: 'manyOne',
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceNameFieldId,
        },
      },
      {
        type: 'lookup',
        id: lookupFieldId,
        name: 'SourceValue',
        options: {
          linkFieldId,
          foreignTableId: sourceTable.id,
          lookupFieldId: sourceValueFieldId,
        },
      },
      {
        type: 'formula',
        id: formulaFieldIds[0],
        name: 'Step1',
        options: { expression: `SUM({${lookupFieldId}})` },
      },
      ...formulaFieldIds.slice(1).map((fieldId, index) => ({
        type: 'formula',
        id: fieldId,
        name: `Step${index + 2}`,
        options: { expression: `{${formulaFieldIds[index]}} + 1` },
      })),
    ],
    views: [{ type: 'grid' }],
  });

  await harness.testContainer.processOutbox();

  const sourceRecord = await createRecord(harness, sourceTable.id, {
    [sourceNameFieldId]: 'Source A',
    [sourceValueFieldId]: 100,
  });
  await harness.testContainer.processOutbox();

  return {
    sourceTableId: sourceTable.id,
    sourceNameFieldId,
    sourceRecordId: sourceRecord.id,
    sourceValueFieldId,
    targetTableId: targetTable.id,
    targetNameFieldId,
    linkFieldId,
    lookupFieldId,
    formulaFieldIds,
    finalFormulaFieldId: formulaFieldIds[formulaFieldIds.length - 1],
  };
};

const createLanePair = async (mode: 'hybrid' | 'async' = 'hybrid') => {
  const commonConfig = {
    mode,
    hybridConfig: { dispatchMode: 'external' as const, syncPolicy: 'none' as const },
    fieldBackfillConfig: { mode: 'async' as const },
  };
  const outboxConfig = {
    ...defaultComputedUpdateOutboxConfig,
    stageMaxSteps: 1,
    stageMaxDirtyRecords: 2,
    stageSmallRunComplexityThreshold: 0,
    fieldBackfillBatchSize: 1,
    continuationRelayClaimEnabled: false,
  };
  const productionConfig = { ...outboxConfig, workerLane: 'production' };
  const stagingConfig = { ...outboxConfig, workerLane: 'staging' };
  const production = await createHarness({
    computedUpdate: { ...commonConfig, outboxConfig: productionConfig },
  });
  const staging = await createHarness({
    connectionString: production.testContainer.connectionString,
    seedBase: false,
    ensureSchema: false,
    computedUpdate: { ...commonConfig, outboxConfig: stagingConfig },
  });
  return { production, staging };
};

const resolveOutbox = (harness: TestHarness) =>
  harness.testContainer.container.resolve<IComputedUpdateOutbox>(
    v2RecordRepositoryPostgresTokens.computedUpdateOutbox
  );

const runOneStageBatch = async (harness: TestHarness) => {
  const worker = harness.testContainer.container.resolve<ComputedUpdateWorker>(
    v2RecordRepositoryPostgresTokens.computedUpdateWorker
  );
  const result = await worker.runOnce({ workerId: 'lane-stage-worker', limit: 1 });
  expect(result._unsafeUnwrap()).toBeGreaterThan(0);
};

describe('[C14][S19] computed outbox recovery (e2e)', () => {
  it('worker lane prevents a staging worker from claiming a production API write', async () => {
    const production = await createHarness({
      computedUpdate: {
        mode: 'async',
        outboxConfig: { ...defaultComputedUpdateOutboxConfig, workerLane: 'production' },
      },
    });
    const valueFieldId = createFieldId();
    const formulaFieldId = createFieldId();
    const table = await createTable(production, {
      baseId: production.baseId,
      name: 'Lane ownership',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: valueFieldId, name: 'Value' },
        {
          type: 'formula',
          id: formulaFieldId,
          name: 'Double',
          options: { expression: `{${valueFieldId}} * 2` },
        },
      ],
    });
    const staging = await createHarness({
      connectionString: production.testContainer.connectionString,
      seedBase: false,
      ensureSchema: false,
      computedUpdate: {
        mode: 'async',
        outboxConfig: { ...defaultComputedUpdateOutboxConfig, workerLane: 'staging' },
      },
    });
    const record = await createRecord(production, table.id, { [valueFieldId]: 7 });
    const task = await production.testContainer.db
      .selectFrom('computed_update_outbox')
      .select('id')
      .where('seed_table_id', '=', table.id)
      .where('change_type', '=', 'seed')
      .executeTakeFirstOrThrow();
    const stolen = await resolveOutbox(staging).claimById({
      taskId: task.id,
      workerId: 'staging-worker',
    });
    expect(stolen._unsafeUnwrap()).toBeNull();
    expect(await staging.testContainer.processOutboxOnce()).toBe(0);
    await production.testContainer.processOutbox();
    const records = await listRecordsWithoutDrain(production, table.id);
    expect(records.find((row) => row.id === record.id)?.fields[formulaFieldId]).toBe(14);
    expect(await pendingOutboxStatuses(production)).toEqual([]);
  }, 120_000);

  it.each(['hybrid', 'async'] as const)(
    'worker lane merges %s API writes only within their originating environment',
    async (mode) => {
      const { production, staging } = await createLanePair(mode);
      const scenario = await prepareLockContentionScenario(production);
      await createRecord(production, scenario.targetTableId, {
        [scenario.targetNameFieldId]: 'Shared target',
        [scenario.linkFieldId]: { id: scenario.sourceRecordId },
      });
      await production.testContainer.processOutbox();

      for (const value of [200, 201]) {
        await updateRecord(production, scenario.sourceTableId, scenario.sourceRecordId, {
          [scenario.sourceValueFieldId]: value,
        });
      }
      const productionTasks = await pendingOutboxStatuses(production);
      expect(productionTasks).toHaveLength(1);
      for (const value of [300, 301]) {
        await updateRecord(staging, scenario.sourceTableId, scenario.sourceRecordId, {
          [scenario.sourceValueFieldId]: value,
        });
      }
      const tasks = await production.testContainer.db
        .selectFrom('computed_update_outbox')
        .select(['id', 'base_id', 'seed_table_id'])
        .execute();
      // Identical physical base/table and logical plan, but independent owners.
      // Without lane-aware merge this is one row, even if claim filtering is fixed.
      expect(tasks).toHaveLength(2);
      expect(new Set(tasks.map((task) => task.base_id)).size).toBe(1);
      expect(new Set(tasks.map((task) => task.seed_table_id)).size).toBe(1);
      const stagingTask = tasks.find((task) => task.id !== productionTasks[0].id);
      if (!stagingTask) throw new Error('Staging write merged into production task');
      const productionOutbox = resolveOutbox(production);
      const stagingOutbox = resolveOutbox(staging);
      expect(
        (
          await productionOutbox.claimById({
            taskId: stagingTask.id,
            workerId: 'production-worker',
            allowProcessingTakeover: true,
          })
        )._unsafeUnwrap()
      ).toBeNull();
      expect(
        (
          await stagingOutbox.claimById({
            taskId: productionTasks[0].id,
            workerId: 'staging-worker',
          })
        )._unsafeUnwrap()
      ).toBeNull();

      // Each batch picker must leave the other lane pending in the same table.
      for (const [outbox, ownTaskId] of [
        [productionOutbox, productionTasks[0].id],
        [stagingOutbox, stagingTask.id],
      ] as const) {
        const claimed = (
          await outbox.claimBatch({ workerId: 'lane-batch-worker', limit: 10 })
        )._unsafeUnwrap();
        expect(claimed.map((task) => task.id)).toEqual([ownTaskId]);
        if (outbox === productionOutbox) {
          // Lane isolation must not split the shared per-table concurrency cap.
          const blocked = await stagingOutbox.claimById({
            taskId: stagingTask.id,
            workerId: 'staging-concurrent-worker',
          });
          expect(blocked._unsafeUnwrap()).toBeNull();
        }
        for (const task of claimed) {
          if (mode === 'async') expect(task).toMatchObject({ taskType: 'seed' });
          else expect(task).toHaveProperty('steps');
          (
            await outbox.releaseForRetry({ task, reason: 'lane test handoff', retryDelayMs: 0 })
          )._unsafeUnwrap();
        }
      }
      // Drain this lane across bounded worker rounds, leaving production work untouched.
      expect(await staging.testContainer.processOutbox()).toBeGreaterThan(0);
      expect((await pendingOutboxStatuses(production)).map((task) => task.id)).toEqual([
        productionTasks[0].id,
      ]);
      expect(await production.testContainer.processOutbox()).toBeGreaterThan(0);
      const records = await listRecordsWithoutDrain(production, scenario.targetTableId);
      expect(getLookupValues(records, scenario.lookupFieldId)).toEqual([301]);
      expect(records[0].fields[scenario.finalFormulaFieldId]).toBe(305);
      expect(await pendingOutboxStatuses(production)).toEqual([]);
    },
    120_000
  );

  it('worker lane keeps expired staging leases and staged continuations away from production', async () => {
    const { production, staging } = await createLanePair();
    const scenario = await prepareLockContentionScenario(production);
    await createRecord(production, scenario.targetTableId, {
      [scenario.targetNameFieldId]: 'Shared target',
      [scenario.linkFieldId]: { id: scenario.sourceRecordId },
    });
    await production.testContainer.processOutbox();
    await updateRecord(staging, scenario.sourceTableId, scenario.sourceRecordId, {
      [scenario.sourceValueFieldId]: 200,
    });
    const tasks = await pendingOutboxStatuses(staging);
    expect(tasks).toHaveLength(1);
    const productionOutbox = resolveOutbox(production);
    const stagingOutbox = resolveOutbox(staging);
    const owned = (
      await stagingOutbox.claimById({
        taskId: tasks[0].id,
        workerId: 'staging-owner',
      })
    )._unsafeUnwrap();
    if (!owned) throw new Error('Staging could not claim its own API write');
    const expiredAt = new Date(
      Date.now() + defaultComputedUpdateOutboxConfig.processingLeaseMs + 1000
    );
    for (const now of [new Date(), expiredAt]) {
      expect(
        (
          await productionOutbox.claimById({
            taskId: owned.id,
            workerId: 'production-takeover',
            allowProcessingTakeover: true,
            now,
          })
        )._unsafeUnwrap()
      ).toBeNull();
      expect(
        (
          await productionOutbox.claimBatch({
            workerId: 'production-poller',
            limit: 10,
            now,
          })
        )._unsafeUnwrap()
      ).toEqual([]);
    }
    const reclaimed = (
      await stagingOutbox.claimById({
        taskId: owned.id,
        workerId: 'staging-restarted',
        now: expiredAt,
      })
    )._unsafeUnwrap();
    if (!reclaimed) throw new Error('Staging could not reclaim its expired lease');
    (
      await stagingOutbox.releaseForRetry({
        task: reclaimed,
        reason: 'lane test restart',
        retryDelayMs: 0,
      })
    )._unsafeUnwrap();

    await runOneStageBatch(staging);
    const continuations = await pendingOutboxStatuses(staging);
    expect(continuations.length).toBeGreaterThan(0);
    expect(continuations.every((task) => task.id !== owned.id)).toBe(true);
    for (const task of continuations) {
      expect(
        (
          await productionOutbox.claimById({
            taskId: task.id,
            workerId: 'production-continuation-worker',
            allowProcessingTakeover: true,
          })
        )._unsafeUnwrap()
      ).toBeNull();
    }
    expect(
      (
        await productionOutbox.claimBatch({
          workerId: 'production-continuation-poller',
          limit: 10,
        })
      )._unsafeUnwrap()
    ).toEqual([]);
    expect(await staging.testContainer.processOutbox()).toBeGreaterThan(0);
    const records = await listRecordsWithoutDrain(staging, scenario.targetTableId);
    expect(getLookupValues(records, scenario.lookupFieldId)).toEqual([200]);
    expect(records[0].fields[scenario.finalFormulaFieldId]).toBe(204);
    expect(await pendingOutboxStatuses(staging)).toEqual([]);
  }, 120_000);

  it('worker lane executes each environment field backfill and retains its cursor continuation', async () => {
    const { production, staging } = await createLanePair();
    const nameFieldId = createFieldId();
    const valueFieldId = createFieldId();
    const table = await createTable(production, {
      baseId: production.baseId,
      name: 'Shared backfill table',
      fields: [
        { type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true },
        { type: 'number', id: valueFieldId, name: 'Value' },
      ],
    });
    const recordIds: string[] = [];
    for (const value of [10, 20, 30]) {
      const record = await createRecord(production, table.id, {
        [nameFieldId]: `Row ${value}`,
        [valueFieldId]: value,
      });
      recordIds.push(record.id);
    }
    await production.testContainer.processOutbox();

    for (const [owner, other, multiplier] of [
      [production, staging, 2],
      [staging, production, 3],
    ] as const) {
      const formulaFieldId = createFieldId();
      const response = await fetch(`${owner.baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId: production.baseId,
          tableId: table.id,
          field: {
            type: 'formula',
            id: formulaFieldId,
            name: `Value times ${multiplier}`,
            options: { expression: `{${valueFieldId}} * ${multiplier}` },
          },
        }),
      });
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      const parsed = createFieldOkResponseSchema.safeParse(body);
      expect(parsed.success && parsed.data.ok).toBe(true);
      const tasks = await pendingOutboxStatuses(owner);
      expect(tasks).toHaveLength(1);
      const foreignOutbox = resolveOutbox(other);
      expect(
        (
          await foreignOutbox.claimById({
            taskId: tasks[0].id,
            workerId: 'foreign-backfill-worker',
            allowProcessingTakeover: true,
          })
        )._unsafeUnwrap()
      ).toBeNull();
      expect(
        (
          await foreignOutbox.claimBatch({
            workerId: 'foreign-backfill-poller',
            limit: 10,
          })
        )._unsafeUnwrap()
      ).toEqual([]);
      const ownerOutbox = resolveOutbox(owner);
      const backfill = (
        await ownerOutbox.claimById({
          taskId: tasks[0].id,
          workerId: 'owner-backfill-worker',
        })
      )._unsafeUnwrap();
      if (!backfill) throw new Error('Environment could not claim its own field backfill');
      expect(backfill).toMatchObject({ taskType: 'field-backfill' });
      (
        await ownerOutbox.releaseForRetry({
          task: backfill,
          reason: 'lane test backfill handoff',
          retryDelayMs: 0,
        })
      )._unsafeUnwrap();

      await runOneStageBatch(owner);
      const continuations = await pendingOutboxStatuses(owner);
      expect(continuations).toHaveLength(1);
      expect(continuations[0].id).not.toBe(tasks[0].id);
      expect(
        (
          await foreignOutbox.claimById({
            taskId: continuations[0].id,
            workerId: 'foreign-backfill-continuation',
            allowProcessingTakeover: true,
          })
        )._unsafeUnwrap()
      ).toBeNull();
      expect(await other.testContainer.processOutboxOnce()).toBe(0);
      expect(await owner.testContainer.processOutbox()).toBeGreaterThan(0);
      const rows = await listRecordsWithoutDrain(owner, table.id);
      expect(
        recordIds.map((id) => rows.find((row) => row.id === id)?.fields[formulaFieldId])
      ).toEqual([10 * multiplier, 20 * multiplier, 30 * multiplier]);
      expect(await pendingOutboxStatuses(owner)).toEqual([]);
    }
  }, 120_000);

  it.each(['before commit', 'after commit'] as const)(
    'recovers exact staged values after failure %s and duplicate continuation delivery',
    async (failureBoundary) => {
      const computedUpdate = {
        hybridConfig: { dispatchMode: 'external' as const, syncPolicy: 'none' as const },
        outboxConfig: {
          stageMaxSteps: 1,
          stageMaxDirtyRecords: 2,
          stageSmallRunComplexityThreshold: 0,
          continuationRelayClaimEnabled: false,
          baseBackoffMs: 0,
          maxBackoffMs: 0,
        },
      };
      const writer = await createHarness({ computedUpdate });
      const scenario = await prepareLockContentionScenario(writer);
      const target = await createRecord(writer, scenario.targetTableId, {
        [scenario.targetNameFieldId]: 'Changed target',
        [scenario.linkFieldId]: { id: scenario.sourceRecordId },
      });
      const unrelatedSource = await createRecord(writer, scenario.sourceTableId, {
        [scenario.sourceNameFieldId]: 'Unrelated source',
        [scenario.sourceValueFieldId]: 7,
      });
      const unrelatedTarget = await createRecord(writer, scenario.targetTableId, {
        [scenario.targetNameFieldId]: 'Unrelated target',
        [scenario.linkFieldId]: { id: unrelatedSource.id },
      });
      await writer.testContainer.processOutbox();

      const assertValues = async (harness: TestHarness, expected: number) => {
        const records = await listRecordsWithoutDrain(harness, scenario.targetTableId);
        for (const [id, value] of [
          [target.id, expected],
          [unrelatedTarget.id, 7],
        ] as const) {
          const row = records.find((record) => record.id === id);
          expect(row).toBeDefined();
          expect(parseArrayCell(row?.fields[scenario.lookupFieldId])).toEqual([value]);
          expect(scenario.formulaFieldIds.map((fieldId) => row?.fields[fieldId])).toEqual([
            value,
            value + 1,
            value + 2,
            value + 3,
            value + 4,
          ]);
        }
      };
      await assertValues(writer, 100);
      await updateRecord(writer, scenario.sourceTableId, scenario.sourceRecordId, {
        [scenario.sourceValueFieldId]: 200,
      });
      const originalTasks = await pendingOutboxStatuses(writer);
      expect(originalTasks.some((task) => task.status === 'pending')).toBe(true);

      const outbox = writer.testContainer.container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const unitOfWork = writer.testContainer.container.resolve<IUnitOfWork>(
        v2CoreTokens.unitOfWork
      );
      const worker = writer.testContainer.container.resolve<ComputedUpdateWorker>(
        v2RecordRepositoryPostgresTokens.computedUpdateWorker
      );
      const realEnqueue = outbox.enqueueOrMerge;
      const realTransaction = unitOfWork.withTransaction;
      const transact = realTransaction.bind(unitOfWork);
      const captured: {
        input?: ComputedUpdateOutboxTaskInput;
        taskId?: string;
      } = {};
      let injected = false;
      const crash = new Error('Injected worker loss after durable stage commit');
      outbox.enqueueOrMerge = async function (input, context, options) {
        const result = await realEnqueue.call(this, input, context, options);
        if (!captured.input && input.predecessorTaskId && result.isOk()) {
          captured.input = input;
          captured.taskId = result.value.taskId;
        }
        return result;
      };
      unitOfWork.withTransaction = async (context, work, options) => {
        let injectAfterCommit = false;
        const result = await transact(
          context,
          async (txContext) => {
            const stage = await work(txContext);
            if (!injected && captured.input && stage.isOk()) {
              injected = true;
              if (failureBoundary === 'before commit') {
                // Real updates, enqueue and predecessor settlement have executed;
                // returning an error here must roll ALL of them back together.
                return err(
                  domainError.infrastructure({ message: 'Injected stage transaction failure' })
                );
              }
              injectAfterCommit = true;
            }
            return stage;
          },
          options
        );
        // Deliberately outside the real UoW: committed data must remain durable
        // even though this worker never gets to claim its next continuation.
        if (injectAfterCommit && result.isOk()) throw crash;
        return result;
      };
      try {
        const run = worker.runOnce({ workerId: 'recovery-boundary-worker', limit: 1 });
        if (failureBoundary === 'after commit') await expect(run).rejects.toBe(crash);
        else await run;
      } finally {
        unitOfWork.withTransaction = realTransaction;
        outbox.enqueueOrMerge = realEnqueue;
      }
      expect(injected).toBe(true);
      if (!captured.input || !captured.taskId)
        throw new Error('No stage continuation was produced');

      const persisted = await pendingOutboxStatuses(writer);
      if (failureBoundary === 'before commit') {
        await assertValues(writer, 100);
        expect(persisted.find((task) => task.id === captured.taskId)).toBeUndefined();
        expect(persisted.map((task) => task.id).sort()).toEqual(
          originalTasks.map((task) => task.id).sort()
        );
        expect(persisted.every((task) => task.status === 'pending')).toBe(true);
      } else {
        expect(persisted.find((task) => task.id === captured.taskId)?.status).toBe('pending');
        expect(
          persisted.find((task) => task.id === captured.input?.predecessorTaskId)
        ).toBeUndefined();
        const rows = await listRecordsWithoutDrain(writer, scenario.targetTableId);
        expect(
          parseArrayCell(rows.find((row) => row.id === target.id)?.fields[scenario.lookupFieldId])
        ).toEqual([200]);
        expect(rows.find((row) => row.id === target.id)?.fields[scenario.finalFormulaFieldId]).toBe(
          104
        );
      }

      // A separate DI graph and connection pool represent a restarted worker.
      const reader = await createHarness({
        connectionString: writer.testContainer.connectionString,
        seedBase: false,
        // Deployment changes must not expand a partially committed partition.
        computedUpdate: {
          ...computedUpdate,
          outboxConfig: {
            ...computedUpdate.outboxConfig,
            stageMaxSteps: 0,
            stageMaxDirtyRecords: 0,
          },
        },
      });
      if (failureBoundary === 'after commit') {
        const freshOutbox = reader.testContainer.container.resolve<IComputedUpdateOutbox>(
          v2RecordRepositoryPostgresTokens.computedUpdateOutbox
        );
        // The public API permits replaying a pending continuation. The same
        // lineage must merge instead of producing a second independently runnable task.
        const duplicate = await freshOutbox.enqueueOrMerge(captured.input);
        expect(duplicate.isOk()).toBe(true);
        if (duplicate.isErr()) throw new Error(duplicate.error.message);
        expect(duplicate.value.taskId).toBe(captured.taskId);
        expect(duplicate.value.merged).toBe(true);
      }
      await reader.testContainer.processOutbox();
      await assertValues(reader, 200);
      const sources = await listRecordsWithoutDrain(reader, scenario.sourceTableId);
      expect(
        sources.find((row) => row.id === scenario.sourceRecordId)?.fields[
          scenario.sourceValueFieldId
        ]
      ).toBe(200);
      expect(
        sources.find((row) => row.id === unrelatedSource.id)?.fields[scenario.sourceValueFieldId]
      ).toBe(7);
      expect(await pendingOutboxStatuses(reader)).toEqual([]);
      expect(
        await reader.testContainer.db
          .selectFrom('computed_update_dead_letter')
          .select('id')
          .execute()
      ).toEqual([]);
    },
    120_000
  );

  it('retries transient computed lock contention without the generic failure backoff', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    const scenario = await prepareLockContentionScenario(harness);
    const computedLockKey = computedUpdateLockKeyForRecord(
      scenario.sourceTableId,
      scenario.sourceRecordId
    );
    let targetRecordId = '';
    let requeuedTaskId = '';

    await harness.testContainer.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(
        ('x' || substr(md5(${computedLockKey}), 1, 16))::bit(64)::bigint
      )`.execute(trx);

      await updateRecord(harness, scenario.sourceTableId, scenario.sourceRecordId, {
        [scenario.sourceValueFieldId]: 101,
      });

      const targetRecord = await createRecord(harness, scenario.targetTableId, {
        [scenario.targetNameFieldId]: 'Target A',
        [scenario.linkFieldId]: { id: scenario.sourceRecordId },
      });
      targetRecordId = targetRecord.id;

      // Per-record keys let disjoint target work finish while the source row
      // is held. The source-keyed task must still miss and requeue.
      await harness.testContainer.processOutboxOnce();

      const pendingTask = await harness.testContainer.db
        .selectFrom('computed_update_outbox')
        .select(['id', 'status', 'attempts', 'next_run_at', 'updated_at', 'last_error'])
        .where('status', '=', 'pending')
        .executeTakeFirstOrThrow();

      requeuedTaskId = pendingTask.id;
      expect(pendingTask.attempts).toBe(0);
      expect(pendingTask.last_error).toContain(computedLockKey);
      // Lock-miss requeue delay carries jitter across [0.5x, 1.5x) of
      // lockUnavailableRetryDelayMs (250ms) so same-key losers do not wake in lockstep.
      const requeueDelayMs = pendingTask.next_run_at.getTime() - pendingTask.updated_at.getTime();
      expect(requeueDelayMs).toBeGreaterThanOrEqual(125);
      expect(requeueDelayMs).toBeLessThanOrEqual(375);
    });

    await waitFor(
      async () => {
        await harness.testContainer.processOutboxOnce();
        const records = await listRecordsWithoutDrain(harness, scenario.targetTableId);
        const targetRecord = records.find((record) => record.id === targetRecordId);
        expect(targetRecord?.fields[scenario.finalFormulaFieldId]).toBe(105);
        expect(await pendingOutboxStatuses(harness)).toHaveLength(0);
        const requeuedTask = await harness.testContainer.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('id', '=', requeuedTaskId)
          .executeTakeFirst();
        expect(requeuedTask).toBeUndefined();
      },
      { timeoutMs: 1500, intervalMs: 25 }
    );
  });

  it('drains pending computed backlog after a restart in external mode', async () => {
    const writer = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    const { targetTableId, lookupFieldId } = await prepareLookupScenario(writer);

    expect((await pendingOutboxStatuses(writer)).some((row) => row.status === 'pending')).toBe(
      true
    );

    const beforeRestart = await listRecordsWithoutDrain(writer, targetTableId);
    expect(getLookupValues(beforeRestart, lookupFieldId)).toEqual([100]);

    const reader = await createHarness({
      connectionString: writer.testContainer.connectionString,
      seedBase: false,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    await reader.testContainer.processOutbox();
    await waitFor(async () => {
      const records = await listRecordsWithoutDrain(reader, targetTableId);
      expect(getLookupValues(records, lookupFieldId)).toEqual([100]);
      expect(await pendingOutboxStatuses(reader)).toHaveLength(0);
    });
  });

  it('does not take over fresh processing rows before the lease expires', async () => {
    const writer = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    const { targetTableId, lookupFieldId } = await prepareLookupScenario(writer);

    await writer.testContainer.db
      .updateTable('computed_update_outbox')
      .set({
        status: 'processing',
        locked_at: new Date(),
        locked_by: 'healthy-worker:lease',
        updated_at: new Date(),
      })
      .where('status', '=', 'pending')
      .execute();

    const reader = await createHarness({
      connectionString: writer.testContainer.connectionString,
      seedBase: false,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
        outboxConfig: {
          processingLeaseMs: 5000,
          heartbeatIntervalMs: 1000,
        },
      },
    });

    expect(await reader.testContainer.processOutboxOnce()).toBe(0);

    const rows = await pendingOutboxStatuses(reader);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('processing');

    const records = await listRecordsWithoutDrain(reader, targetTableId);
    expect(getLookupValues(records, lookupFieldId)).toEqual([100]);

    // This fixture deliberately leaves a healthy lease; retire it before a shared-DB next case.
    (await resolveOutbox(writer).markDone(rows[0].id))._unsafeUnwrap();
  });

  it('reclaims stale processing rows after a restart in external mode', async () => {
    const writer = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    const { targetTableId, lookupFieldId } = await prepareLookupScenario(writer);

    await writer.testContainer.db
      .updateTable('computed_update_outbox')
      .set({
        status: 'processing',
        locked_at: new Date(Date.now() - 10_000),
        locked_by: 'crashed-worker:lease',
        updated_at: new Date(Date.now() - 10_000),
      })
      .where('status', '=', 'pending')
      .execute();

    const reader = await createHarness({
      connectionString: writer.testContainer.connectionString,
      seedBase: false,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
        outboxConfig: {
          processingLeaseMs: 5000,
          heartbeatIntervalMs: 1000,
        },
      },
    });

    await reader.testContainer.processOutbox();
    await waitFor(async () => {
      const records = await listRecordsWithoutDrain(reader, targetTableId);
      expect(getLookupValues(records, lookupFieldId)).toEqual([100]);
      expect(await pendingOutboxStatuses(reader)).toHaveLength(0);
    });
  });
});
