/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { getRandomString } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
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
    sourceRecordId: sourceRecord.id,
    sourceValueFieldId,
    targetTableId: targetTable.id,
    targetNameFieldId,
    linkFieldId,
    finalFormulaFieldId: formulaFieldIds[formulaFieldIds.length - 1],
  };
};

describe('computed outbox recovery (e2e)', () => {
  it('retries transient computed lock contention without the generic failure backoff', async () => {
    const harness = await createHarness({
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external' },
      },
    });

    const scenario = await prepareLockContentionScenario(harness);
    const computedLockKey = `v2:computed:${scenario.sourceTableId}:${scenario.sourceRecordId}`;
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

      expect(await harness.testContainer.processOutboxOnce()).toBe(0);

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
