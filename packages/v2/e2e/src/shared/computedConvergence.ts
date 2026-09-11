/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  deleteRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import { RecordId } from '@teable/v2-core';
import express from 'express';
import { sql } from 'kysely';
import { expect, vi } from 'vitest';
import { createE2eTestContainer } from './createE2eTestContainer';

type ComputedConfig = NonNullable<Parameters<typeof createE2eTestContainer>[0]>['computedUpdate'];
export type ExecutionProfile = { name: string; config: ComputedConfig };
const staged = (
  name: string,
  outboxConfig: NonNullable<ComputedConfig>['outboxConfig']
): ExecutionProfile => ({
  name,
  config: {
    mode: 'hybrid',
    hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
    outboxConfig: {
      stageMaxSteps: 0,
      stageMaxFields: 0,
      stageMaxEdges: 0,
      stageMaxDirtyRecords: 0,
      stageSmallRunComplexityThreshold: 0,
      ...outboxConfig,
    },
  },
});

export const executionProfiles: ExecutionProfile[] = [
  { name: 'sync', config: { mode: 'sync' } },
  {
    name: 'hybrid',
    config: {
      mode: 'hybrid',
      hybridConfig: { dispatchMode: 'external', syncPolicy: 'seedTableOnly' },
    },
  },
  staged('unbounded', {}),
  staged('single-step', { stageMaxSteps: 1 }),
  staged('ledger-spill', { stageMaxSteps: 1, stageMaxDirtyRecords: 2, seedInlineLimit: 0 }),
  staged('whole-table-seeds', {
    stageMaxSteps: 2,
    stageMaxDirtyRecords: 2,
    stageSeedAllThreshold: 1,
    stageMaxCollectedSeedIds: 1,
  }),
  staged('edge-batches', { stageMaxSteps: 1, stageMaxEdges: 1, stageMaxDirtyRecords: 2 }),
  ...(process.env.COMPUTED_PROFILE_SCOPE === 'extended'
    ? [
        staged('field-budget', { stageMaxFields: 1 }),
        staged('relay-disabled', { stageMaxSteps: 1, continuationRelayClaimEnabled: false }),
        staged('seed-chunks', { stageMaxSteps: 2, maxSeedRecordsPerTask: 1, seedInlineLimit: 0 }),
      ]
    : []),
];

export type ConvergenceTable = { id: string; name: string };
export type ExpectedRow = { id: string; cells: Record<string, unknown> };

/** HTTP writes + raw stored-column reads. No computed-read/compiler path is used as an oracle. */
export const createConvergenceHarness = async (profile: ExecutionProfile) => {
  const connectionString = process.env.COMPUTED_DATABASE_URL;
  const testContainer = await createE2eTestContainer({
    dbMode: connectionString ? 'postgres' : 'pglite',
    ...(connectionString ? { connectionString } : {}),
    computedUpdate: profile.config,
  });
  const app = express();
  app.use(createV2ExpressRouter({ createContainer: () => testContainer.container }));
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP listen address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const baseId = testContainer.baseId.toString();
  // A per-container namespace prevents DB collisions; the ordinal suffix fixes
  // sibling-step and frontier ordering across profiles, shrinking and replay.
  const namespace = baseId.slice(-8);
  const ordinals = { fld: 0, tbl: 0, rec: 0 };
  const nextId = (prefix: keyof typeof ordinals) =>
    `${prefix}${namespace}${String(++ordinals[prefix]).padStart(8, '0')}`;
  const recordIds = vi
    .spyOn(RecordId, 'generate')
    .mockImplementation(() => RecordId.create(nextId('rec')));
  const request = async (operation: string, payload: unknown, method = 'POST') => {
    const response = await fetch(`${baseUrl}/tables/${operation}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw new Error(`${operation} ${response.status}: ${JSON.stringify(body)}`);
    return body;
  };
  return {
    testContainer,
    baseId,
    fieldId: () => nextId('fld'),
    async createTable(name: string, fields: Record<string, unknown>[]): Promise<ConvergenceTable> {
      const response = createTableOkResponseSchema.parse(
        await request('create', {
          baseId,
          tableId: nextId('tbl'),
          name,
          fields,
          views: [{ type: 'grid' }],
        })
      );
      return response.data.table;
    },
    async createField(table: ConvergenceTable, field: Record<string, unknown>) {
      await request('createField', { baseId, tableId: table.id, field });
    },
    async createRecord(table: ConvergenceTable, fields: Record<string, unknown>) {
      return createRecordOkResponseSchema.parse(
        await request('createRecord', { tableId: table.id, fields })
      ).data.record.id;
    },
    async updateRecord(table: ConvergenceTable, recordId: string, fields: Record<string, unknown>) {
      updateRecordOkResponseSchema.parse(
        await request('updateRecord', { tableId: table.id, recordId, fields })
      );
    },
    async deleteRecord(table: ConvergenceTable, recordId: string) {
      deleteRecordsOkResponseSchema.parse(
        await request('deleteRecords', { tableId: table.id, recordIds: [recordId] }, 'DELETE')
      );
    },
    async drain() {
      for (let round = 0; round < 300; round++) {
        await testContainer.processOutboxOnce();
        const pending = await sql<{ count: number }>`SELECT count(*)::int AS count
          FROM computed_update_outbox WHERE base_id = ${baseId}`.execute(testContainer.db);
        if (pending.rows[0].count === 0) {
          const dead = await sql<{ count: number }>`SELECT count(*)::int AS count
            FROM computed_update_dead_letter WHERE base_id = ${baseId}`.execute(testContainer.db);
          expect(dead.rows[0].count, `No dead work: ${profile.name}`).toBe(0);
          return;
        }
      }
      throw new Error(`Outbox failed to settle: ${profile.name}`);
    },
    async assertStored(table: ConvergenceTable, expected: ExpectedRow[], checkpoint: string) {
      const metadata = await sql<{
        db_table_name: string;
      }>`SELECT db_table_name FROM table_meta WHERE id = ${table.id}`.execute(testContainer.db);
      const columns = await sql<{
        id: string;
        db_field_name: string;
      }>`SELECT id, db_field_name FROM field WHERE table_id = ${table.id} AND deleted_time IS NULL`.execute(
        testContainer.db
      );
      const byId = new Map(columns.rows.map((column) => [column.id, column.db_field_name]));
      const fieldIds = Object.keys(expected[0]?.cells ?? {});
      const selected = fieldIds.map((id) => {
        const column = byId.get(id);
        if (!column) throw new Error(`Missing stored column ${id}`);
        return sql`${sql.ref(column)} AS ${sql.id(id)}`;
      });
      const rows = await sql<
        Record<string, unknown>
      >`SELECT __id${selected.length ? sql`, ${sql.join(selected)}` : sql``}
        FROM ${sql.table(metadata.rows[0].db_table_name)} ORDER BY __id`.execute(testContainer.db);
      const actual = Object.fromEntries(
        rows.rows.map(({ __id, ...cells }) => [String(__id), cells])
      );
      expect(
        actual,
        `COMPUTED_CONVERGENCE_VALUE ${profile.name} / ${checkpoint} / ${table.name}`
      ).toEqual(Object.fromEntries(expected.map(({ id, cells }) => [id, cells])));
    },
    async close() {
      try {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      } finally {
        recordIds.mockRestore();
        await testContainer.dispose();
      }
    },
  };
};
export type ConvergenceHarness = Awaited<ReturnType<typeof createConvergenceHarness>>;
