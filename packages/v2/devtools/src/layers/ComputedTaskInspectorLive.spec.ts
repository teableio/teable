/* eslint-disable @typescript-eslint/naming-convention */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ComputedUpdateOutboxConfig,
  type IComputedUpdateOutbox,
  v2RecordRepositoryPostgresTokens,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  BaseId,
  CreateTableCommand,
  FieldId,
  RecordId,
  type CreateTableResult,
  type ICommandBus,
  v2CoreTokens,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import { Effect, Layer } from 'effect';
import { type Kysely, sql } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import {
  ComputedTaskInspector,
  type ReplayComputedQueueInput,
} from '../services/ComputedTaskInspector';
import { Database, DatabaseConfig } from '../services/Database';
import { ComputedTaskInspectorLive } from './ComputedTaskInspectorLive';
import { DatabasePgliteLive } from './DatabasePgliteLive';

type ReplayTable = {
  baseId: string;
  tableId: string;
  dbTableName: string;
  formulaFieldId: string;
  valueColumn: string;
  formulaColumn: string;
};

describe('ComputedTaskInspectorLive replay', () => {
  it('executes its container lane without older foreign tasks starving replay or inflating remaining counts', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'computed-replay-lane-'));
    let db: Kysely<V1TeableDatabase> | undefined;

    try {
      vi.stubEnv('TEABLE_WORKER_LANE', 'staging');
      const database = await Effect.runPromise(
        Database.pipe(
          Effect.provide(
            DatabasePgliteLive.pipe(
              Layer.provide(
                Layer.succeed(DatabaseConfig, { connectionString: `pglite://${dataDir}` })
              )
            )
          )
        )
      );
      const { container, baseId } = database;
      if (!baseId) throw new Error('PGlite database did not create a base');
      const dataDb = container.resolve<Kysely<V1TeableDatabase>>(
        v2RecordRepositoryPostgresTokens.db
      );
      db = dataDb;
      const outboxConfig = container.resolve<ComputedUpdateOutboxConfig>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
      );
      expect(outboxConfig.workerLane).toBe('staging');
      // Replay must use the already-created container configuration, not re-read the environment.
      vi.stubEnv('TEABLE_WORKER_LANE', 'production');

      const commandBus = container.resolve<ICommandBus>(v2CoreTokens.commandBus);
      const outbox = container.resolve<IComputedUpdateOutbox>(
        v2RecordRepositoryPostgresTokens.computedUpdateOutbox
      );
      const context = { actorId: ActorId.create('replay-lane-test')._unsafeUnwrap() };
      const otherBaseId = BaseId.generate()._unsafeUnwrap().toString();
      const base = await dataDb
        .selectFrom('base')
        .select(['space_id', 'name'])
        .where('id', '=', baseId)
        .executeTakeFirstOrThrow();
      await dataDb
        .insertInto('base')
        .values({
          id: otherBaseId,
          space_id: base.space_id,
          name: 'Other replay base',
          order: 2,
          created_by: context.actorId.toString(),
        })
        .execute();

      const createTable = async (targetBaseId: string): Promise<ReplayTable> => {
        const valueFieldId = FieldId.generate()._unsafeUnwrap().toString();
        const formulaFieldId = FieldId.generate()._unsafeUnwrap().toString();
        const command = CreateTableCommand.create({
          baseId: targetBaseId,
          name: 'Replay lane records',
          fields: [
            { id: valueFieldId, type: 'number', name: 'Value', isPrimary: true },
            {
              id: formulaFieldId,
              type: 'formula',
              name: 'Doubled',
              options: { expression: `{${valueFieldId}} * 2` },
            },
          ],
        })._unsafeUnwrap();
        const { table } = (
          await commandBus.execute<CreateTableCommand, CreateTableResult>(context, command)
        )._unsafeUnwrap();
        return {
          baseId: targetBaseId,
          tableId: table.id().toString(),
          dbTableName: table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap(),
          formulaFieldId,
          valueColumn: table
            .getField((field) => field.id().toString() === valueFieldId)
            ._unsafeUnwrap()
            .dbFieldName()
            ._unsafeUnwrap()
            .value()
            ._unsafeUnwrap(),
          formulaColumn: table
            .getField((field) => field.id().toString() === formulaFieldId)
            ._unsafeUnwrap()
            .dbFieldName()
            ._unsafeUnwrap()
            .value()
            ._unsafeUnwrap(),
        };
      };
      const primaryTable = await createTable(baseId);
      const otherTable = await createTable(otherBaseId);
      const enqueue = async (
        table: ReplayTable,
        workerLane: string,
        value: number,
        nextRunAt: Date,
        status: 'pending' | 'processing' = 'pending'
      ) => {
        const recordId = RecordId.generate()._unsafeUnwrap().toString();
        // Persist stale computed values so successful replay must do real formula work.
        await sql`INSERT INTO ${sql.table(table.dbTableName)}
          (__id, __version, __created_by, __last_modified_by,
            ${sql.ref(table.valueColumn)}, ${sql.ref(table.formulaColumn)})
          VALUES (${recordId}, 1, ${context.actorId.toString()},
            ${context.actorId.toString()}, ${value}, 0)`.execute(dataDb);
        const { taskId } = (
          await outbox.enqueueOrMerge({
            baseId: table.baseId,
            seedTableId: table.tableId,
            seedRecordIds: [recordId],
            extraSeedRecords: [],
            beforeImageRecords: [],
            steps: [{ tableId: table.tableId, fieldIds: [table.formulaFieldId], level: 0 }],
            edges: [],
            estimatedComplexity: 1,
            changeType: 'update',
            planHash: recordId,
            runId: `run-${recordId}`,
            originRunIds: [],
            runTotalSteps: 1,
            runCompletedStepsBefore: 0,
            affectedTableIds: [table.tableId],
            affectedFieldIds: [table.formulaFieldId],
            syncMaxLevel: -1,
          })
        )._unsafeUnwrap();
        await dataDb
          .updateTable('computed_update_outbox')
          .set({ worker_lane: workerLane, next_run_at: nextRunAt, status })
          .where('id', '=', taskId)
          .execute();
        return {
          taskId,
          computedValue: async () => {
            const { rows } = await sql<{ value: number }>`
              SELECT ${sql.ref(table.formulaColumn)} AS value
              FROM ${sql.table(table.dbTableName)} WHERE __id = ${recordId}`.execute(dataDb);
            return rows[0]?.value;
          },
        };
      };

      const foreign = await enqueue(primaryTable, 'production', 10, new Date('2026-01-01'));
      const foreignOtherBase = await enqueue(
        otherTable,
        'production',
        20,
        new Date('2026-01-02'),
        'processing'
      );
      const ownFirst = await enqueue(primaryTable, 'staging', 30, new Date('2026-01-03'));
      const ownSecond = await enqueue(primaryTable, 'staging', 40, new Date('2026-01-04'));
      const ownOtherBase = await enqueue(otherTable, 'staging', 50, new Date('2026-01-05'));
      const foreignRows = await dataDb
        .selectFrom('computed_update_outbox')
        .selectAll()
        .where('worker_lane', '=', 'production')
        .orderBy('id')
        .execute();
      const layer = ComputedTaskInspectorLive.pipe(
        Layer.provide(Layer.succeed(Database, database))
      );
      const replay = (input: Omit<ReplayComputedQueueInput, 'workerId'>) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const inspector = yield* ComputedTaskInspector;
            return yield* inspector.replayQueue({ ...input, workerId: 'staging-replay' });
          }).pipe(Effect.provide(layer))
        );

      const snapshot = await replay({ limit: 0, top: 1 });
      expect(snapshot).toMatchObject({ processed: 0, initialRemaining: 3, finalRemaining: 3 });
      expect(snapshot.remainingByBaseTable.rows).toEqual([
        { baseId, baseName: base.name, remaining: 2 },
      ]);

      const limited = await replay({ baseIds: [baseId], limit: 1 });
      expect(limited).toMatchObject({ processed: 1, initialRemaining: 2, finalRemaining: 1 });
      expect(limited.remainingByBaseTable.rows).toEqual([
        { baseId, baseName: base.name, remaining: 1 },
      ]);
      expect(await ownFirst.computedValue()).toBe(60);
      expect(await ownSecond.computedValue()).toBe(0);
      expect(await ownOtherBase.computedValue()).toBe(0);

      const scopedDrain = await replay({ baseIds: [baseId] });
      expect(scopedDrain).toMatchObject({ processed: 1, initialRemaining: 1, finalRemaining: 0 });
      expect(scopedDrain.remainingByBaseTable.rows).toEqual([]);
      expect(await ownSecond.computedValue()).toBe(80);
      expect(await ownOtherBase.computedValue()).toBe(0);

      const drain = await replay({});
      expect(drain).toMatchObject({ processed: 1, initialRemaining: 1, finalRemaining: 0 });
      expect(drain.remainingByBaseTable.rows).toEqual([]);
      expect(await ownOtherBase.computedValue()).toBe(100);
      expect(await foreign.computedValue()).toBe(0);
      expect(await foreignOtherBase.computedValue()).toBe(0);
      expect(
        await dataDb.selectFrom('computed_update_outbox').selectAll().orderBy('id').execute()
      ).toEqual(foreignRows);
    } finally {
      vi.unstubAllEnvs();
      await db?.destroy();
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
