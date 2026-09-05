import {
  CellValueMultiplicity,
  CellValueType,
  FormulaField,
  FormulaMeta,
  RecordId,
} from '@teable/v2-core';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import {
  CHANGE_FRONTIER_TABLE,
  cleanupChangeFrontierOrphans,
  clearChangeFrontier,
  recordStageValueChanges,
  supportsValueFrontier,
} from '../ComputedChangeFrontier';
import type { StepChangeData } from '../ComputedFieldUpdater';
import {
  collectStageOutputSeedGroups,
  clearStageLedger,
  retireStageLedgerFrontierHead,
} from '../ComputedStageLedger';
import type { ComputedUpdatePlan } from '../ComputedUpdatePlanner';
import { makeBackfillFusionTable } from './backfillFusionFixture';

const table = makeBackfillFusionTable(['ROUND({fldaaaaaaaaaaaaaaaa}, 0)', 'NOW()', '1 + 1']);
const formula = table.getFields()[1];
if (!(formula instanceof FormulaField)) throw new Error('Expected formula');
formula.setResultType(CellValueType.number(), CellValueMultiplicity.single())._unsafeUnwrap();
const sibling = table.getFields()[3];
if (!(sibling instanceof FormulaField)) throw new Error('Expected sibling formula');
sibling.setResultType(CellValueType.number(), CellValueMultiplicity.single())._unsafeUnwrap();
const tableId = table.id().toString();
const fieldId = formula.id().toString();
const scopeId = 'scope';
const plan: ComputedUpdatePlan = {
  baseId: table.baseId(),
  seedTableId: table.id(),
  seedRecordIds: [RecordId.create(`rec${'a'.repeat(16)}`)._unsafeUnwrap()],
  extraSeedRecords: [],
  changedFieldIds: [table.getFields()[0].id()],
  changeType: 'update',
  steps: [{ tableId: table.id(), fieldIds: [formula.id()], level: 0 }],
  edges: [],
  estimatedComplexity: 1,
  sameTableBatches: [],
};

describe('durable actual-value frontier', () => {
  let created: Awaited<ReturnType<typeof createPGliteDb>>;
  beforeAll(async () => {
    created = await createPGliteDb();
    await created.pglite.exec(`
      CREATE TABLE computed_update_outbox (id text PRIMARY KEY, dirty_stats jsonb);
      CREATE TEMPORARY TABLE tmp_computed_dirty (table_id text, record_id text, generation integer DEFAULT 0, PRIMARY KEY(table_id, record_id));
      CREATE TABLE computed_update_stage_ledger (scope_id text, kind text, table_id text, record_id text, seq bigint DEFAULT 0, PRIMARY KEY(scope_id,kind,table_id,record_id));
      CREATE TABLE ${CHANGE_FRONTIER_TABLE} (scope_id text, kind text, table_id text, record_id text, field_id text, PRIMARY KEY(scope_id,kind,table_id,record_id,field_id));
    `);
  });
  afterAll(async () => created.db.destroy());
  beforeEach(async () => {
    await created.pglite.exec(
      `TRUNCATE computed_update_outbox, tmp_computed_dirty, computed_update_stage_ledger, ${CHANGE_FRONTIER_TABLE}`
    );
  });
  const dirty = async (...ids: string[]) => {
    for (const id of ids)
      await sql`INSERT INTO tmp_computed_dirty(table_id,record_id) VALUES (${tableId},${id}) ON CONFLICT DO NOTHING`.execute(
        created.db
      );
  };
  const changes = (recordId: string, oldValue: unknown, newValue: unknown): StepChangeData[] => [
    {
      tableId,
      recordChanges: [{ recordId, oldVersion: 1, changes: [{ fieldId, oldValue, newValue }] }],
    },
  ];
  const record = async (data: StepChangeData[], input = plan) =>
    recordStageValueChanges(created.db, scopeId, input, new Map([[tableId, table]]), data);
  const collect = async (includeConsumedSources = false, fieldIds = [fieldId]) =>
    (
      await collectStageOutputSeedGroups(created.db, scopeId, [tableId], {
        seedAllThreshold: 100,
        exactIdsTotalCap: 100,
        includeConsumedSources,
        valueFrontierFields: [{ tableId, fieldIds }],
      })
    )._unsafeUnwrap();
  const collectedIds = async () =>
    (await collect()).groups.flatMap((group) => group.recordIds).sort();

  it('issues no evidence SQL for an empty tracking selection', async () => {
    const execute = vi.spyOn(created.db, 'executeQuery');
    await recordStageValueChanges(
      created.db,
      scopeId,
      plan,
      new Map([[tableId, table]]),
      changes('ignored', 1, 2),
      [],
      []
    );
    expect(execute).not.toHaveBeenCalled();
    execute.mockRestore();
  });

  it('creates no evidence for unsupported candidate tables', async () => {
    await dirty('unsupported');
    await record([], {
      ...plan,
      steps: [{ ...plan.steps[0], fieldIds: [table.getFields()[2].id()] }],
    });
    expect((await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE}`)).rows).toEqual([]);
  });

  it('invalidates overlapping rows when a partial table loses tracking eligibility', async () => {
    await dirty('replayed');
    await record(changes('replayed', 1, 1));
    // Another source table remains tracked; this one disappeared from policy.
    await clearChangeFrontier(created.db, scopeId, ['other-table']);
    await sql`INSERT INTO computed_update_stage_ledger(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'replayed')`.execute(
      created.db
    );
    await record(changes('replayed', 2, 2));
    expect(await collectedIds()).toEqual(['replayed']);
  });

  it('tracks same, null and changed cells without widening dirty/progress state', async () => {
    await dirty('same', 'null', 'changed');
    await record([
      ...changes('same', 1, 1),
      ...changes('null', null, null),
      ...changes('changed', null, 2),
    ]);
    expect(await collectedIds()).toEqual(['changed']);
    expect((await created.pglite.query('SELECT * FROM tmp_computed_dirty')).rows).toHaveLength(3);
    expect(
      (await created.pglite.query('SELECT * FROM computed_update_stage_ledger')).rows
    ).toHaveLength(0);
  });

  it('accumulates across partial replay and clears all evidence on stage completion', async () => {
    await dirty('first');
    await record(changes('first', 1, 2));
    await sql`INSERT INTO computed_update_stage_ledger(scope_id,kind,table_id,record_id,seq) VALUES (${scopeId},'frontier',${tableId},'first',1)`.execute(
      created.db
    );
    (
      await retireStageLedgerFrontierHead(created.db, scopeId, '1', { preserveAsConsumed: true })
    )._unsafeUnwrap();
    expect(
      (await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE} WHERE kind = 'changed'`))
        .rows
    ).toHaveLength(1);
    await sql`INSERT INTO computed_update_stage_ledger(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'first')`.execute(
      created.db
    );
    await created.pglite.exec('TRUNCATE tmp_computed_dirty');
    await dirty('second');
    await record(changes('second', 1, 1));
    await record(changes('second', 1, 1));
    expect(await collectedIds()).toEqual(['first']);
    (await clearStageLedger(created.db, scopeId))._unsafeUnwrap();
    expect((await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE}`)).rows).toEqual([]);
  });

  it('falls back for a legacy partial batch before or after new-worker coverage', async () => {
    await dirty('new');
    await record(changes('new', 1, 1));
    await sql`INSERT INTO computed_update_stage_ledger(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'legacy')`.execute(
      created.db
    );
    expect(await collectedIds()).toEqual(['legacy', 'new']);
  });

  it.each(['shrink', 'expand'] as const)(
    'keeps fallback sticky when partial field sets %s',
    async (direction) => {
      const both = {
        ...plan,
        steps: [{ ...plan.steps[0], fieldIds: [formula.id(), sibling.id()] }],
      };
      await dirty('first');
      await record([], direction === 'shrink' ? both : plan);
      await dirty('second');
      await record([], direction === 'shrink' ? plan : both);
      // Returning to the original field set cannot certify the intervening batch.
      await record([], direction === 'shrink' ? both : plan);
      expect(await collectedIds()).toEqual(['first', 'second']);
      expect(
        (
          await created.pglite.query(
            `SELECT * FROM ${CHANGE_FRONTIER_TABLE} WHERE kind = 'fallback'`
          )
        ).rows
      ).toHaveLength(1);
    }
  );

  it('keeps original consumed sources and deferred candidate rows', async () => {
    await dirty('same');
    await record(changes('same', 1, 1));
    await sql`INSERT INTO computed_update_stage_ledger(scope_id,kind,table_id,record_id) VALUES (${scopeId},'consumed',${tableId},'direct-source')`.execute(
      created.db
    );
    expect((await collect(true)).groups[0].recordIds.sort()).toEqual(['direct-source', 'same']);
  });

  it('falls back for implicit schema initialization, unknown fields and volatile formulas', async () => {
    await dirty('schema');
    await record([], { ...plan, seedRecordIds: [] });
    expect(await collectedIds()).toEqual(['schema']);
    expect(supportsValueFrontier(table.getFields()[2], table)).toBe(false);
    expect((await collect(false, [fieldId, 'untracked'])).groups[0].recordIds).toEqual(['schema']);
  });

  it('cleans orphan scopes in bounded batches while retaining active continuation evidence', async () => {
    await sql`INSERT INTO computed_update_outbox(id,dirty_stats) VALUES ('child', ${JSON.stringify({ ledgerScopeId: 'active' })}::jsonb)`.execute(
      created.db
    );
    await created.pglite
      .exec(`INSERT INTO ${CHANGE_FRONTIER_TABLE}(scope_id,kind,table_id,record_id,field_id)
      SELECT 'orphan','changed','t', n::text,'f' FROM generate_series(1,1500) n;
      INSERT INTO ${CHANGE_FRONTIER_TABLE} VALUES ('active','changed','t','r','f')`);
    const first = await cleanupChangeFrontierOrphans(created.db);
    expect(first.deleted).toBe(1000);
    expect(
      (await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE} WHERE scope_id='active'`))
        .rows
    ).toHaveLength(1);
    await cleanupChangeFrontierOrphans(created.db, first.afterScope);
    const second = await cleanupChangeFrontierOrphans(created.db);
    expect(second.deleted).toBe(500);
    expect(
      (await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE}`)).rows
    ).toHaveLength(1);
  });

  it('forces rejected cells into the frontier for downstream correction', async () => {
    await dirty('rejected');
    await recordStageValueChanges(
      created.db,
      scopeId,
      plan,
      new Map([[tableId, table]]),
      [],
      [
        {
          tableId,
          recordId: 'rejected',
          fieldId,
          column: 'col_1',
          columnType: 'double precision',
          oldValue: null,
          attempted: 200,
          max: 100,
        },
      ]
    );
    expect(await collectedIds()).toEqual(['rejected']);
  });

  it('requires coverage for direct fields even when a sibling formula is covered', async () => {
    await dirty('diamond');
    await record(changes('diamond', 1, 1));
    const result = await collect(false, [fieldId, table.getFields()[0].id().toString()]);
    expect(result.groups[0].recordIds).toEqual(['diamond']);
    expect(result.valuePrunedTableIds).toBeUndefined();
  });

  it('preserves already-computed sync-prefix outputs absent from async steps', async () => {
    await dirty('sync-prefix-changed');
    // The synchronous prefix already assigned A. Reusing A in a later CTE
    // does not assign it again or establish old/new evidence for this scope.
    await record([], { ...plan, steps: [], changedFieldIds: [formula.id()] });
    const result = await collectStageOutputSeedGroups(created.db, scopeId, [tableId], {
      seedAllThreshold: 100,
      exactIdsTotalCap: 100,
      includeConsumedSources: true,
      allowConsumedPruning: true,
      valueFrontierFields: [{ tableId, fieldIds: [fieldId] }],
    });
    expect(result._unsafeUnwrap().groups[0].recordIds).toEqual(['sync-prefix-changed']);
    expect(result._unsafeUnwrap().valuePrunedTableIds ?? []).toEqual([]);
  });

  it('does not claim coverage for generated columns skipped by the updater', () => {
    const generated = FormulaField.create({
      id: formula.id(),
      name: formula.name(),
      expression: formula.expression(),
      meta: FormulaMeta.rehydrate({ persistedAsGeneratedColumn: true })._unsafeUnwrap(),
      resultType: {
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      },
    })._unsafeUnwrap();
    expect(supportsValueFrontier(generated, table)).toBe(false);
  });

  it('rolls back evidence with failed transactions', async () => {
    await dirty('rollback');
    await expect(
      created.db.transaction().execute(async (trx) => {
        await recordStageValueChanges(
          trx,
          scopeId,
          plan,
          new Map([[tableId, table]]),
          changes('rollback', 1, 2)
        );
        throw new Error('retry');
      })
    ).rejects.toThrow('retry');
    expect((await created.pglite.query(`SELECT * FROM ${CHANGE_FRONTIER_TABLE}`)).rows).toEqual([]);
    expect(await collectedIds()).toEqual(['rollback']);
  });
});
