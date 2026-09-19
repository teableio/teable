import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  CreateRecordsCommand,
  UpdateRecordCommand,
  UpdateFieldCommand,
  FieldComputeMeta,
  FieldId,
  GetComputeActivityHandler,
  GetComputeActivityQuery,
  NoopLogger,
  RecordQueryPluginRunner,
  TableOperationPluginRunner,
  v2CoreTokens,
  type ICommandBus,
  type CreateTableResult,
} from '@teable/v2-core';
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
} from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { ok } from 'neverthrow';
import { afterEach, describe, expect, it } from 'vitest';

import { v2RecordRepositoryPostgresTokens } from '../../di/tokens';
import type { ComputedActivityProjector } from '../activity/ComputedActivityProjector';
import { PostgresComputedActivityReader } from '../activity/PostgresComputedActivityReader';
import type { IComputedUpdateOutbox } from './IComputedUpdateOutbox';

for (const backend of ['pglite', 'postgres'] as const) {
  describe.skipIf(backend === 'postgres' && !process.env.FORMULA_PLAN_DATABASE_URL)(
    `safety failure settlement (${backend})`,
    () => {
      let test: IV2NodeTestContainer | undefined;
      afterEach(async () => {
        await test?.dispose();
      });

      it.each([
        {
          name: 'whole batch',
          dirtyLimit: 0,
          fieldLimit: 0,
          missingActivity: false,
          seedAll: false,
          asyncProjection: false,
          terminalOnly: false,
        },
        {
          name: 'partial records',
          dirtyLimit: 1,
          fieldLimit: 0,
          missingActivity: false,
          seedAll: false,
          asyncProjection: false,
          terminalOnly: false,
        },
        {
          name: 'partial field partition',
          dirtyLimit: 1,
          fieldLimit: 1,
          missingActivity: false,
          seedAll: false,
          asyncProjection: false,
          terminalOnly: false,
        },
        {
          name: 'partial whole table',
          dirtyLimit: 1,
          fieldLimit: 0,
          missingActivity: false,
          seedAll: true,
          asyncProjection: false,
          terminalOnly: false,
        },
        {
          name: 'unregistered dependent',
          dirtyLimit: 0,
          fieldLimit: 0,
          missingActivity: true,
          seedAll: false,
          asyncProjection: false,
          terminalOnly: false,
        },
        {
          name: 'unregistered dependent async',
          dirtyLimit: 0,
          fieldLimit: 0,
          missingActivity: true,
          seedAll: false,
          asyncProjection: true,
          terminalOnly: false,
        },
        {
          name: 'terminal-only partial stage',
          dirtyLimit: 1,
          fieldLimit: 0,
          missingActivity: false,
          seedAll: false,
          asyncProjection: false,
          terminalOnly: true,
        },
      ])(
        'commits legal sibling updates and retains failures: $name',
        async ({
          dirtyLimit,
          fieldLimit,
          missingActivity,
          seedAll,
          asyncProjection,
          terminalOnly,
        }) => {
          let policy = createFormulaCompileBudgetPolicy(defaultFormulaCompileBudgetLimits);
          test = await createV2NodeTestContainer({
            connectionString:
              backend === 'pglite' ? 'memory://' : process.env.FORMULA_PLAN_DATABASE_URL,
            formulaCompileBudget: {
              policyVersion: 1,
              policy: { check: (...args) => policy.check(...args) },
            },
            computedUpdate: {
              mode: 'async',
              fieldBackfillConfig: { mode: 'async' },
              outboxConfig: { stageMaxDirtyRecords: dirtyLimit, stageMaxFields: fieldLimit },
            },
          });
          const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
          const commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
          const input = FieldId.generate()._unsafeUnwrap().toString();
          const bad = FieldId.generate()._unsafeUnwrap().toString();
          const dependent = FieldId.generate()._unsafeUnwrap().toString();
          const sibling = FieldId.generate()._unsafeUnwrap().toString();
          const { table } = (
            await commands.execute<CreateTableCommand, CreateTableResult>(
              context,
              CreateTableCommand.create({
                baseId: test.baseId.toString(),
                name: 'Worker isolation',
                fields: [
                  { id: input, type: 'number', name: 'Input', isPrimary: true },
                  {
                    id: bad,
                    type: 'formula',
                    name: 'Protected',
                    options: { expression: `{${input}} + 1` },
                  },
                  {
                    id: dependent,
                    type: 'formula',
                    name: 'Dependent',
                    options: { expression: `{${bad}} + 1` },
                  },
                  {
                    id: sibling,
                    type: 'formula',
                    name: 'Sibling',
                    options: { expression: `{${input}}` },
                  },
                ],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          (
            await commands.execute(
              context,
              CreateRecordsCommand.create({
                tableId: table.id().toString(),
                records: Array.from({ length: dirtyLimit ? 3 : 1 }, () => ({
                  fields: { [input]: 1 },
                })),
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          await test.processOutbox();
          const physical = table
            .dbTableName()
            .andThen((name) => name.value())
            ._unsafeUnwrap();
          const column = (id: string) =>
            table
              .getField((field) => field.id().toString() === id)
              .andThen((field) => field.dbFieldName())
              .andThen((name) => name.value())
              ._unsafeUnwrap();
          const rows = () =>
            sql<{ __id: string; bad: number; dependent: number; sibling: number; version: number }>`
          SELECT __id, ${sql.ref(column(bad))} AS bad, ${sql.ref(column(dependent))} AS dependent,
            ${sql.ref(column(sibling))} AS sibling, __version AS version FROM ${sql.table(physical)}`.execute(
              test!.dataDb
            );
          const beforeRows = (await rows()).rows;
          const beforeVersions = new Map(beforeRows.map((row) => [row.__id, row.version]));
          for (const row of beforeRows) {
            expect(row).toMatchObject({ bad: 2, dependent: 3, sibling: 1 });
          }
          policy = createFormulaCompileBudgetPolicy({
            ...defaultFormulaCompileBudgetLimits,
            uniqueNodes: 2,
          });
          const outbox = test.container.resolve<IComputedUpdateOutbox>(
            v2RecordRepositoryPostgresTokens.computedUpdateOutbox
          );
          const projector = test.container.resolve<ComputedActivityProjector>(
            v2RecordRepositoryPostgresTokens.computedActivityProjector
          );
          await projector.flushAllPendingActivity();
          projector.configureAsyncProjection({ enabled: asyncProjection });
          if (missingActivity) {
            await test.dataDb
              .deleteFrom('computed_field_activity')
              .where('field_id', '=', dependent)
              .execute();
          }
          const run = async (value: number, fieldIds: string[], name: string) => {
            await sql`UPDATE ${sql.table(physical)} SET ${sql.ref(column(input))} = ${value}`.execute(
              test!.dataDb
            );
            const taskId = (
              await outbox.enqueueOrMerge(
                {
                  baseId: test!.baseId.toString(),
                  seedTableId: table.id().toString(),
                  seedRecordIds: seedAll ? [] : beforeRows.map((row) => row.__id),
                  seedAllTableIds: seedAll ? [table.id().toString()] : undefined,
                  extraSeedRecords: [],
                  beforeImageRecords: [],
                  steps: [{ level: 0, tableId: table.id().toString(), fieldIds }],
                  edges: [],
                  estimatedComplexity: fieldIds.length,
                  changeType: 'update',
                  planHash: name,
                  dirtyStats: [{ tableId: table.id().toString(), recordCount: beforeRows.length }],
                  runId: name,
                  originRunIds: [name],
                  runTotalSteps: 1,
                  runCompletedStepsBefore: 0,
                  affectedTableIds: [table.id().toString()],
                  affectedFieldIds: fieldIds,
                  ledgerScopeId: name,
                  syncMaxLevel: 0,
                },
                context
              )
            )._unsafeUnwrap().taskId;
            await test!.processOutbox();
            await projector.flushAllPendingActivity();
            expect(
              await test!.dataDb
                .selectFrom('computed_update_dead_letter')
                .select('id')
                .where('base_id', '=', test!.baseId.toString())
                .execute()
            ).toEqual([]);
            expect(
              await test!.dataDb
                .selectFrom('computed_update_outbox')
                .select('id')
                .where('id', '=', taskId)
                .execute()
            ).toEqual([]);
            expect(
              await test!.dataDb
                .selectFrom('computed_task_field_ref')
                .select('task_id')
                .where('task_id', '=', taskId)
                .execute()
            ).toEqual([]);
            expect(
              await test!.dataDb
                .selectFrom('computed_update_stage_ledger')
                .select('scope_id')
                .where('scope_id', '=', name)
                .execute()
            ).toEqual([]);
          };
          await run(
            10,
            terminalOnly
              ? [bad, dependent]
              : missingActivity
                ? [bad, sibling]
                : [bad, dependent, sibling],
            'worker-isolation'
          );
          for (const row of (await rows()).rows) {
            expect(row).toMatchObject({
              bad: 2,
              dependent: 3,
              sibling: terminalOnly ? 1 : 10,
              version: beforeVersions.get(row.__id)! + (terminalOnly ? 0 : 1),
            });
          }
          await run(20, [sibling], 'worker-later-sibling');
          for (const row of (await rows()).rows) {
            expect(row).toMatchObject({
              bad: 2,
              dependent: 3,
              sibling: 20,
              version: beforeVersions.get(row.__id)! + (terminalOnly ? 1 : 2),
            });
          }
          const snapshot = (
            await new PostgresComputedActivityReader(
              test.dataDb,
              projector,
              test.metaDb
            ).getByTableId(context, table.id().toString(), test.baseId.toString(), {
              readableFieldIds: [bad, dependent, sibling],
              heal: false,
            })
          )._unsafeUnwrap();
          for (const fieldId of [bad, dependent]) {
            expect(snapshot.fields.find((field) => field.fieldId === fieldId)).toMatchObject({
              status: 'failed',
              activeTaskCount: 0,
              processingTaskCount: 0,
            });
          }
          expect(snapshot.fields.find((field) => field.fieldId === bad)?.lastError?.code).toBe(
            'validation.limit.formula_compile_nodes_max'
          );
          expect(snapshot.fields.find((field) => field.fieldId === sibling)).toMatchObject({
            status: 'idle',
            activeTaskCount: 0,
          });
        }
      );

      it.each(['record update', 'field backfill'] as const)(
        'settles a real PostgreSQL program-limit error during %s on the first attempt without replacing stored cells',
        async (operation) => {
          test = await createV2NodeTestContainer({
            connectionString:
              backend === 'pglite' ? 'memory://' : process.env.FORMULA_PLAN_DATABASE_URL,
            computedUpdate: { mode: 'async', fieldBackfillConfig: { mode: 'async' } },
          });
          const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
          const commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
          const input = FieldId.generate()._unsafeUnwrap().toString();
          const limited = FieldId.generate()._unsafeUnwrap().toString();
          const dependent = FieldId.generate()._unsafeUnwrap().toString();
          const { table } = (
            await commands.execute<CreateTableCommand, CreateTableResult>(
              context,
              CreateTableCommand.create({
                baseId: test.baseId.toString(),
                name: 'Program limit',
                fields: [
                  { id: input, type: 'number', name: 'Input', isPrimary: true },
                  {
                    id: limited,
                    type: 'formula',
                    name: 'Limited',
                    options: { expression: `REPT("xx", {${input}})` },
                  },
                  {
                    id: dependent,
                    type: 'formula',
                    name: 'Dependent',
                    options: { expression: `{${limited}} & "!"` },
                  },
                ],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          (
            await commands.execute(
              context,
              CreateRecordsCommand.create({
                tableId: table.id().toString(),
                records: [{ fields: { [input]: 1 } }],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          await test.processOutbox();
          const physical = table
            .dbTableName()
            .andThen((name) => name.value())
            ._unsafeUnwrap();
          const column = (id: string) =>
            table
              .getField((field) => field.id().toString() === id)
              .andThen((field) => field.dbFieldName())
              .andThen((name) => name.value())
              ._unsafeUnwrap();
          const rows = async () =>
            (
              await sql<{ __id: string; limited: string; dependent: string }>`
          SELECT __id, ${sql.ref(column(limited))} AS limited, ${sql.ref(column(dependent))} AS dependent
          FROM ${sql.table(physical)}`.execute(test!.dataDb)
            ).rows;
          const before = await rows();
          expect(before[0]).toMatchObject({ limited: 'xx', dependent: 'xx!' });
          const projector = test.container.resolve<ComputedActivityProjector>(
            v2RecordRepositoryPostgresTokens.computedActivityProjector
          );
          projector.configureAsyncProjection({ enabled: false });
          // PostgreSQL rejects 2 * INT_MAX before allocating the repeated value.
          if (operation === 'record update') {
            (
              await commands.execute(
                context,
                UpdateRecordCommand.create({
                  tableId: table.id().toString(),
                  recordId: before[0].__id,
                  fields: { [input]: 2147483647 },
                })._unsafeUnwrap()
              )
            )._unsafeUnwrap();
          } else {
            (
              await commands.execute(
                context,
                UpdateFieldCommand.create({
                  tableId: table.id().toString(),
                  fieldId: limited,
                  field: { options: { expression: 'REPT("xx", 2147483647)' } },
                })._unsafeUnwrap()
              )
            )._unsafeUnwrap();
          }
          await test.processOutbox();
          expect(
            await test.dataDb.selectFrom('computed_update_outbox').select('id').execute()
          ).toEqual([]);
          const dead = await test.dataDb
            .selectFrom('computed_update_dead_letter')
            .select('attempts')
            .execute();
          expect(new Set(dead.map((task) => task.attempts))).toEqual(new Set([1]));
          expect(await rows()).toEqual(before);
          const snapshot = (
            await new PostgresComputedActivityReader(
              test.dataDb,
              projector,
              test.metaDb
            ).getByTableId(context, table.id().toString(), test.baseId.toString(), {
              readableFieldIds: [limited, dependent],
              heal: false,
            })
          )._unsafeUnwrap();
          for (const fieldId of [limited, dependent]) {
            const field = snapshot.fields.find((field) => field.fieldId === fieldId);
            expect(field).toMatchObject({
              status: 'failed',
              activeTaskCount: 0,
              processingTaskCount: 0,
            });
            expect(FieldComputeMeta.fromDto(field!)._unsafeUnwrap().toPublicDto()).toMatchObject({
              lastError: { code: 'computed.resource_limit' },
            });
          }
          expect(
            JSON.stringify(
              snapshot.fields.map((field) =>
                FieldComputeMeta.fromDto(field)._unsafeUnwrap().toPublicDto()
              )
            )
          ).not.toContain('REPEAT');
        }
      );

      it.each([true, false])(
        'settles real depth-50 work with remaining dependency: %s',
        async (remaining) => {
          test = await createV2NodeTestContainer({
            connectionString:
              backend === 'pglite' ? 'memory://' : process.env.FORMULA_PLAN_DATABASE_URL,
            computedUpdate: { mode: 'async', fieldBackfillConfig: { mode: 'async' } },
          });
          const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
          const commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
          const input = FieldId.generate()._unsafeUnwrap().toString();
          const first = FieldId.generate()._unsafeUnwrap().toString();
          const next = FieldId.generate()._unsafeUnwrap().toString();
          const { table } = (
            await commands.execute<CreateTableCommand, CreateTableResult>(
              context,
              CreateTableCommand.create({
                baseId: test.baseId.toString(),
                name: 'Stage boundary',
                fields: [
                  { id: input, type: 'number', name: 'Input', isPrimary: true },
                  {
                    id: first,
                    type: 'formula',
                    name: 'First',
                    options: { expression: `{${input}} + 1` },
                  },
                  {
                    id: next,
                    type: 'formula',
                    name: 'Next',
                    options: { expression: remaining ? `{${first}} + 1` : '3' },
                  },
                ],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          (
            await commands.execute(
              context,
              CreateRecordsCommand.create({
                tableId: table.id().toString(),
                records: [{ fields: { [input]: 1 } }],
              })._unsafeUnwrap()
            )
          )._unsafeUnwrap();
          await test.processOutbox();
          const physical = table
            .dbTableName()
            .andThen((name) => name.value())
            ._unsafeUnwrap();
          const column = (id: string) =>
            table
              .getField((field) => field.id().toString() === id)
              .andThen((field) => field.dbFieldName())
              .andThen((name) => name.value())
              ._unsafeUnwrap();
          const rows = () =>
            sql<{ __id: string; first: number; next: number; version: number }>`
          SELECT __id, ${sql.ref(column(first))} AS first, ${sql.ref(column(next))} AS next,
            __version AS version FROM ${sql.table(physical)}`.execute(test!.dataDb);
          const before = (await rows()).rows[0];
          expect(before).toMatchObject({ first: 2, next: 3 });
          await sql`UPDATE ${sql.table(physical)} SET ${sql.ref(column(input))} = 10`.execute(
            test.dataDb
          );
          const outbox = test.container.resolve<IComputedUpdateOutbox>(
            v2RecordRepositoryPostgresTokens.computedUpdateOutbox
          );
          const projector = test.container.resolve<ComputedActivityProjector>(
            v2RecordRepositoryPostgresTokens.computedActivityProjector
          );
          projector.configureAsyncProjection({ enabled: false });
          const taskId = (
            await outbox.enqueueOrMerge(
              {
                baseId: test.baseId.toString(),
                seedTableId: table.id().toString(),
                seedRecordIds: [before.__id],
                extraSeedRecords: [],
                beforeImageRecords: [],
                steps: [{ level: 0, tableId: table.id().toString(), fieldIds: [first] }],
                edges: [],
                estimatedComplexity: 1,
                changeType: 'update',
                planHash: 'real-depth-boundary',
                dirtyStats: [{ tableId: table.id().toString(), recordCount: 1 }],
                runId: 'real-depth-boundary',
                originRunIds: ['real-depth-boundary'],
                runTotalSteps: remaining ? 2 : 1,
                runCompletedStepsBefore: 0,
                stageDepth: 50,
                affectedTableIds: [table.id().toString()],
                affectedFieldIds: remaining ? [first, next] : [first],
                ledgerScopeId: 'real-depth-boundary',
                syncMaxLevel: 0,
              },
              context
            )
          )._unsafeUnwrap().taskId;
          await test.processOutbox();
          expect(
            await test.dataDb
              .selectFrom('computed_update_outbox')
              .select('id')
              .where('id', '=', taskId)
              .execute()
          ).toEqual([]);
          const dead = await test.dataDb
            .selectFrom('computed_update_dead_letter')
            .selectAll()
            .where('id', '=', taskId)
            .execute();
          if (remaining) {
            expect(dead).toHaveLength(1);
            expect(dead[0].attempts).toBe(1);
            expect(JSON.stringify(dead[0])).toContain('computed.stage_depth_exhausted');
            expect((await rows()).rows).toEqual([before]);
            const snapshot = (
              await new PostgresComputedActivityReader(
                test.dataDb,
                projector,
                test.metaDb
              ).getByTableId(context, table.id().toString(), test.baseId.toString(), {
                readableFieldIds: [first, next],
                heal: false,
              })
            )._unsafeUnwrap();
            expect(snapshot.fields.find((field) => field.fieldId === next)).toMatchObject({
              status: 'failed',
              activeTaskCount: 0,
              processingTaskCount: 0,
            });
            expect(
              snapshot.table?.recentCompletions.filter((completion) => completion.taskId === taskId)
            ).toEqual([]);
          } else {
            expect(dead).toEqual([]);
            expect((await rows()).rows[0]).toMatchObject({
              first: 11,
              next: 3,
              version: before.version + 1,
            });
          }
          expect(
            await test.dataDb
              .selectFrom('computed_update_stage_ledger')
              .select('scope_id')
              .where('scope_id', '=', 'real-depth-boundary')
              .execute()
          ).toEqual([]);
          expect(
            await test.dataDb
              .selectFrom('computed_task_field_ref')
              .select('task_id')
              .where('task_id', '=', taskId)
              .execute()
          ).toEqual([]);
        }
      );

      it('preserves the terminal safety cause across sibling completion and releases the owned ledger and lease', async () => {
        test = await createV2NodeTestContainer({
          connectionString:
            backend === 'pglite' ? 'memory://' : process.env.FORMULA_PLAN_DATABASE_URL,
        });
        const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
        const commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
        const fieldId = FieldId.generate()._unsafeUnwrap().toString();
        const hiddenId = FieldId.generate()._unsafeUnwrap().toString();
        const created = (
          await commands.execute<CreateTableCommand, CreateTableResult>(
            context,
            CreateTableCommand.create({
              baseId: test.baseId.toString(),
              name: 'Safety settlement',
              fields: [
                { type: 'singleLineText', name: 'Name', isPrimary: true },
                { id: fieldId, type: 'formula', name: 'Protected', options: { expression: '1' } },
                { id: hiddenId, type: 'formula', name: 'Unrelated', options: { expression: '2' } },
              ],
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
        await test.processOutbox();
        const tableId = created.table.id().toString();
        const baseId = test.baseId.toString();
        const outbox = test.container.resolve<IComputedUpdateOutbox>(
          v2RecordRepositoryPostgresTokens.computedUpdateOutbox
        );
        const projector = test.container.resolve<ComputedActivityProjector>(
          v2RecordRepositoryPostgresTokens.computedActivityProjector
        );
        projector.configureAsyncProjection({ enabled: false });
        const enqueue = async (name: string) =>
          (
            await outbox.enqueueOrMerge(
              {
                baseId,
                seedTableId: tableId,
                seedRecordIds: ['rec0000000000000001'],
                extraSeedRecords: [],
                beforeImageRecords: [],
                steps: [{ level: 0, tableId, fieldIds: [fieldId] }],
                edges: [],
                estimatedComplexity: 1,
                changeType: 'update',
                planHash: name,
                dirtyStats: [{ tableId, recordCount: 1 }],
                runId: name,
                originRunIds: [name],
                runTotalSteps: 1,
                runCompletedStepsBefore: 0,
                affectedTableIds: [tableId],
                affectedFieldIds: [fieldId],
                syncMaxLevel: 0,
                ledgerScopeId: name,
              },
              context
            )
          )._unsafeUnwrap().taskId;
        const firstId = await enqueue('safety-terminal');
        const first = (
          await outbox.claimById({ taskId: firstId, workerId: 'safety-worker' }, context)
        )._unsafeUnwrap();
        if (!first) throw new Error('First task was not claimable');
        const secondId = await enqueue('safety-sibling');
        await test.db
          .insertInto('computed_update_stage_ledger')
          .values([
            {
              scope_id: 'safety-terminal',
              kind: 'frontier',
              table_id: tableId,
              record_id: 'rec0000000000000001',
              seq: 1,
            },
            {
              scope_id: 'safety-sibling',
              kind: 'frontier',
              table_id: tableId,
              record_id: 'rec0000000000000001',
              seq: 1,
            },
          ])
          .execute();
        expect(
          (
            await outbox.markFailed(first, 'SELECT private_formula', context, {
              failureKind: 'data_safety_limit',
              failureReason: 'stage_depth_exhausted',
              retryable: false,
              directDeadLetter: true,
              diagnostics: {
                version: 1,
                failure: {
                  code: 'computed.stage_depth_exhausted',
                  kind: 'data_safety_limit',
                  reason: 'stage_depth_exhausted',
                  retryable: false,
                  directDeadLetter: true,
                  details: { stageDepth: 50, sql: 'private_formula' },
                },
              },
            })
          )._unsafeUnwrap()
        ).toBe(true);
        expect(
          await test.db
            .selectFrom('computed_update_outbox')
            .select('id')
            .where('id', '=', firstId)
            .execute()
        ).toEqual([]);
        const dead = await test.db
          .selectFrom('computed_update_dead_letter')
          .select(['id', 'attempts'])
          .where('id', '=', firstId)
          .executeTakeFirstOrThrow();
        expect(dead.attempts).toBe(1);
        expect(
          await test.db
            .selectFrom('computed_update_stage_ledger')
            .select('scope_id')
            .where('table_id', '=', tableId)
            .orderBy('scope_id')
            .execute()
        ).toEqual([{ scope_id: 'safety-sibling' }]);
        const second = (
          await outbox.claimById({ taskId: secondId, workerId: 'safety-worker' }, context)
        )._unsafeUnwrap();
        if (!second) throw new Error('Sibling task was not claimable after terminal failure');
        expect((await outbox.markDone(second, context))._unsafeUnwrap()).toBe(true);
        expect(
          await test.db
            .selectFrom('computed_task_field_ref')
            .select('task_id')
            .where('field_id', '=', fieldId)
            .execute()
        ).toEqual([]);
        const reader = new PostgresComputedActivityReader(test.db, projector, test.metaDb);
        const snapshot = (
          await reader.getByTableId(context, tableId, baseId, {
            readableFieldIds: [fieldId],
            heal: false,
          })
        )._unsafeUnwrap();
        expect(snapshot.fields.map((field) => field.fieldId)).toEqual([fieldId]);
        const publicField = FieldComputeMeta.fromDto(snapshot.fields[0])
          ._unsafeUnwrap()
          .toPublicDto();
        expect(publicField).toMatchObject({
          status: 'failed',
          lastError: { code: 'computed.stage_depth_exhausted' },
        });
        expect(JSON.stringify(publicField)).not.toContain('private_formula');
        expect(snapshot.fields[0]).toMatchObject({ activeTaskCount: 0, processingTaskCount: 0 });
        const logger = new NoopLogger();
        const handler = new GetComputeActivityHandler(
          test.tableRepository,
          reader,
          logger,
          new TableOperationPluginRunner([], logger),
          new RecordQueryPluginRunner(
            [
              {
                name: 'readable-field-scope',
                supports: () => true,
                scope: () => ok({ readableFieldIds: new Set([hiddenId]) }),
              },
            ],
            logger
          )
        );
        const restricted = (
          await handler.handle(
            context,
            GetComputeActivityQuery.create({ baseId, tableId })._unsafeUnwrap()
          )
        )._unsafeUnwrap().snapshot;
        expect(restricted.diagnostics.failedFieldCount).toBe(0);
        expect(JSON.stringify(restricted)).not.toContain(fieldId);
      });
    }
  );
}
