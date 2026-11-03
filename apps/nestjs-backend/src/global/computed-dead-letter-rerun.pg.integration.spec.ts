import { readFileSync } from 'node:fs';
import { setTimeout as waitUntilDue } from 'node:timers/promises';
import { PgPoolRegistry } from '@teable/db-main-prisma';
import type { ComputedUpdateWorker } from '@teable/v2-adapter-table-repository-postgres';
import {
  v2RecordRepositoryPostgresTokens,
  ComputedUpdateOutbox,
  defaultComputedUpdateOutboxConfig,
  type ComputedUpdateOutboxItem,
  deserializeSeedPayload,
  buildOutboxTaskInput,
  type ComputedUpdatePlanner,
  type ComputedFieldUpdater,
  type ComputedUpdateOutboxConfig,
  type IComputedUpdateOutbox,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  ActorId,
  CreateRecordsCommand,
  getRandomString,
  CreateTableCommand,
  UpdateRecordsCommand,
  DeleteRecordsCommand,
  type DeleteRecordsResult,
  type Table,
  v2CoreTokens,
  type CreateRecordsResult,
  type IHasher,
  type CreateTableResult,
  type ICommandBus,
  type IUnitOfWork,
  type UpdateRecordsResult,
} from '@teable/v2-core';
import createKnex from 'knex';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '../../../../packages/v2/container-node-test/src';
import {
  DataDbClientManager,
  restoreComputedOutboxDeadLetterRows,
  type IComputedOutboxDeadLetterRow,
} from './data-db-client-manager.service';
import { DataDbRuntimeCacheService } from './data-db-runtime-cache.service';
import { buildMigrationSharedTableSqlCopyPlans } from '../features/space/space-data-db-copy-plan';
import {
  dataDbKnexClientFactory,
  type IDataDbPreflightClient,
} from '../features/space/data-db-preflight.service';

// The shared helper drains only currently due work. Recovery assertions must also
// await this fixture's scheduled rows: a zero poll is not durable completion.
const drainRecoveredBase = async (runtime: IV2NodeTestContainer): Promise<void> => {
  const worker = runtime.container.resolve<ComputedUpdateWorker>(
    v2RecordRepositoryPostgresTokens.computedUpdateWorker
  );
  const config = runtime.container.resolve<ComputedUpdateOutboxConfig>(
    v2RecordRepositoryPostgresTokens.computedUpdateOutboxConfig
  );
  // ComputedUpdateOutbox.applyRetryJitter is floor(delay * (0.5 + U)), U in [0,1).
  // Ceil(1.5 * delay) therefore bounds every lock-miss retry, not arbitrary test sleep.
  const maxRetryDelayMs = Math.ceil(config.lockUnavailableRetryDelayMs * 1.5);
  // Fixtures have at most five records and three formula levels. One hundred
  // claim rounds bounds their split/partial handoffs and fails a nonconverging queue.
  for (let round = 0; round < 100; round++) {
    const state = await sql<{
      pending: number;
      processing: number;
      dead: number;
      attempts: number;
      waitMs: number;
    }>`select
      count(*) filter(where status='pending')::int as pending,
      count(*) filter(where status='processing')::int as processing,
      (select count(*)::int from computed_update_dead_letter where base_id=${runtime.baseId.toString()} and worker_lane=${config.workerLane}) as dead,
      coalesce(max(attempts),0)::int as attempts,
      coalesce(ceil(greatest(0,extract(epoch from (min(next_run_at) filter(where status='pending') - clock_timestamp()))*1000)),0)::int as "waitMs"
      from computed_update_outbox where base_id=${runtime.baseId.toString()} and worker_lane=${config.workerLane}`.execute(
      runtime.db
    );
    const current = state.rows[0];
    expect(current.dead, 'a rerun must not dead-letter again').toBe(0);
    expect(current.attempts, 'lock retries must not consume failure attempts').toBe(0);
    if (current.pending === 0 && current.processing === 0) return;
    if (current.waitMs > 0 && current.processing === 0) {
      expect(current.waitMs, 'only bounded lock retry deferral is supported').toBeLessThanOrEqual(
        maxRetryDelayMs
      );
      await waitUntilDue(current.waitMs);
    }
    (await worker.runOnce({ workerId: 'recovery-completion', limit: 100 }))._unsafeUnwrap();
  }
  throw new Error('Recovered base still has pending/processing work after 100 claim rounds');
};

// Requires a real PostgreSQL container or TEABLE_V2_TEST_DATABASE_URL. Unit CI skips it; run with:
// TEABLE_V2_RUN_PG_INTEGRATION=1 pnpm --filter @teable/backend exec vitest run
//   src/global/computed-dead-letter-rerun.pg.integration.spec.ts
it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1').each(['insert', 'update'] as const)(
  'admin recovery reruns a committed partial %s continuation and converges every downstream value',
  async (changeType) => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          seedInlineLimit: 1,
          // The spilled five-row input splits, but its three-row child still
          // exceeds the two-row dirty budget and must commit a partial batch.
          maxSeedRecordsPerTask: 3,
          stageMaxSteps: 1,
          stageMaxDirtyRecords: 2,
          stageSmallRunComplexityThreshold: 0,
          continuationRelayClaimEnabled: false,
        },
      },
    });
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const bus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const worker = runtime.container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    try {
      const ids = {
        name: `fld${getRandomString(16)}`,
        value: `fld${getRandomString(16)}`,
        first: `fld${getRandomString(16)}`,
        second: `fld${getRandomString(16)}`,
        third: `fld${getRandomString(16)}`,
      };
      const created = (
        await bus.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create({
            baseId: runtime.baseId.toString(),
            name: 'Dead letter partial stage rerun',
            fields: [
              { id: ids.name, type: 'singleLineText', name: 'Name', isPrimary: true },
              { id: ids.value, type: 'number', name: 'Value' },
              {
                id: ids.first,
                type: 'formula',
                name: 'First',
                options: { expression: `{${ids.value}} + 1` },
              },
              {
                id: ids.second,
                type: 'formula',
                name: 'Second',
                options: { expression: `{${ids.first}} + 1` },
              },
              {
                id: ids.third,
                type: 'formula',
                name: 'Third',
                options: { expression: `{${ids.second}} + 1` },
              },
            ],
            views: [{ type: 'grid' }],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().table;
      const records = (
        await bus.execute<CreateRecordsCommand, CreateRecordsResult>(
          context,
          CreateRecordsCommand.create({
            tableId: created.id().toString(),
            records: Array.from({ length: 5 }, (_, index) => ({
              fields: {
                [ids.name]: `Row ${index}`,
                [ids.value]: changeType === 'insert' ? 100 + index : index,
              },
            })),
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().records;
      const recordIds = records.map((record) => record.id().toString());
      if (changeType === 'update') {
        await drainRecoveredBase(runtime);
        (
          await bus.execute<UpdateRecordsCommand, UpdateRecordsResult>(
            context,
            UpdateRecordsCommand.create({
              tableId: created.id().toString(),
              records: recordIds.map((id, index) => ({ id, fields: { [ids.value]: 100 + index } })),
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
      }

      let continuation: string | undefined;
      for (let iteration = 0; iteration < 10; iteration++) {
        (await worker.runOnce({ workerId: 'partial-stage', limit: 1 }))._unsafeUnwrap();
        const candidate = await runtime.db
          .selectFrom('computed_update_outbox')
          .selectAll()
          .where('base_id', '=', runtime.baseId.toString())
          .executeTakeFirst();
        if (
          candidate &&
          candidate.dirty_stats &&
          typeof candidate.dirty_stats === 'object' &&
          'ledgerScopeId' in candidate.dirty_stats &&
          'partialStageBudget' in candidate.dirty_stats
        ) {
          continuation = String(candidate.id);
          break;
        }
      }
      expect(continuation).toBeDefined();
      if (!continuation) throw new Error('No partial continuation was committed');
      const claimed = (
        await outbox.claimById({ taskId: continuation, workerId: 'fail-partial' })
      )._unsafeUnwrap();
      expect(claimed).not.toBeNull();
      if (!claimed || !('ledgerScopeId' in claimed))
        throw new Error('Expected planned continuation');
      expect(claimed.id).not.toBe(claimed.ledgerScopeId);
      expect(claimed.predecessorTaskId).toBeTruthy();
      expect(claimed.ledgerScopeId).toBeTruthy();
      const scope = claimed.ledgerScopeId ?? claimed.id;
      const ledger = await sql<{
        count: number;
      }>`select count(*)::int as count from computed_update_stage_ledger where scope_id = ${scope}`.execute(
        runtime.db
      );
      expect(ledger.rows[0].count).toBeGreaterThan(0);
      const completed = await runtime.db
        .selectFrom('computed_update_run_history')
        .select('task_id')
        .where('task_id', '=', claimed.predecessorTaskId!)
        .execute();
      expect(completed.length).toBeGreaterThan(0);
      (
        await outbox.markFailed(claimed, 'Injected partial-stage terminal failure', undefined, {
          directDeadLetter: true,
        })
      )._unsafeUnwrap();
      // Exercise the migration's shared-table snapshot path before the actual
      // manager/worker convergence below. The target owns the table data, while
      // this isolated source schema represents its archived failure input.
      const archiveSource = `settlement_src_${getRandomString(10).toLowerCase()}`;
      await sql`create schema ${sql.id(archiveSource)}`.execute(runtime.db);
      try {
        for (const table of ['computed_update_dead_letter', 'computed_update_dead_letter_seed']) {
          await sql`create table ${sql.id(archiveSource, table)}
            (like ${sql.id('public', table)} including all)`.execute(runtime.db);
        }
        await sql`alter table ${sql.id(archiveSource, 'computed_update_dead_letter_seed')}
          add foreign key(task_id) references ${sql.id(archiveSource, 'computed_update_dead_letter')}(id) on delete cascade`.execute(
          runtime.db
        );
        await sql`insert into ${sql.id(archiveSource, 'computed_update_dead_letter')}
          select * from computed_update_dead_letter where id=${continuation}`.execute(runtime.db);
        await sql`insert into ${sql.id(archiveSource, 'computed_update_dead_letter_seed')}
          select * from computed_update_dead_letter_seed where task_id=${continuation}`.execute(
          runtime.db
        );
        await sql`select computed_outbox_discard(array[${continuation}]::text[])`.execute(
          runtime.db
        );
        const snapshotPlans = buildMigrationSharedTableSqlCopyPlans({
          sourceSchema: archiveSource,
          targetSchema: 'public',
          spaceId: 'spc-settlement-migration',
          baseIds: [runtime.baseId.toString()],
          tableIds: [created.id().toString()],
        }).filter((plan) =>
          ['computed_update_dead_letter', 'computed_update_dead_letter_seed'].includes(plan.table)
        );
        for (const plan of snapshotPlans) {
          await sql.raw(plan.resetSql).execute(runtime.db);
          await sql.raw(plan.copySql).execute(runtime.db);
        }
      } finally {
        await sql`drop schema ${sql.id(archiveSource)} cascade`.execute(runtime.db);
      }

      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      expect(
        await manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: 'partial-recovery',
            url: runtime.connectionString,
            isMetaFallback: true,
            storage: 'default',
          },
          continuation,
          'dead',
          1000
        )
      ).toMatchObject({ status: 'recovered' });
      await drainRecoveredBase(runtime);

      const dbName = created
        .dbTableName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      const columns = new Map(
        created.getFields().map((field) => [
          field.id().toString(),
          field
            .dbFieldName()
            .andThen((name) => name.value())
            ._unsafeUnwrap(),
        ])
      );
      const rows = await sql<
        Record<string, unknown>
      >`select * from ${sql.table(dbName)} order by ${sql.ref(columns.get(ids.value)!)}`.execute(
        runtime.db
      );
      expect(rows.rows).toHaveLength(5);
      rows.rows.forEach((row, index) => {
        expect(row[columns.get(ids.value)!]).toBe(100 + index);
        expect(row[columns.get(ids.first)!]).toBe(101 + index);
        expect(row[columns.get(ids.second)!]).toBe(102 + index);
        expect(row[columns.get(ids.third)!]).toBe(103 + index);
      });
      const state = await sql<{
        outbox: number;
        dead: number;
        ledger: number;
        frontier: number;
        archivedSeeds: number;
      }>`select
      (select count(*)::int from computed_update_outbox where base_id = ${runtime.baseId.toString()}) as outbox,
      (select count(*)::int from computed_update_dead_letter where base_id = ${runtime.baseId.toString()}) as dead,
      (select count(*)::int from computed_update_stage_ledger where scope_id = ${scope}) as ledger,
      (select count(*)::int from computed_update_change_frontier where scope_id = ${scope}) as frontier,
      (select count(*)::int from computed_update_dead_letter_seed where task_id = ${claimed.id}) as "archivedSeeds"`.execute(
        runtime.db
      );
      expect(state.rows[0]).toEqual({
        outbox: 0,
        dead: 0,
        ledger: 0,
        frontier: 0,
        archivedSeeds: 0,
      });
    } finally {
      await runtime.db
        .deleteFrom('computed_update_outbox')
        .where('base_id', '=', runtime.baseId.toString())
        .execute();
      await sql`select computed_outbox_discard_base(array[${runtime.baseId.toString()}]::text[])`.execute(
        runtime.db
      );
      await runtime.dispose();
    }
  },
  120_000
);

it
  .runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')
  .each(['delete', 'next-stage-update', 'historical-cross-table', 'committed-source'] as const)(
  'restores exact cross-table values after partial %s terminal failure',
  async (mutation) => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          stageMaxSteps: 1,
          stageMaxDirtyRecords: 2,
          stageSmallRunComplexityThreshold: 0,
          continuationRelayClaimEnabled: false,
        },
      },
    });
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const bus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const worker = runtime.container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    const id = () => `fld${getRandomString(16)}`;
    const fields = {
      sourceName: id(),
      value: id(),
      sourceFormula: id(),
      name: id(),
      link: id(),
      lookup: id(),
      first: id(),
      second: id(),
    };
    const create = async (input: unknown) =>
      (
        await bus.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create(input)._unsafeUnwrap()
        )
      )._unsafeUnwrap().table;
    const insert = async (table: Table, records: Array<{ fields: Record<string, unknown> }>) =>
      (
        await bus.execute<CreateRecordsCommand, CreateRecordsResult>(
          context,
          CreateRecordsCommand.create({ tableId: table.id().toString(), records })._unsafeUnwrap()
        )
      )._unsafeUnwrap().records;
    try {
      const source = await create({
        baseId: runtime.baseId.toString(),
        name: 'Rerun sources',
        views: [{ type: 'grid' }],
        fields: [
          { id: fields.sourceName, name: 'Name', type: 'singleLineText', isPrimary: true },
          { id: fields.value, name: 'Value', type: 'number' },
          {
            id: fields.sourceFormula,
            name: 'Computed source',
            type: 'formula',
            options: { expression: `{${fields.value}} + 1` },
          },
        ],
      });
      const target = await create({
        baseId: runtime.baseId.toString(),
        name: 'Rerun targets',
        views: [{ type: 'grid' }],
        fields: [
          { id: fields.name, name: 'Name', type: 'singleLineText', isPrimary: true },
          {
            id: fields.link,
            name: 'Source',
            type: 'link',
            options: {
              relationship: 'manyOne',
              foreignTableId: source.id().toString(),
              lookupFieldId: fields.sourceName,
            },
          },
          {
            id: fields.lookup,
            name: 'Lookup',
            type: 'lookup',
            options: {
              linkFieldId: fields.link,
              foreignTableId: source.id().toString(),
              lookupFieldId: fields.sourceFormula,
            },
          },
          {
            id: fields.first,
            name: 'First',
            type: 'formula',
            options: {
              expression: `IF(COUNTA({${fields.lookup}}) > 0, SUM({${fields.lookup}}), 0)`,
            },
          },
          {
            id: fields.second,
            name: 'Second',
            type: 'formula',
            options: { expression: `{${fields.first}} + 1` },
          },
        ],
      });
      const sources = await insert(
        source,
        Array.from({ length: 5 }, (_, index) => ({
          fields: { [fields.sourceName]: `Source ${index}`, [fields.value]: index },
        }))
      );
      await drainRecoveredBase(runtime);
      await insert(
        target,
        sources.map((record, index) => ({
          fields: {
            [fields.name]: `Target ${index}`,
            [fields.link]: { id: record.id().toString() },
          },
        }))
      );
      await drainRecoveredBase(runtime);
      if (mutation === 'delete') {
        (
          await bus.execute<DeleteRecordsCommand, DeleteRecordsResult>(
            context,
            DeleteRecordsCommand.create({
              tableId: source.id().toString(),
              recordIds: sources.map((record) => record.id().toString()),
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
      } else if (mutation === 'historical-cross-table' || mutation === 'committed-source') {
        (
          await bus.execute<UpdateRecordsCommand, UpdateRecordsResult>(
            context,
            UpdateRecordsCommand.create({
              tableId: source.id().toString(),
              records: sources.map((record, index) => ({
                id: record.id().toString(),
                fields: { [fields.value]: 100 + index },
              })),
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
      } else {
        // Supply a real source-only computed job (the executor's public task boundary).
        // The worker must finish it and plan the cross-table next propagation stage itself.
        const sourceDbName = source
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const valueColumn = source
          .getFields()
          .find((field) => field.id().toString() === fields.value)!
          .dbFieldName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        await sql`update ${sql.table(sourceDbName)} set ${sql.ref(valueColumn)} = ${sql.ref(valueColumn)} + 100`.execute(
          runtime.db
        );
        (
          await outbox.enqueueOrMerge({
            baseId: runtime.baseId.toString(),
            seedTableId: source.id().toString(),
            seedRecordIds: sources.map((record) => record.id().toString()),
            extraSeedRecords: [],
            beforeImageRecords: [],
            steps: [
              { level: 0, tableId: source.id().toString(), fieldIds: [fields.sourceFormula] },
            ],
            edges: [],
            changeType: 'update',
            planHash: `next-stage-${getRandomString(16)}`,
            estimatedComplexity: 5,
            runId: `cur${getRandomString(16)}`,
            originRunIds: [],
            runTotalSteps: 1,
            runCompletedStepsBefore: 0,
            affectedTableIds: [source.id().toString()],
            affectedFieldIds: [fields.sourceFormula],
            sourceFieldIds: [fields.value],
            syncMaxLevel: 0,
          })
        )._unsafeUnwrap();
      }
      let failedId: string | undefined;
      if (mutation === 'historical-cross-table' || mutation === 'committed-source') {
        const initial = await runtime.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('base_id', '=', runtime.baseId.toString())
          .executeTakeFirstOrThrow();
        failedId = initial.id;
      }
      for (let i = 0; !failedId && i < 50; i++) {
        (await worker.runOnce({ workerId: 'advance-cross-stage', limit: 1 }))._unsafeUnwrap();
        const pending = await runtime.db
          .selectFrom('computed_update_outbox')
          .selectAll()
          .where('base_id', '=', runtime.baseId.toString())
          .execute();
        const candidate = pending.find((row) => {
          const data = row.dirty_stats;
          return (
            data &&
            typeof data === 'object' &&
            'partialStageBudget' in data &&
            (mutation === 'delete' || Number(row.stage_depth) > 0)
          );
        });
        if (candidate) {
          failedId = candidate.id;
          break;
        }
      }
      expect(failedId).toBeDefined();
      if (!failedId) throw new Error('No qualifying cross-table partial continuation');
      let failed = (
        await outbox.claimById({ taskId: failedId, workerId: 'fail-cross-stage' })
      )._unsafeUnwrap();
      if (
        (mutation === 'historical-cross-table' || mutation === 'committed-source') &&
        failed &&
        'taskType' in failed &&
        failed.taskType === 'seed'
      ) {
        const seed = deserializeSeedPayload(failed)._unsafeUnwrap();
        const planner = runtime.container.resolve<ComputedUpdatePlanner>(
          v2RecordRepositoryPostgresTokens.computedUpdatePlanner
        );
        const plan = (await planner.planStage({ ...seed, table: source }, context))._unsafeUnwrap();
        if (mutation === 'committed-source') {
          const updater = runtime.container.resolve<ComputedFieldUpdater>(
            v2RecordRepositoryPostgresTokens.computedFieldUpdater
          );
          const unitOfWork = runtime.container.resolve<IUnitOfWork>(v2CoreTokens.unitOfWork);
          const sourceCommit = await unitOfWork.withTransaction(context, (txContext) =>
            updater.execute(
              {
                ...plan,
                steps: plan.steps.filter((step) => step.tableId.equals(source.id())),
                edges: [],
                sameTableBatches: [],
              },
              txContext
            )
          );
          if (sourceCommit.isErr())
            throw new Error(`Source-only commit failed: ${sourceCommit.error.message}`);
          const sourceName = source
            .dbTableName()
            .andThen((entry) => entry.value())
            ._unsafeUnwrap();
          const targetName = target
            .dbTableName()
            .andThen((entry) => entry.value())
            ._unsafeUnwrap();
          const sourceColumn = source
            .getFields()
            .find((field) => field.id().toString() === fields.sourceFormula)!
            .dbFieldName()
            .andThen((entry) => entry.value())
            ._unsafeUnwrap();
          const targetColumn = target
            .getFields()
            .find((field) => field.id().toString() === fields.first)!
            .dbFieldName()
            .andThen((entry) => entry.value())
            ._unsafeUnwrap();
          expect(
            (
              await sql<{
                value: number;
              }>`select ${sql.ref(sourceColumn)} as value from ${sql.table(sourceName)} order by ${sql.ref(sourceColumn)}`.execute(
                runtime.db
              )
            ).rows.map((row) => row.value)
          ).toEqual([101, 102, 103, 104, 105]);
          expect(
            (
              await sql<{
                value: number;
              }>`select ${sql.ref(targetColumn)} as value from ${sql.table(targetName)} order by ${sql.ref(targetColumn)}`.execute(
                runtime.db
              )
            ).rows.map((row) => row.value)
          ).toEqual([1, 2, 3, 4, 5]);
        }
        const planned = (
          await outbox.enqueueOrMerge(
            buildOutboxTaskInput({
              plan,
              hasher: runtime.container.resolve<IHasher>(v2CoreTokens.hasher),
              syncMaxLevel: 0,
              runId: failed.runId,
              originRunIds: [],
              runTotalSteps: plan.steps.length,
              runCompletedStepsBefore: 0,
              sourceFieldIds: seed.changedFieldIds.map((fieldId) => fieldId.toString()),
            })
          )
        )._unsafeUnwrap();
        (await outbox.markDone(failed))._unsafeUnwrap();
        failed = (
          await outbox.claimById({ taskId: planned.taskId, workerId: 'legacy-planned' })
        )._unsafeUnwrap();
      }
      if (!failed || !('ledgerScopeId' in failed)) throw new Error('Expected planned partial task');
      if (mutation === 'historical-cross-table' || mutation === 'committed-source') {
        expect(failed.partialStageBudget).toBeUndefined();
        expect(failed.ledgerScopeId).toBeUndefined();
        expect(failed.predecessorTaskId).toBeUndefined();
        expect(failed.seedRecordIds).toHaveLength(5);
        expect(failed.extraSeedRecords).toEqual([]);
        expect(failed.steps.some((step) => step.tableId === target.id().toString())).toBe(true);
      } else {
        expect(failed.partialStageBudget).toBeDefined();
        expect(failed.id).not.toBe(failed.ledgerScopeId);
        if (mutation === 'next-stage-update') expect(failed.stageDepth).toBeGreaterThan(0);
        else expect(failed.changeType).toBe('delete');
        expect(
          await runtime.db
            .selectFrom('computed_update_run_history')
            .select('task_id')
            .where('task_id', '=', failed.predecessorTaskId!)
            .executeTakeFirst()
        ).toBeDefined();
      }
      const scope = failed.ledgerScopeId ?? failed.id;
      (
        await outbox.markFailed(failed, 'Cross-stage terminal failure', undefined, {
          directDeadLetter: true,
        })
      )._unsafeUnwrap();
      if (mutation === 'historical-cross-table') {
        // Reproduce the complete pre-manifest archive representation, not partial data.
        await runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_discard(array[${failed.id}]::text[])`.execute(
            trx
          );
          await sql`update computed_update_dead_letter set seed_record_ids=${JSON.stringify([{ tableId: source.id().toString(), recordIds: failed.seedRecordIds }])}::jsonb,
            dirty_stats=dirty_stats-'rerunInputs', predecessor_task_id=null, stage_depth=0 where id=${failed.id}`.execute(
            trx
          );
          await sql`delete from computed_update_dead_letter_seed where task_id=${failed.id}`.execute(
            trx
          );
        });
      }
      const archived = await runtime.db
        .selectFrom('computed_update_dead_letter')
        .selectAll()
        .where('id', '=', failed.id)
        .executeTakeFirstOrThrow();
      if (mutation === 'historical-cross-table') expect(archived.seed_record_ids).not.toBeNull();
      else expect(archived.seed_record_ids).toBeNull();
      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      expect(
        await manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: 'cross-stage',
            url: runtime.connectionString,
            isMetaFallback: true,
            storage: 'default',
          },
          failed.id,
          'dead',
          1000
        )
      ).toMatchObject({ status: 'recovered' });
      await drainRecoveredBase(runtime);
      const dbName = target
        .dbTableName()
        .andThen((name) => name.value())
        ._unsafeUnwrap();
      const columns = new Map(
        target.getFields().map((field) => [
          field.id().toString(),
          field
            .dbFieldName()
            .andThen((name) => name.value())
            ._unsafeUnwrap(),
        ])
      );
      const rows = await sql<
        Record<string, unknown>
      >`select * from ${sql.table(dbName)} order by ${sql.ref(columns.get(fields.name)!)}`.execute(
        runtime.db
      );
      expect(rows.rows).toHaveLength(5);
      rows.rows.forEach((row, index) => {
        const expected = mutation === 'delete' ? 0 : 101 + index;
        expect(row[columns.get(fields.lookup)!]).toEqual(mutation === 'delete' ? null : [expected]);
        expect(row[columns.get(fields.first)!]).toBe(expected);
        expect(row[columns.get(fields.second)!]).toBe(expected + 1);
      });
      const remaining = await sql<{ count: number }>`select (
        (select count(*) from computed_update_outbox where base_id=${runtime.baseId.toString()}) +
        (select count(*) from computed_update_dead_letter where base_id=${runtime.baseId.toString()}) +
        (select count(*) from computed_update_stage_ledger where scope_id=${scope}) +
        (select count(*) from computed_update_change_frontier where scope_id=${scope}) +
        (select count(*) from computed_update_dead_letter_seed where task_id=${failed.id})
      )::int as count`.execute(runtime.db);
      expect(remaining.rows[0].count).toBe(0);
    } finally {
      await runtime.db
        .deleteFrom('computed_update_outbox')
        .where('base_id', '=', runtime.baseId.toString())
        .execute();
      await sql`select computed_outbox_discard_base(array[${runtime.baseId.toString()}]::text[])`.execute(
        runtime.db
      );
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'preserves mixed exact and seed-all update input through archival',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          stageMaxSteps: 1,
          stageMaxDirtyRecords: 2,
          stageSmallRunComplexityThreshold: 0,
          continuationRelayClaimEnabled: false,
        },
      },
    });
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const bus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    const worker = runtime.container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );
    try {
      const tables: Array<{ table: Table; value: string; computed: string; recordIds: string[] }> =
        [];
      for (let index = 0; index < 2; index++) {
        const name = `fld${getRandomString(16)}`,
          value = `fld${getRandomString(16)}`,
          computed = `fld${getRandomString(16)}`;
        const table = (
          await bus.execute<CreateTableCommand, CreateTableResult>(
            context,
            CreateTableCommand.create({
              baseId: runtime.baseId.toString(),
              name: `Mixed seeds ${index}`,
              views: [{ type: 'grid' }],
              fields: [
                { id: name, name: 'Name', type: 'singleLineText', isPrimary: true },
                { id: value, name: 'Value', type: 'number' },
                {
                  id: computed,
                  name: 'Computed',
                  type: 'formula',
                  options: { expression: `{${value}} + 1` },
                },
              ],
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap().table;
        const records = (
          await bus.execute<CreateRecordsCommand, CreateRecordsResult>(
            context,
            CreateRecordsCommand.create({
              tableId: table.id().toString(),
              records: Array.from({ length: 3 }, (_, row) => ({
                fields: { [name]: `Row ${row}`, [value]: row },
              })),
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap().records;
        tables.push({
          table,
          value,
          computed,
          recordIds: records.map((record) => record.id().toString()),
        });
      }
      await drainRecoveredBase(runtime);
      for (const entry of tables) {
        const dbName = entry.table
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const column = entry.table
          .getFields()
          .find((field) => field.id().toString() === entry.value)!
          .dbFieldName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        await sql`update ${sql.table(dbName)} set ${sql.ref(column)}=${sql.ref(column)}+100`.execute(
          runtime.db
        );
      }
      const first = tables[0];
      (
        await outbox.enqueueOrMerge({
          baseId: runtime.baseId.toString(),
          seedTableId: first.table.id().toString(),
          seedRecordIds: first.recordIds,
          extraSeedRecords: [],
          beforeImageRecords: [],
          seedAllTableIds: [tables[1].table.id().toString()],
          steps: tables.map((entry) => ({
            level: 0,
            tableId: entry.table.id().toString(),
            fieldIds: [entry.computed],
          })),
          edges: [],
          changeType: 'update',
          estimatedComplexity: 6,
          planHash: getRandomString(16),
          runId: `cur${getRandomString(16)}`,
          originRunIds: [],
          runTotalSteps: 2,
          runCompletedStepsBefore: 0,
          affectedTableIds: tables.map((entry) => entry.table.id().toString()),
          affectedFieldIds: tables.map((entry) => entry.computed),
          syncMaxLevel: 0,
        })
      )._unsafeUnwrap();
      let partialId: string | undefined;
      for (let i = 0; i < 50; i++) {
        (await worker.runOnce({ workerId: 'mixed-partial', limit: 1 }))._unsafeUnwrap();
        const rows = await runtime.db
          .selectFrom('computed_update_outbox')
          .selectAll()
          .where('base_id', '=', runtime.baseId.toString())
          .execute();
        const partial = rows.find((row) => {
          const data = row.dirty_stats;
          return (
            data &&
            typeof data === 'object' &&
            'partialStageBudget' in data &&
            'seedAllCursors' in data &&
            data.seedAllCursors &&
            typeof data.seedAllCursors === 'object' &&
            Object.keys(data.seedAllCursors).length > 0
          );
        });
        if (partial) {
          partialId = partial.id;
          break;
        }
      }
      expect(partialId).toBeDefined();
      if (!partialId) throw new Error('Mixed input never committed a partial seed-all cursor');
      const failed = (
        await outbox.claimById({ taskId: partialId, workerId: 'mixed-seeds' })
      )._unsafeUnwrap();
      if (!failed || !('seedAllCursors' in failed)) throw new Error('Expected mixed partial plan');
      expect(Object.keys(failed.seedAllCursors ?? {}).length).toBeGreaterThan(0);
      expect(failed.partialStageBudget).toBeDefined();
      (
        await outbox.markFailed(failed, 'Mixed seed terminal failure', undefined, {
          directDeadLetter: true,
        })
      )._unsafeUnwrap();
      const archivedInput = await sql<{
        seedAll: string[];
        complete: boolean;
        seedCount: string;
      }>`select
        dirty_stats->'seedAllTableIds' as "seedAll",
        (dirty_stats->'rerunInputs'->>'complete')::boolean as complete,
        dirty_stats->'rerunInputs'->>'seedCount' as "seedCount"
        from computed_update_dead_letter where id=${failed.id}`.execute(runtime.db);
      expect(archivedInput.rows[0].seedAll).toContain(tables[1].table.id().toString());
      expect(archivedInput.rows[0].complete).toBe(true);
      expect(Number(archivedInput.rows[0].seedCount)).toBeGreaterThan(0);
      const membership = await sql<{
        count: string;
      }>`select count(*)::text as count from computed_update_dead_letter_seed where task_id=${failed.id}`.execute(
        runtime.db
      );
      expect(membership.rows[0].count).toBe(archivedInput.rows[0].seedCount);
      const exactSources = await sql<{
        recordId: string;
      }>`select record_id as "recordId" from computed_update_dead_letter_seed
        where task_id=${failed.id} and table_id=${first.table.id().toString()} order by record_id`.execute(
        runtime.db
      );
      expect(new Set(exactSources.rows.map((row) => row.recordId))).toEqual(
        new Set(first.recordIds)
      );
      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      expect(
        await manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: 'mixed',
            url: runtime.connectionString,
            isMetaFallback: true,
            storage: 'default',
          },
          failed.id,
          'dead',
          1000
        )
      ).toMatchObject({ status: 'recovered' });
      await drainRecoveredBase(runtime);
      for (const entry of tables) {
        const dbName = entry.table
          .dbTableName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const column = entry.table
          .getFields()
          .find((field) => field.id().toString() === entry.computed)!
          .dbFieldName()
          .andThen((name) => name.value())
          ._unsafeUnwrap();
        const result = await sql<{
          value: number;
        }>`select ${sql.ref(column)} as value from ${sql.table(dbName)} order by ${sql.ref(column)}`.execute(
          runtime.db
        );
        expect(result.rows.map((row) => row.value)).toEqual([101, 102, 103]);
      }
      const remaining = await sql<{ count: number }>`select (
        (select count(*) from computed_update_outbox where base_id=${runtime.baseId.toString()}) +
        (select count(*) from computed_update_dead_letter where base_id=${runtime.baseId.toString()}) +
        (select count(*) from computed_update_dead_letter_seed where task_id=${failed.id}) +
        (select count(*) from computed_update_stage_ledger where scope_id=${failed.ledgerScopeId ?? failed.id}) +
        (select count(*) from computed_update_change_frontier where scope_id=${failed.ledgerScopeId ?? failed.id})
      )::int as count`.execute(runtime.db);
      expect(remaining.rows[0].count).toBe(0);
    } finally {
      await runtime.db
        .deleteFrom('computed_update_outbox')
        .where('base_id', '=', runtime.baseId.toString())
        .execute();
      await sql`select computed_outbox_discard_base(array[${runtime.baseId.toString()}]::text[])`.execute(
        runtime.db
      );
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'archives and restores bounded seeds in a BYODB internal schema',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const schema = `rerun_${getRandomString(12).toLowerCase()}`;
    const taskId = `cuo${getRandomString(16)}`,
      scope = `cuo${getRandomString(16)}`;
    const tableId = `tbl${getRandomString(16)}`;
    try {
      await sql`create schema ${sql.id(schema)}`.execute(runtime.db);
      for (const table of [
        'computed_update_outbox',
        'computed_update_outbox_seed',
        'computed_update_dead_letter',
        'computed_update_dead_letter_seed',
        'computed_update_stage_ledger',
        'computed_update_change_frontier',
      ]) {
        await sql`create table ${sql.id(schema, table)} (like ${sql.id('public', table)} including all)`.execute(
          runtime.db
        );
      }
      await sql`alter table ${sql.id(schema, 'computed_update_dead_letter_seed')} add foreign key(task_id) references ${sql.id(schema, 'computed_update_dead_letter')}(id) on delete cascade`.execute(
        runtime.db
      );
      await runtime.db.transaction().execute(async (trx) => {
        await sql`set local search_path to ${sql.id(schema)}`.execute(trx);
        await sql
          .raw(
            readFileSync(
              new URL(
                '../../../../packages/db-data-prisma/prisma/migrations/20261103000000_guard_computed_dead_letter_seed/migration.sql',
                import.meta.url
              ),
              'utf8'
            )
          )
          .execute(trx);
      });
      const scoped = runtime.db.withSchema(schema);
      const now = new Date();
      await sql`insert into ${sql.id(schema, 'computed_update_outbox')}(id,base_id,seed_table_id,change_type,status,plan_hash,run_id,created_at,updated_at)
      values(${taskId},${runtime.baseId.toString()},${tableId},'insert','processing',${taskId},${taskId},${now},${now})`.execute(
        runtime.db
      );
      await sql`insert into ${sql.id(schema, 'computed_update_stage_ledger')}(scope_id,kind,table_id,record_id)
      values(${scope},'rerun-input-v1','',''),(${scope},'rerun-source',${tableId},'rec-original'),(${scope},'frontier',${tableId},'rec-remaining')`.execute(
        runtime.db
      );
      const task: ComputedUpdateOutboxItem = {
        id: taskId,
        baseId: runtime.baseId.toString(),
        seedTableId: tableId,
        seedRecordIds: [],
        extraSeedRecords: [],
        beforeImageRecords: [],
        changeType: 'insert',
        steps: [{ level: 0, tableId, fieldIds: [`fld${getRandomString(16)}`] }],
        edges: [],
        estimatedComplexity: 2,
        planHash: taskId,
        runId: taskId,
        originRunIds: [],
        runTotalSteps: 1,
        runCompletedStepsBefore: 0,
        affectedTableIds: [tableId],
        affectedFieldIds: [],
        syncMaxLevel: 0,
        ledgerScopeId: scope,
        partialStageBudget: { maxSteps: 1, maxFields: 1, maxEdges: 1 },
        status: 'processing',
        attempts: 0,
        maxAttempts: 1,
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      };
      const logger = {
        info() {},
        warn() {},
        error() {},
        debug() {},
        child() {
          return this;
        },
        scope() {
          return this;
        },
      };
      const outbox = new ComputedUpdateOutbox(scoped, defaultComputedUpdateOutboxConfig, logger);
      (await outbox.markFailed(task, 'BYODB terminal'))._unsafeUnwrap();
      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      expect(
        await manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: schema,
            url: runtime.connectionString,
            isMetaFallback: false,
            storage: 'byodb',
            internalSchema: schema,
          },
          taskId,
          'dead',
          1000
        )
      ).toMatchObject({ status: 'recovered' });
      const restored = await sql<{
        recordId: string;
      }>`select record_id as "recordId" from ${sql.id(schema, 'computed_update_outbox_seed')} where task_id=${taskId} order by record_id`.execute(
        runtime.db
      );
      expect(restored.rows).toEqual([{ recordId: 'rec-original' }, { recordId: 'rec-remaining' }]);
      expect(
        (
          await sql<{
            count: number;
          }>`select count(*)::int as count from ${sql.id(schema, 'computed_update_dead_letter_seed')} where task_id=${taskId}`.execute(
            runtime.db
          )
        ).rows[0].count
      ).toBe(0);
      expect(
        await runtime.db
          .selectFrom('computed_update_outbox')
          .select('id')
          .where('id', '=', taskId)
          .execute()
      ).toEqual([]);
    } finally {
      await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(runtime.db);
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'copies a scoped archive into BYODB and restores its exact durable seed membership',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const sourceSchema = `copy_src_${getRandomString(10).toLowerCase()}`;
    const targetSchema = `copy_tgt_${getRandomString(10).toLowerCase()}`;
    const taskId = `cuo${getRandomString(16)}`;
    const otherTaskId = `cuo${getRandomString(16)}`;
    const tableId = `tbl${getRandomString(16)}`;
    const now = new Date();
    try {
      for (const schema of [sourceSchema, targetSchema]) {
        await sql`create schema ${sql.id(schema)}`.execute(runtime.db);
        for (const table of [
          'computed_update_outbox',
          'computed_update_outbox_seed',
          'computed_update_dead_letter',
          'computed_update_dead_letter_seed',
        ]) {
          await sql`create table ${sql.id(schema, table)} (like ${sql.id('public', table)} including all)`.execute(
            runtime.db
          );
        }
        await sql`alter table ${sql.id(schema, 'computed_update_outbox_seed')}
          add foreign key(task_id) references ${sql.id(schema, 'computed_update_outbox')}(id) on delete cascade`.execute(
          runtime.db
        );
        await sql`alter table ${sql.id(schema, 'computed_update_dead_letter_seed')}
          add foreign key(task_id) references ${sql.id(schema, 'computed_update_dead_letter')}(id) on delete cascade`.execute(
          runtime.db
        );
        for (const table of [
          'base',
          'space_data_db_binding',
          'computed_update_pause_scope',
          'computed_update_stage_ledger',
          'computed_update_change_frontier',
          'computed_task_field_ref',
          'computed_field_activity',
          'computed_table_activity',
        ]) {
          await sql`create table ${sql.id(schema, table)} (like ${sql.id('public', table)} including all)`.execute(
            runtime.db
          );
        }
      }
      await runtime.db.transaction().execute(async (trx) => {
        await sql`set local search_path to ${sql.id(targetSchema)}`.execute(trx);
        await sql
          .raw(
            readFileSync(
              new URL(
                '../../../../packages/db-data-prisma/prisma/migrations/20261103000000_guard_computed_dead_letter_seed/migration.sql',
                import.meta.url
              ),
              'utf8'
            )
          )
          .execute(trx);
      });
      await sql`insert into ${sql.id(sourceSchema, 'computed_update_dead_letter')}
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,failed_at,created_at,updated_at)
        values
        (${taskId},'production',${runtime.baseId.toString()},${tableId},null,'update','[]'::jsonb,
         '[]'::jsonb,'dead',1,8,${now},2,${taskId},
         ${JSON.stringify({ rerunInputs: { version: 1, complete: true, seedCount: '2' } })}::jsonb,
         ${taskId},array[${taskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now}),
        (${otherTaskId},'production','bse-other',${tableId},null,'update','[]'::jsonb,
         '[]'::jsonb,'dead',1,8,${now},1,${otherTaskId},
         ${JSON.stringify({ rerunInputs: { version: 1, complete: true, seedCount: '1' } })}::jsonb,
         ${otherTaskId},array[${otherTaskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now})`.execute(
        runtime.db
      );
      await sql`insert into ${sql.id(sourceSchema, 'computed_update_dead_letter_seed')}
        (task_id,table_id,record_id) values
        (${taskId},${tableId},'rec-a'),(${taskId},${tableId},'rec-b'),
        (${otherTaskId},${tableId},'rec-other')`.execute(runtime.db);

      const plans = buildMigrationSharedTableSqlCopyPlans({
        sourceSchema,
        targetSchema,
        spaceId: 'spc-copy-recovery',
        baseIds: [runtime.baseId.toString()],
        tableIds: [tableId],
      }).filter((plan) =>
        ['computed_update_dead_letter', 'computed_update_dead_letter_seed'].includes(plan.table)
      );
      for (const plan of plans) {
        await sql.raw(plan.resetSql).execute(runtime.db);
        await sql.raw(plan.copySql).execute(runtime.db);
      }
      const copied = await sql<{
        taskId: string;
        recordId: string;
      }>`select task_id as "taskId", record_id as "recordId"
        from ${sql.id(targetSchema, 'computed_update_dead_letter_seed')}
        order by record_id`.execute(runtime.db);
      expect(copied.rows).toEqual([
        { taskId, recordId: 'rec-a' },
        { taskId, recordId: 'rec-b' },
      ]);

      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      await expect(
        manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: targetSchema,
            url: runtime.connectionString,
            isMetaFallback: false,
            storage: 'byodb',
            internalSchema: targetSchema,
          },
          taskId,
          'dead',
          1000
        )
      ).resolves.toMatchObject({ status: 'recovered' });
      const restored = await sql<{ recordId: string }>`select record_id as "recordId"
        from ${sql.id(targetSchema, 'computed_update_outbox_seed')}
        where task_id=${taskId} order by record_id`.execute(runtime.db);
      expect(restored.rows).toEqual([{ recordId: 'rec-a' }, { recordId: 'rec-b' }]);
      const scopedOutbox = new ComputedUpdateOutbox(
        runtime.db.withSchema(targetSchema),
        defaultComputedUpdateOutboxConfig,
        {
          info() {},
          warn() {},
          error() {},
          debug() {},
          child() {
            return this;
          },
          scope() {
            return this;
          },
        }
      );
      const claimResult = await scopedOutbox.claimById({
        taskId,
        workerId: 'copied-archive-consumer',
      });
      if (claimResult.isErr()) throw claimResult.error;
      const claimed = claimResult.value;
      // Planned reruns move their bounded membership into the stage ledger before
      // the worker claims them; no archive IDs remain inline.
      expect(claimed?.seedRecordIds).toEqual([]);
      expect(claimed?.extraSeedRecords).toEqual([]);
      const hydrated = await sql<{ kind: string; tableId: string; recordId: string }>`select
        kind, table_id as "tableId", record_id as "recordId"
        from ${sql.id(targetSchema, 'computed_update_stage_ledger')}
        where scope_id=${taskId} and kind in ('frontier','rerun-source')
        order by kind, record_id`.execute(runtime.db);
      expect(hydrated.rows).toEqual([
        { kind: 'frontier', tableId, recordId: 'rec-a' },
        { kind: 'frontier', tableId, recordId: 'rec-b' },
        { kind: 'rerun-source', tableId, recordId: 'rec-a' },
        { kind: 'rerun-source', tableId, recordId: 'rec-b' },
      ]);
      const remaining = await sql<{ count: number }>`select (
        (select count(*) from ${sql.id(targetSchema, 'computed_update_dead_letter')} where id=${taskId}) +
        (select count(*) from ${sql.id(targetSchema, 'computed_update_dead_letter_seed')} where task_id=${taskId})
      )::int as count`.execute(runtime.db);
      expect(remaining.rows[0].count).toBe(0);
    } finally {
      await sql`drop schema if exists ${sql.id(sourceSchema)} cascade`.execute(runtime.db);
      await sql`drop schema if exists ${sql.id(targetSchema)} cascade`.execute(runtime.db);
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'bounds the first planned rerun claim before hydrating archived membership and computes every row',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
      computedUpdate: {
        hybridConfig: { dispatchMode: 'external', syncPolicy: 'none' },
        outboxConfig: {
          maxSeedRecordsPerTask: 2,
          stageMaxDirtyRecords: 2,
          stageMaxSteps: 1,
          continuationRelayClaimEnabled: false,
        },
      },
    });
    const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
    const bus = runtime.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const outbox = runtime.container.resolve<IComputedUpdateOutbox>(
      v2RecordRepositoryPostgresTokens.computedUpdateOutbox
    );
    try {
      const name = `fld${getRandomString(16)}`;
      const value = `fld${getRandomString(16)}`;
      const formula = `fld${getRandomString(16)}`;
      const table = (
        await bus.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create({
            baseId: runtime.baseId.toString(),
            name: 'Bounded planned recovery',
            views: [{ type: 'grid' }],
            fields: [
              { id: name, name: 'Name', type: 'singleLineText', isPrimary: true },
              { id: value, name: 'Value', type: 'number' },
              {
                id: formula,
                name: 'Computed',
                type: 'formula',
                options: { expression: `{${value}} + 1` },
              },
            ],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().table;
      const records = (
        await bus.execute<CreateRecordsCommand, CreateRecordsResult>(
          context,
          CreateRecordsCommand.create({
            tableId: table.id().toString(),
            records: Array.from({ length: 7 }, (_, i) => ({
              fields: { [name]: `Row ${i}`, [value]: i },
            })),
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap().records;
      await drainRecoveredBase(runtime);
      const dbName = table
        .dbTableName()
        .andThen((entry) => entry.value())
        ._unsafeUnwrap();
      const columns = new Map(
        table.getFields().map((field) => [
          field.id().toString(),
          field
            .dbFieldName()
            .andThen((entry) => entry.value())
            ._unsafeUnwrap(),
        ])
      );
      await sql`update ${sql.table(dbName)} set ${sql.ref(columns.get(value)!)}=${sql.ref(columns.get(value)!)}+100`.execute(
        runtime.db
      );
      const queued = (
        await outbox.enqueueOrMerge({
          baseId: runtime.baseId.toString(),
          seedTableId: table.id().toString(),
          seedRecordIds: records.map((record) => record.id().toString()),
          extraSeedRecords: [],
          beforeImageRecords: [],
          steps: [{ level: 0, tableId: table.id().toString(), fieldIds: [formula] }],
          edges: [],
          changeType: 'update',
          estimatedComplexity: 7,
          planHash: getRandomString(16),
          runId: `cur${getRandomString(16)}`,
          originRunIds: [],
          runTotalSteps: 1,
          runCompletedStepsBefore: 0,
          affectedTableIds: [table.id().toString()],
          affectedFieldIds: [formula],
          syncMaxLevel: 0,
        })
      )._unsafeUnwrap();
      const original = (
        await outbox.claimById({ taskId: queued.taskId, workerId: 'before-archive' })
      )._unsafeUnwrap();
      if (!original) throw new Error('Missing original planned task');
      (
        await outbox.markFailed(original, 'Archive complete oversized plan', undefined, {
          directDeadLetter: true,
        })
      )._unsafeUnwrap();
      const manager = new DataDbClientManager(
        {} as never,
        {} as never,
        createKnex({ client: 'pg' }),
        new DataDbRuntimeCacheService(),
        new PgPoolRegistry((config) => new Pool(config))
      );
      expect(
        await manager.recoverComputedOutboxMaintenanceAnomaly(
          {
            cacheKey: 'bounded',
            url: runtime.connectionString,
            isMetaFallback: true,
            storage: 'default',
          },
          original.id,
          'dead',
          1000
        )
      ).toMatchObject({ status: 'recovered' });
      const firstClaim = (
        await outbox.claimById({ taskId: original.id, workerId: 'bounded-rerun' })
      )._unsafeUnwrap();
      if (!firstClaim || !('steps' in firstClaim)) throw new Error('Expected planned rerun');
      const hydratedCount =
        firstClaim.seedRecordIds.length +
        firstClaim.extraSeedRecords.reduce((count, group) => count + group.recordIds.length, 0);
      expect(hydratedCount).toBeLessThanOrEqual(2);
      expect(firstClaim.ledgerScopeId).toBe(firstClaim.id);
      const retained = await sql<{
        count: number;
      }>`select count(*)::int as count from computed_update_stage_ledger where scope_id=${firstClaim.id} and kind='rerun-source'`.execute(
        runtime.db
      );
      expect(retained.rows[0].count).toBe(7);
      (
        await outbox.releaseForRetry({
          task: firstClaim,
          reason: 'Return inspected claim to worker',
          retryDelayMs: 0,
        })
      )._unsafeUnwrap();
      await drainRecoveredBase(runtime);
      const values = await sql<{
        value: number;
      }>`select ${sql.ref(columns.get(formula)!)} as value from ${sql.table(dbName)} order by ${sql.ref(columns.get(value)!)}`.execute(
        runtime.db
      );
      expect(values.rows.map((row) => row.value)).toEqual([101, 102, 103, 104, 105, 106, 107]);
      expect(
        (
          await sql<{
            count: number;
          }>`select count(*)::int as count from computed_update_stage_ledger where scope_id=${firstClaim.id}`.execute(
            runtime.db
          )
        ).rows[0].count
      ).toBe(0);
    } finally {
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1').each(['public', 'byodb'] as const)(
  'applies the actual stage-kind migration to an old constrained %s schema',
  async (storage) => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const schema =
      storage === 'public' ? 'public' : `migration_${getRandomString(12).toLowerCase()}`;
    const scopeId = `cuo${getRandomString(16)}`;
    const migration = readFileSync(
      new URL(
        '../../../../packages/db-data-prisma/prisma/migrations/20261102010000_allow_computed_rerun_ledger_kinds/migration.sql',
        import.meta.url
      ),
      'utf8'
    );
    const validationMigration = readFileSync(
      new URL(
        '../../../../packages/db-data-prisma/prisma/migrations/20261102010001_validate_computed_rerun_ledger_kinds/migration.sql',
        import.meta.url
      ),
      'utf8'
    );
    try {
      if (storage === 'byodb') {
        await sql`create schema ${sql.id(schema)}`.execute(runtime.db);
        await sql`create table ${sql.id(schema, 'computed_update_stage_ledger')} (like public.computed_update_stage_ledger including all)`.execute(
          runtime.db
        );
      }
      await runtime.db.transaction().execute(async (trx) => {
        await sql`set local search_path to ${sql.id(schema)},public`.execute(trx);
        await sql`alter table ${sql.id(schema, 'computed_update_stage_ledger')}
          drop constraint computed_update_stage_ledger_kind_check,
          add constraint computed_update_stage_ledger_kind_check check(kind in ('excluded','frontier','consumed'))`.execute(
          trx
        );
        await sql`savepoint before_new_kind`.execute(trx);
        await expect(
          sql`insert into ${sql.id(schema, 'computed_update_stage_ledger')}(scope_id,kind,table_id,record_id)
          values(${scopeId},'rerun-source','table','record')`.execute(trx)
        ).rejects.toMatchObject({ code: '23514' });
        await sql`rollback to savepoint before_new_kind`.execute(trx);
        await sql.raw(migration).execute(trx);
        await sql.raw(validationMigration).execute(trx);
        const constraint = await sql<{ convalidated: boolean }>`select convalidated
          from pg_constraint
          where conrelid=to_regclass(${`${schema}.computed_update_stage_ledger`})
            and conname='computed_update_stage_ledger_kind_check'`.execute(trx);
        expect(constraint.rows).toEqual([{ convalidated: true }]);
        for (const kind of ['excluded', 'frontier', 'consumed', 'rerun-source', 'rerun-input-v1']) {
          await sql`insert into ${sql.id(schema, 'computed_update_stage_ledger')}(scope_id,kind,table_id,record_id)
            values(${scopeId},${kind},'table','record')`.execute(trx);
        }
        const accepted = await sql<{
          kind: string;
        }>`select kind from ${sql.id(schema, 'computed_update_stage_ledger')} where scope_id=${scopeId}`.execute(
          trx
        );
        expect(new Set(accepted.rows.map((row) => row.kind))).toEqual(
          new Set(['excluded', 'frontier', 'consumed', 'rerun-source', 'rerun-input-v1'])
        );
        await sql`savepoint before_invalid_kind`.execute(trx);
        await expect(
          sql`insert into ${sql.id(schema, 'computed_update_stage_ledger')}(scope_id,kind,table_id,record_id)
          values(${scopeId},'unsupported','table','record')`.execute(trx)
        ).rejects.toMatchObject({ code: '23514' });
        await sql`rollback to savepoint before_invalid_kind`.execute(trx);
        await sql`delete from ${sql.id(schema, 'computed_update_stage_ledger')} where scope_id=${scopeId}`.execute(
          trx
        );
      });
    } finally {
      if (storage === 'byodb') await sql`drop schema ${sql.id(schema)} cascade`.execute(runtime.db);
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1').each([
  ['public', 'single'],
  ['public', 'bulk'],
  ['byodb', 'single'],
  ['byodb', 'bulk'],
] as const)(
  'rolls back a legacy %s-schema %s restore before archive seed loss',
  async (storage, mode) => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const schema = storage === 'public' ? 'public' : `guard_${getRandomString(12).toLowerCase()}`;
    const protectedTaskId = `cuo${getRandomString(16)}`;
    const legacyTaskId = `cuo${getRandomString(16)}`;
    const taskIds = mode === 'single' ? [protectedTaskId] : [protectedTaskId, legacyTaskId];
    const tableId = `tbl${getRandomString(16)}`;
    const guardMigration = readFileSync(
      new URL(
        '../../../../packages/db-data-prisma/prisma/migrations/20261103000000_guard_computed_dead_letter_seed/migration.sql',
        import.meta.url
      ),
      'utf8'
    );
    try {
      if (storage === 'byodb') {
        await sql`create schema ${sql.id(schema)}`.execute(runtime.db);
        for (const table of [
          'computed_update_outbox',
          'computed_update_outbox_seed',
          'computed_update_dead_letter',
          'computed_update_dead_letter_seed',
        ]) {
          await sql`create table ${sql.id(schema, table)} (like ${sql.id('public', table)} including all)`.execute(
            runtime.db
          );
        }
        await sql`alter table ${sql.id(schema, 'computed_update_outbox_seed')}
          add foreign key(task_id) references ${sql.id(schema, 'computed_update_outbox')}(id) on delete cascade`.execute(
          runtime.db
        );
        await sql`alter table ${sql.id(schema, 'computed_update_dead_letter_seed')}
          add foreign key(task_id) references ${sql.id(schema, 'computed_update_dead_letter')}(id) on delete cascade`.execute(
          runtime.db
        );
      }
      await runtime.db.transaction().execute(async (trx) => {
        await sql`set local search_path to ${sql.id(schema)}`.execute(trx);
        await sql.raw(guardMigration).execute(trx);
      });

      const now = new Date();
      const protectedRow: IComputedOutboxDeadLetterRow = {
        taskId: protectedTaskId,
        workerLane: 'production',
        baseId: runtime.baseId.toString(),
        seedTableId: tableId,
        seedRecordIds: null,
        changeType: 'update',
        steps: [],
        edges: [],
        maxAttempts: 8,
        estimatedComplexity: 2,
        planHash: protectedTaskId,
        dirtyStats: { rerunInputs: { version: 1, complete: true, seedCount: '2' } },
        runId: protectedTaskId,
        originRunIds: [protectedTaskId],
        runTotalSteps: 0,
        runCompletedStepsBefore: 0,
        affectedTableIds: [tableId],
        affectedFieldIds: [],
        syncMaxLevel: 0,
        sourceChangedAt: null,
        stageDepth: 0,
        predecessorTaskId: null,
        createdAt: now,
      };
      const legacyRow: IComputedOutboxDeadLetterRow = {
        ...protectedRow,
        taskId: legacyTaskId,
        seedRecordIds: ['rec-legacy'],
        estimatedComplexity: 1,
        planHash: legacyTaskId,
        dirtyStats: {},
        runId: legacyTaskId,
        originRunIds: [legacyTaskId],
        createdAt: now,
      };
      await sql`insert into ${sql.id(schema, 'computed_update_dead_letter')}
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,failed_at,created_at,updated_at)
        values(
          ${protectedTaskId},'production',${runtime.baseId.toString()},${tableId},null,'update','[]'::jsonb,'[]'::jsonb,'dead',
          1,8,${now},2,${protectedTaskId},
          ${JSON.stringify({ rerunInputs: { version: 1, complete: true, seedCount: '2' } })}::jsonb,
          ${protectedTaskId},array[${protectedTaskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now})`.execute(
        runtime.db
      );
      await sql`insert into ${sql.id(schema, 'computed_update_dead_letter_seed')}(task_id,table_id,record_id)
        values(${protectedTaskId},${tableId},'rec-a'),(${protectedTaskId},${tableId},'rec-b')`.execute(
        runtime.db
      );
      if (mode === 'bulk') {
        await sql`insert into ${sql.id(schema, 'computed_update_dead_letter')}
          (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
           attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
           origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
           affected_field_ids,stage_depth,failed_at,created_at,updated_at)
          values(${legacyTaskId},'production',${runtime.baseId.toString()},${tableId},'["rec-legacy"]'::jsonb,
          'update','[]'::jsonb,'[]'::jsonb,'dead',1,8,${now},1,${legacyTaskId},'{}'::jsonb,
          ${legacyTaskId},array[${legacyTaskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now})`.execute(
          runtime.db
        );
        await sql`insert into ${sql.id(schema, 'computed_update_outbox')}
          (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
           attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
           origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
           affected_field_ids,stage_depth,dead_letter_restore_version,created_at,updated_at)
          values(${protectedTaskId},'production',${runtime.baseId.toString()},${tableId},null,'update',
          '[]'::jsonb,'[]'::jsonb,'pending',0,8,${now},2,'old-live-plan','{}'::jsonb,
          'old-live-run',array['old-live-run'],0,0,array[${tableId}],array[]::text[],0,null,${now},${now})`.execute(
          runtime.db
        );
      }

      await expect(
        runtime.db.transaction().execute(async (trx) => {
          const existing = await sql<{ id: string }>`select id
            from ${sql.id(schema, 'computed_update_outbox')}
            where id=any(${taskIds}::text[])`.execute(trx);
          const existingIds = new Set(existing.rows.map((row) => row.id));
          const rowsToInsert = taskIds.filter((id) => !existingIds.has(id));
          if (rowsToInsert.length > 0) {
            await sql`insert into ${sql.id(schema, 'computed_update_outbox')}
            (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
             attempts,max_attempts,next_run_at,locked_at,locked_by,last_error,estimated_complexity,
             plan_hash,dirty_stats,run_id,origin_run_ids,run_total_steps,run_completed_steps_before,
             affected_table_ids,affected_field_ids,sync_max_level,source_changed_at,stage_depth,
             predecessor_task_id,created_at,updated_at)
            select id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,'pending',
             0,max_attempts,${now},null,null,null,estimated_complexity,plan_hash,dirty_stats,run_id,
             origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
             affected_field_ids,sync_max_level,source_changed_at,stage_depth,predecessor_task_id,
             created_at,${now}
            from ${sql.id(schema, 'computed_update_dead_letter')}
            where id = any(${rowsToInsert}::text[])`.execute(trx);
          }
          await sql`delete from ${sql.id(schema, 'computed_update_dead_letter')}
            where id = any(${taskIds}::text[])`.execute(trx);
        })
      ).rejects.toMatchObject({ code: '23514' });

      const state = await sql<{ archives: number; children: number; live: number }>`select
        (select count(*)::int from ${sql.id(schema, 'computed_update_dead_letter')} where id=any(${taskIds}::text[])) as archives,
        (select count(*)::int from ${sql.id(schema, 'computed_update_dead_letter_seed')} where task_id=${protectedTaskId}) as children,
        (select count(*)::int from ${sql.id(schema, 'computed_update_outbox')} where id=any(${taskIds}::text[])) as live`.execute(
        runtime.db
      );
      expect(state.rows[0]).toEqual({
        archives: taskIds.length,
        children: 2,
        live: mode === 'bulk' ? 1 : 0,
      });
      if (mode === 'bulk') {
        const oldLive = await sql<{
          runId: string;
          restoreVersion: number | null;
          seeds: number;
        }>`select run_id as "runId", dead_letter_restore_version as "restoreVersion",
          (select count(*)::int from ${sql.id(schema, 'computed_update_outbox_seed')}
           where task_id=${protectedTaskId}) as seeds
          from ${sql.id(schema, 'computed_update_outbox')} where id=${protectedTaskId}`.execute(
          runtime.db
        );
        expect(oldLive.rows).toEqual([{ runId: 'old-live-run', restoreVersion: null, seeds: 0 }]);
        const knex = createKnex({ client: 'pg', connection: runtime.connectionString });
        try {
          const current = await knex.transaction((trx) =>
            restoreComputedOutboxDeadLetterRows(
              trx,
              [protectedRow, legacyRow],
              storage === 'byodb' ? { internalSchema: schema } : {}
            )
          );
          expect(current).toMatchObject({ inserted: 1, alreadyPending: 1 });
        } finally {
          await knex.destroy();
        }
        const afterCurrent = await sql<{
          protectedArchive: number;
          protectedChildren: number;
          legacyArchive: number;
          legacySeeds: number;
          live: number;
        }>`select
          (select count(*)::int from ${sql.id(schema, 'computed_update_dead_letter')}
           where id=${protectedTaskId}) as "protectedArchive",
          (select count(*)::int from ${sql.id(schema, 'computed_update_dead_letter_seed')}
           where task_id=${protectedTaskId}) as "protectedChildren",
          (select count(*)::int from ${sql.id(schema, 'computed_update_dead_letter')}
           where id=${legacyTaskId}) as "legacyArchive",
          (select count(*)::int from ${sql.id(schema, 'computed_update_outbox_seed')}
           where task_id=${legacyTaskId}) as "legacySeeds",
          (select count(*)::int from ${sql.id(schema, 'computed_update_outbox')}
           where id=any(${taskIds}::text[])) as live`.execute(runtime.db);
        expect(afterCurrent.rows[0]).toEqual({
          protectedArchive: 1,
          protectedChildren: 2,
          legacyArchive: 0,
          legacySeeds: 1,
          live: 2,
        });
      }
    } finally {
      if (storage === 'byodb') {
        await sql`drop schema if exists ${sql.id(schema)} cascade`.execute(runtime.db);
      } else {
        await sql`delete from computed_update_outbox where id=any(${taskIds}::text[])`.execute(
          runtime.db
        );
        await runtime.db.transaction().execute(async (trx) => {
          await sql`select public.computed_outbox_authorize_discard(
            coalesce(array_agg(id), array[]::text[]))
            from computed_update_dead_letter where id=any(${taskIds}::text[])`.execute(trx);
          await sql`delete from computed_update_dead_letter where id=any(${taskIds}::text[])`.execute(
            trx
          );
        });
      }
      await runtime.dispose();
    }
  },
  120_000
);

it
  .runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')
  .each(['bootstrap', 'migration'] as const)(
  'guards direct child loss, stale authorization, fresh identity and empty membership via %s',
  async (installation) => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const now = new Date();
    const taskId = `cuo${getRandomString(16)}`;
    const emptyId = `cuo${getRandomString(16)}`;
    const legacyId = `cuo${getRandomString(16)}`;
    const emptyRunId = `cur${getRandomString(16)}`;
    const freshRunId = `cur${getRandomString(16)}`;
    const tableId = `tbl${getRandomString(16)}`;
    const insertArchive = async (
      id: string,
      dirtyStats: Record<string, unknown> | null,
      seedRecordIds: string[] | null
    ) =>
      sql`insert into computed_update_dead_letter
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,failed_at,created_at,updated_at)
        values(${id},'production',${runtime.baseId.toString()},${tableId},
          ${seedRecordIds === null ? null : JSON.stringify(seedRecordIds)}::jsonb,'update',
          '[]'::jsonb,'[]'::jsonb,'dead',1,8,${now},2,${id},
          ${dirtyStats === null ? null : JSON.stringify(dirtyStats)}::jsonb,${id},
          array[${id}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now})`.execute(
        runtime.db
      );
    try {
      if (installation === 'migration') {
        const { DataDbMigrationService } =
          await import('../features/space/data-db-migration.service');
        const migration = {
          id: '20261103000000_guard_computed_dead_letter_seed',
          sql: readFileSync(
            new URL(
              '../../../../packages/db-data-prisma/prisma/migrations/20261103000000_guard_computed_dead_letter_seed/migration.sql',
              import.meta.url
            ),
            'utf8'
          ),
        };
        // Exercise the BYODB Knex executor, not direct PG/Kysely SQL: raw question
        // mark operators can otherwise become PostgreSQL bind placeholders.
        const migrations = new DataDbMigrationService([migration], dataDbKnexClientFactory);
        await expect(migrations.migrate(runtime.connectionString, 'public')).resolves.toEqual([
          migration.id,
        ]);
        await expect(migrations.migrate(runtime.connectionString, 'public')).resolves.toEqual([]);
      }

      await insertArchive(
        taskId,
        { rerunInputs: { version: 1, complete: true, seedCount: '2' } },
        null
      );
      await sql`insert into computed_update_dead_letter_seed(task_id,table_id,record_id)
        values(${taskId},${tableId},'rec-direct-a'),(${taskId},${tableId},'rec-direct-b')`.execute(
        runtime.db
      );

      await runtime.db.transaction().execute(async (trx) => {
        await sql`savepoint before_child`.execute(trx);
        await expect(
          sql`delete from computed_update_dead_letter_seed where task_id=${taskId}`.execute(trx)
        ).rejects.toMatchObject({ code: '23514' });
        await sql`rollback to savepoint before_child`.execute(trx);
      });

      await expect(
        runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_restore(array[${taskId}]::text[])`.execute(
            trx
          );
        })
      ).rejects.toMatchObject({ code: '23514' });

      await runtime.db.transaction().execute(async (trx) => {
        await sql`select computed_outbox_authorize_discard(array[${taskId}]::text[])`.execute(trx);
      });
      await expect(
        sql`delete from computed_update_dead_letter where id=${taskId}`.execute(runtime.db)
      ).rejects.toMatchObject({ code: '23514' });

      await sql`update computed_update_dead_letter
        set dirty_stats='{"rerunInputs":{"version":2,"complete":true,"seedCount":"2"}}'::jsonb
        where id=${taskId}`.execute(runtime.db);
      await expect(
        runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_restore(array[${taskId}]::text[])`.execute(
            trx
          );
        })
      ).rejects.toMatchObject({ code: '23514' });
      await sql`update computed_update_dead_letter
        set dirty_stats='{"rerunInputs":{"version":1,"complete":true,"seedCount":"2"}}'::jsonb
        where id=${taskId}`.execute(runtime.db);
      await sql`insert into computed_update_outbox
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,dead_letter_restore_version,created_at,updated_at)
        values(${taskId},'production',${runtime.baseId.toString()},${tableId},null,'update',
          '[]'::jsonb,'[]'::jsonb,'pending',0,8,${now},2,${taskId},'{}'::jsonb,${taskId},
          array[${taskId}],0,0,array[${tableId}],array[]::text[],0,1,${now},${now})`.execute(
        runtime.db
      );
      await sql`insert into computed_update_outbox_seed(id,task_id,table_id,record_id) values
        (${`${taskId}-a`},${taskId},${tableId},'rec-direct-a'),
        (${`${taskId}-b`},${taskId},${tableId},'rec-direct-b')`.execute(runtime.db);
      await expect(
        runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_restore(array[${taskId}]::text[])`.execute(
            trx
          );
        })
      ).rejects.toMatchObject({ code: '23514' });
      await sql`update computed_update_outbox set run_id=${freshRunId} where id=${taskId}`.execute(
        runtime.db
      );
      await expect(
        runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_restore(array[${taskId}]::text[])`.execute(
            trx
          );
        })
      ).rejects.toMatchObject({ code: '23514' });
      await sql`update computed_update_outbox set origin_run_ids=array[${freshRunId}] where id=${taskId}`.execute(
        runtime.db
      );
      await expect(
        runtime.db.transaction().execute(async (trx) => {
          await sql`select computed_outbox_authorize_restore(array[${taskId}]::text[])`.execute(
            trx
          );
        })
      ).resolves.toBeUndefined();
      await sql`delete from computed_update_outbox where id=${taskId}`.execute(runtime.db);

      await insertArchive(
        emptyId,
        { rerunInputs: { version: 1, complete: true, seedCount: '0' } },
        null
      );
      await sql`insert into computed_update_outbox
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,dead_letter_restore_version,created_at,updated_at)
        values(${emptyId},'production',${runtime.baseId.toString()},${tableId},null,'update',
          '[]'::jsonb,'[]'::jsonb,'pending',0,8,${now},2,${emptyId},'{}'::jsonb,${emptyRunId},
          array[${emptyRunId}],0,0,array[${tableId}],array[]::text[],0,1,${now},${now})`.execute(
        runtime.db
      );
      await runtime.db.transaction().execute(async (trx) => {
        await sql`select computed_outbox_authorize_restore(array[${emptyId}]::text[])`.execute(trx);
        await sql`delete from computed_update_dead_letter where id=${emptyId}`.execute(trx);
      });
      await expect(
        sql`select count(*)::int as count from computed_update_dead_letter where id=${emptyId}`.execute(
          runtime.db
        )
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });

      await insertArchive(legacyId, null, ['rec-inline']);
      await sql`delete from computed_update_dead_letter where id=${legacyId}`.execute(runtime.db);
      await expect(
        sql`select count(*)::int as count from computed_update_dead_letter where id=${legacyId}`.execute(
          runtime.db
        )
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    } finally {
      await sql`delete from computed_update_outbox where id=any(${[taskId, emptyId, legacyId]}::text[])`.execute(
        runtime.db
      );
      await runtime.db.transaction().execute(async (trx) => {
        await sql`select computed_outbox_authorize_discard(
          coalesce(array_agg(id), array[]::text[]))
          from computed_update_dead_letter where id=any(${[taskId, emptyId, legacyId]}::text[])`.execute(
          trx
        );
        await sql`delete from computed_update_dead_letter where id=any(${[taskId, emptyId, legacyId]}::text[])`.execute(
          trx
        );
      });
      await runtime.dispose();
    }
  },
  120_000
);

it.runIf(process.env.TEABLE_V2_RUN_PG_INTEGRATION === '1')(
  'replays a committed archive DELETE after a lost checkpoint through the actual database guard',
  async () => {
    const runtime = await createV2NodeTestContainer({
      connectionString: process.env.TEABLE_V2_TEST_DATABASE_URL,
    });
    const taskId = `cuo${getRandomString(16)}`;
    const otherTaskId = `cuo${getRandomString(16)}`;
    const tableId = `tbl${getRandomString(16)}`;
    const now = new Date();
    const replayClient = dataDbKnexClientFactory(runtime.connectionString);
    try {
      await sql`insert into computed_update_dead_letter
        (id,worker_lane,base_id,seed_table_id,seed_record_ids,change_type,steps,edges,status,
         attempts,max_attempts,next_run_at,estimated_complexity,plan_hash,dirty_stats,run_id,
         origin_run_ids,run_total_steps,run_completed_steps_before,affected_table_ids,
         affected_field_ids,stage_depth,failed_at,created_at,updated_at)
        values
        (${taskId},'production',${runtime.baseId.toString()},${tableId},null,'update','[]'::jsonb,
         '[]'::jsonb,'dead',1,8,${now},1,${taskId},
         '{"rerunInputs":{"version":1,"complete":true,"seedCount":"1"}}'::jsonb,
         ${taskId},array[${taskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now}),
        (${otherTaskId},'production','bse-unrelated',${tableId},null,'update','[]'::jsonb,
         '[]'::jsonb,'dead',1,8,${now},1,${otherTaskId},
         '{"rerunInputs":{"version":1,"complete":true,"seedCount":"1"}}'::jsonb,
         ${otherTaskId},array[${otherTaskId}],0,0,array[${tableId}],array[]::text[],0,${now},${now},${now})`.execute(
        runtime.db
      );
      await sql`insert into computed_update_dead_letter_seed(task_id,table_id,record_id) values
        (${taskId},${tableId},'rec-delete'),(${otherTaskId},${tableId},'rec-unrelated')`.execute(
        runtime.db
      );
      // This test crosses the host module-loading boundary: a static import would
      // evaluate migration-service Prisma enums while the suite is still loading.
      const { SpaceDataDbMigrationService } =
        await import('../features/space/space-data-db-migration.service');
      const service = new SpaceDataDbMigrationService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        dataDbKnexClientFactory
      );
      const applyDelta = (
        service as unknown as {
          applyDeltaRowToTarget: (input: {
            targetClient: IDataDbPreflightClient;
            row: {
              seq: string;
              schemaName: string;
              tableName: string;
              op: string;
              oldRow: Record<string, unknown>;
              newRow: null;
            };
            sourceSchema: string;
            targetSchema: string;
          }) => Promise<boolean>;
        }
      ).applyDeltaRowToTarget.bind(service);
      const deleteRow = {
        seq: '17',
        schemaName: 'source_archive',
        tableName: 'computed_update_dead_letter',
        op: 'DELETE',
        oldRow: { id: taskId, base_id: runtime.baseId.toString() },
        newRow: null,
      } as const;
      // The first statement commits but the migration checkpoint is deliberately not
      // advanced; a restarted replay sends the identical source delta a second time.
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          applyDelta({
            targetClient: replayClient,
            row: deleteRow,
            sourceSchema: 'source_archive',
            targetSchema: 'public',
          })
        ).resolves.toBe(true);
      }
      await expect(
        sql`select computed_outbox_discard(array[${taskId}]::text[])`.execute(runtime.db)
      ).rejects.toMatchObject({ code: '23514' });
      const state = await sql<{
        removedArchives: number;
        removedChildren: number;
        otherArchives: number;
        otherChildren: number;
      }>`select
        (select count(*)::int from computed_update_dead_letter where id=${taskId}) as "removedArchives",
        (select count(*)::int from computed_update_dead_letter_seed where task_id=${taskId}) as "removedChildren",
        (select count(*)::int from computed_update_dead_letter where id=${otherTaskId}) as "otherArchives",
        (select count(*)::int from computed_update_dead_letter_seed where task_id=${otherTaskId}) as "otherChildren"`.execute(
        runtime.db
      );
      expect(state.rows[0]).toEqual({
        removedArchives: 0,
        removedChildren: 0,
        otherArchives: 1,
        otherChildren: 1,
      });
    } finally {
      await sql`select computed_outbox_discard_existing(${[taskId, otherTaskId]}::text[])`.execute(
        runtime.db
      );
      await replayClient.destroy();
      await runtime.dispose();
    }
  },
  120_000
);
