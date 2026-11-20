import {
  ActorId,
  BaseId,
  CellValueMultiplicity,
  CellValueType,
  DbFieldName,
  DbTableName,
  FieldId,
  FieldName,
  FormulaExpression,
  FormulaField,
  FormulaMeta,
  LinkFieldConfig,
  LookupOptions,
  RecordId,
  Table,
  TableId,
  TableName,
  domainError,
  ok,
  type ILogger,
  type ITableRepository,
} from '@teable/v2-core';
import { Pg16TypeValidationStrategy } from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { err } from 'neverthrow';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPGliteDb } from '../../../schema/visitors/__tests__/helpers/createPGliteDb';
import {
  CHANGE_FRONTIER_TABLE,
  cleanupChangeFrontierOrphans,
  clearChangeFrontier,
  recordStageValueChanges,
  supportsValueFrontier,
} from '../ComputedChangeFrontier';
import { ComputedFieldUpdater, type StepChangeData } from '../ComputedFieldUpdater';
import {
  appendStageLedgerPartialBatch,
  collectStageOutputSeedGroups,
  clearStageLedger,
  retireIrrelevantStageLedgerFrontier,
  retireStageLedgerFrontierHead,
  pushStageLedgerFrontierHead,
  seedStageLedgerFrontierHead,
  stageLedgerHasFrontier,
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

describe.each(['public', 'frontier_internal'])('durable actual-value frontier in %s', (schema) => {
  let created: Awaited<ReturnType<typeof createPGliteDb>>;
  const frontierTable = `${schema}.${CHANGE_FRONTIER_TABLE}`;
  const ledgerTable = `${schema}.computed_update_stage_ledger`;
  const outboxTable = `${schema}.computed_update_outbox`;
  beforeAll(async () => {
    created = await createPGliteDb();
    if (schema !== 'public') {
      await created.db.schema.createSchema(schema).execute();
      created.db = created.db.withSchema(schema);
    }
    await created.pglite.exec(`
      CREATE TABLE ${outboxTable} (id text PRIMARY KEY, dirty_stats jsonb);
      CREATE TEMPORARY TABLE tmp_computed_dirty (table_id text, record_id text, generation integer DEFAULT 0, PRIMARY KEY(table_id, record_id));
      CREATE TABLE ${ledgerTable} (scope_id text, kind text, table_id text, record_id text, seq bigint DEFAULT 0, PRIMARY KEY(scope_id,kind,table_id,record_id));
      CREATE TABLE ${frontierTable} (scope_id text, kind text, table_id text, record_id text, field_id text, PRIMARY KEY(scope_id,kind,table_id,record_id,field_id));
    `);
  });
  afterAll(async () => created.db.destroy());
  beforeEach(async () => {
    await created.pglite.exec(
      `TRUNCATE ${outboxTable}, tmp_computed_dirty, ${ledgerTable}, ${frontierTable}`
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

  it('keeps dirty candidates when tracking selection is empty', async () => {
    await dirty('ignored');
    await recordStageValueChanges(
      created.db,
      scopeId,
      plan,
      new Map([[tableId, table]]),
      changes('ignored', 1, 1),
      [],
      []
    );
    expect(await collectedIds()).toEqual(['ignored']);
  });

  it('creates no evidence for unsupported candidate tables', async () => {
    await dirty('unsupported');
    await record([], {
      ...plan,
      steps: [{ ...plan.steps[0], fieldIds: [table.getFields()[2].id()] }],
    });
    expect((await created.pglite.query(`SELECT * FROM ${frontierTable}`)).rows).toEqual([]);
  });

  it('invalidates overlapping rows when a partial table loses tracking eligibility', async () => {
    await dirty('replayed');
    await record(changes('replayed', 1, 1));
    // Another source table remains tracked; this one disappeared from policy.
    await clearChangeFrontier(created.db, scopeId, ['other-table']);
    await sql`INSERT INTO ${sql.table(ledgerTable)}(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'replayed')`.execute(
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
    expect((await created.pglite.query(`SELECT * FROM ${ledgerTable}`)).rows).toHaveLength(0);
  });

  it('accumulates across partial replay and clears all evidence on stage completion', async () => {
    await dirty('first');
    await record(changes('first', 1, 2));
    await sql`INSERT INTO ${sql.table(ledgerTable)}(scope_id,kind,table_id,record_id,seq) VALUES (${scopeId},'frontier',${tableId},'first',1)`.execute(
      created.db
    );
    (
      await retireStageLedgerFrontierHead(created.db, scopeId, '1', { preserveAsConsumed: true })
    )._unsafeUnwrap();
    expect(
      (await created.pglite.query(`SELECT * FROM ${frontierTable} WHERE kind = 'changed'`)).rows
    ).toHaveLength(1);
    await sql`INSERT INTO ${sql.table(ledgerTable)}(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'first')`.execute(
      created.db
    );
    await created.pglite.exec('TRUNCATE tmp_computed_dirty');
    await dirty('second');
    await record(changes('second', 1, 1));
    await record(changes('second', 1, 1));
    expect(await collectedIds()).toEqual(['first']);
    (await clearStageLedger(created.db, scopeId))._unsafeUnwrap();
    expect((await created.pglite.query(`SELECT * FROM ${frontierTable}`)).rows).toEqual([]);
  });

  it('falls back for a legacy partial batch before or after new-worker coverage', async () => {
    await dirty('new');
    await record(changes('new', 1, 1));
    await sql`INSERT INTO ${sql.table(ledgerTable)}(scope_id,kind,table_id,record_id) VALUES (${scopeId},'excluded',${tableId},'legacy')`.execute(
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
        (await created.pglite.query(`SELECT * FROM ${frontierTable} WHERE kind = 'fallback'`)).rows
      ).toHaveLength(1);
    }
  );

  it('keeps original consumed sources and deferred candidate rows', async () => {
    await dirty('same');
    await record(changes('same', 1, 1));
    await sql`INSERT INTO ${sql.table(ledgerTable)}(scope_id,kind,table_id,record_id) VALUES (${scopeId},'consumed',${tableId},'direct-source')`.execute(
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
    await sql`INSERT INTO ${sql.table(outboxTable)}(id,dirty_stats) VALUES ('child', ${JSON.stringify({ ledgerScopeId: 'active' })}::jsonb), ('root', NULL)`.execute(
      created.db
    );
    await created.pglite
      .exec(`INSERT INTO ${frontierTable}(scope_id,kind,table_id,record_id,field_id)
      SELECT 'orphan','changed','t', n::text,'f' FROM generate_series(1,1500) n;
      INSERT INTO ${frontierTable} VALUES ('active','changed','t','r','f'), ('root','changed','t','r','f')`);
    const first = await cleanupChangeFrontierOrphans(created.db);
    expect(first.deleted).toBe(1000);
    expect(
      (await created.pglite.query(`SELECT * FROM ${frontierTable} WHERE scope_id='active'`)).rows
    ).toHaveLength(1);
    await cleanupChangeFrontierOrphans(created.db, first.afterScope);
    const second = await cleanupChangeFrontierOrphans(created.db);
    expect(second.deleted).toBe(500);
    expect(
      (await created.pglite.query(`SELECT scope_id FROM ${frontierTable} ORDER BY scope_id`)).rows
    ).toEqual([{ scope_id: 'active' }, { scope_id: 'root' }]);
  });

  it('carries staged frontier sources and exclusions through the configured schema', async () => {
    expect(
      (
        await pushStageLedgerFrontierHead(created.db, scopeId, [
          { tableId, recordIds: ['first', 'second'] },
        ])
      )._unsafeUnwrap()
    ).toBe(2);
    for (const [index, recordId] of ['first', 'second'].entries()) {
      await created.pglite.exec('TRUNCATE tmp_computed_dirty');
      const head = (await seedStageLedgerFrontierHead(created.db, scopeId, 1))._unsafeUnwrap();
      expect(head.consumed).toBe(1);
      await record(changes(recordId, 1, index === 0 ? 2 : 1));
      const appended = (
        await appendStageLedgerPartialBatch(created.db, scopeId, [tableId], {
          appendFrontier: true,
        })
      )._unsafeUnwrap();
      expect(appended.newExcludedRows).toBe(1);
      expect(appended.newFrontierRows).toBe(0);
      if (head.maxSeq === null) throw new Error('Expected a seeded frontier head');
      expect(
        (
          await retireStageLedgerFrontierHead(created.db, scopeId, head.maxSeq, {
            preserveAsConsumed: true,
          })
        )._unsafeUnwrap()
      ).toBe(1);
    }
    expect((await stageLedgerHasFrontier(created.db, scopeId))._unsafeUnwrap()).toBe(false);
    expect(await collectedIds()).toEqual(['first']);
    const retained = await created.pglite.query<{ kind: string; count: number }>(
      `SELECT kind,count(*)::int as count FROM ${ledgerTable} WHERE kind IN ('rerun-source','rerun-input-v1') GROUP BY kind ORDER BY kind`
    );
    expect(retained.rows).toEqual([
      { kind: 'rerun-input-v1', count: 1 },
      { kind: 'rerun-source', count: 2 },
    ]);
    (await clearStageLedger(created.db, scopeId))._unsafeUnwrap();
    expect((await created.pglite.query(`SELECT * FROM ${frontierTable}`)).rows).toEqual([]);
    expect((await created.pglite.query(`SELECT * FROM ${ledgerTable}`)).rows).toEqual([]);
  });

  it('retains generated self-reference sources without making them executable frontier work', async () => {
    (
      await pushStageLedgerFrontierHead(created.db, scopeId, [{ tableId, recordIds: ['original'] }])
    )._unsafeUnwrap();
    await sql`insert into ${sql.table('tmp_computed_dirty')}(table_id,record_id) values(${tableId},'generated')`.execute(
      created.db
    );
    const appended = (
      await appendStageLedgerPartialBatch(created.db, scopeId, [tableId], { appendFrontier: true })
    )._unsafeUnwrap();
    expect(appended.newFrontierRows).toBe(1);
    const retained = await created.pglite.query<{ record_id: string }>(
      `select record_id from ${ledgerTable} where kind='rerun-source' order by record_id`
    );
    expect(retained.rows).toEqual([{ record_id: 'generated' }, { record_id: 'original' }]);
    (await retireStageLedgerFrontierHead(created.db, scopeId, '100'))._unsafeUnwrap();
    expect((await stageLedgerHasFrontier(created.db, scopeId))._unsafeUnwrap()).toBe(false);
    (await clearStageLedger(created.db, scopeId))._unsafeUnwrap();
    expect((await created.pglite.query(`select * from ${ledgerTable}`)).rows).toEqual([]);
  });

  it.skipIf(schema === 'public')(
    'does not read or delete same-named tables in public',
    async () => {
      await created.pglite.exec(`
      CREATE TABLE public.computed_update_change_frontier (LIKE ${frontierTable} INCLUDING ALL);
      CREATE TABLE public.computed_update_outbox (LIKE ${outboxTable} INCLUDING ALL);
    `);
      try {
        await created.pglite.exec(`
        INSERT INTO public.computed_update_change_frontier VALUES ('public-only','changed','t','r','f');
        INSERT INTO public.computed_update_outbox VALUES ('orphan', NULL);
        INSERT INTO ${frontierTable} VALUES ('active','changed','t','r','f'), ('orphan','changed','t','r','f');
        INSERT INTO ${outboxTable} VALUES ('active', NULL);
      `);
        expect((await cleanupChangeFrontierOrphans(created.db)).deleted).toBe(1);
        expect((await created.pglite.query(`SELECT scope_id FROM ${frontierTable}`)).rows).toEqual([
          { scope_id: 'active' },
        ]);
        expect(
          (
            await created.pglite.query(
              'SELECT scope_id FROM public.computed_update_change_frontier'
            )
          ).rows
        ).toEqual([{ scope_id: 'public-only' }]);
        expect(
          (await created.pglite.query('SELECT id FROM public.computed_update_outbox')).rows
        ).toEqual([{ id: 'orphan' }]);
      } finally {
        await created.pglite.exec(`
        DROP TABLE public.computed_update_change_frontier;
        DROP TABLE public.computed_update_outbox;
      `);
      }
    }
  );

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
    expect((await created.pglite.query(`SELECT * FROM ${frontierTable}`)).rows).toEqual([]);
    expect(await collectedIds()).toEqual(['rollback']);
  });

  it('retires irrelevant frontier tables while preserving relevant frontier and rerun-source rows', async () => {
    const unrelatedTableId = 'tblzzzzzzzzzzzzzzzz';
    (
      await pushStageLedgerFrontierHead(created.db, scopeId, [
        { tableId, recordIds: ['keep-a'] },
        { tableId: unrelatedTableId, recordIds: ['drop-a'] },
      ])
    )._unsafeUnwrap();

    const deletedCount = (
      await retireIrrelevantStageLedgerFrontier(created.db, scopeId, [tableId], {
        preserveAsConsumed: false,
      })
    )._unsafeUnwrap();
    expect(deletedCount).toBe(1);

    const remainingAfterDelete = await created.pglite.query<{
      kind: string;
      table_id: string;
      record_id: string;
    }>(`SELECT kind, table_id, record_id FROM ${ledgerTable} ORDER BY kind, table_id, record_id`);
    expect(remainingAfterDelete.rows).toEqual([
      { kind: 'frontier', table_id: tableId, record_id: 'keep-a' },
      { kind: 'rerun-input-v1', table_id: '', record_id: '' },
      { kind: 'rerun-source', table_id: tableId, record_id: 'keep-a' },
      { kind: 'rerun-source', table_id: unrelatedTableId, record_id: 'drop-a' },
    ]);

    const secondUnrelated = 'tblzzzzzzzzzzzzzzzy';
    (
      await pushStageLedgerFrontierHead(created.db, scopeId, [
        { tableId: secondUnrelated, recordIds: ['preserve-b'] },
      ])
    )._unsafeUnwrap();
    const movedCount = (
      await retireIrrelevantStageLedgerFrontier(created.db, scopeId, [tableId], {
        preserveAsConsumed: true,
      })
    )._unsafeUnwrap();
    expect(movedCount).toBe(1);

    const collected = (
      await collectStageOutputSeedGroups(created.db, scopeId, [secondUnrelated], {
        seedAllThreshold: 100,
        exactIdsTotalCap: 100,
        includeConsumedSources: true,
      })
    )._unsafeUnwrap();
    expect(collected.groups).toEqual([{ tableId: secondUnrelated, recordIds: ['preserve-b'] }]);
  });

  it('fast-forwards empty frontier slices in prepareDirtyState until a slice produces dirty outputs', async () => {
    const baseIdStr = `bse${'f'.repeat(16)}`;
    const ordersIdStr = `tbl${'g'.repeat(16)}`;
    const customersIdStr = `tbl${'h'.repeat(16)}`;
    const xIdStr = `fld${'j'.repeat(16)}`;
    const roundedIdStr = `fld${'k'.repeat(16)}`;
    const nameIdStr = `fld${'m'.repeat(16)}`;
    const linkIdStr = `fld${'n'.repeat(16)}`;
    const lookupIdStr = `fld${'p'.repeat(16)}`;
    const fkCol = `__fk_${linkIdStr}`;

    const baseId = BaseId.create(baseIdStr)._unsafeUnwrap();
    const ordersId = TableId.create(ordersIdStr)._unsafeUnwrap();
    const customersId = TableId.create(customersIdStr)._unsafeUnwrap();
    const xId = FieldId.create(xIdStr)._unsafeUnwrap();
    const roundedId = FieldId.create(roundedIdStr)._unsafeUnwrap();
    const nameId = FieldId.create(nameIdStr)._unsafeUnwrap();
    const linkId = FieldId.create(linkIdStr)._unsafeUnwrap();
    const lookupId = FieldId.create(lookupIdStr)._unsafeUnwrap();

    const ordersBuilder = Table.builder()
      .withId(ordersId)
      .withBaseId(baseId)
      .withName(TableName.create('FastForwardOrders')._unsafeUnwrap())
      .withDbTableName(DbTableName.rehydrate(`${baseIdStr}.${ordersIdStr}`)._unsafeUnwrap());
    ordersBuilder
      .field()
      .number()
      .withId(xId)
      .withName(FieldName.create('X')._unsafeUnwrap())
      .done();
    ordersBuilder
      .field()
      .formula()
      .withId(roundedId)
      .withName(FieldName.create('Rounded')._unsafeUnwrap())
      .withExpression(FormulaExpression.create(`ROUND({${xIdStr}}, 0)`)._unsafeUnwrap())
      .withResultType({
        cellValueType: CellValueType.number(),
        isMultipleCellValue: CellValueMultiplicity.single(),
      })
      .done();
    ordersBuilder.view().defaultGrid().done();
    const orders = ordersBuilder.build()._unsafeUnwrap();
    orders
      .getField((f) => f.id().equals(xId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_x')._unsafeUnwrap())
      ._unsafeUnwrap();
    orders
      .getField((f) => f.id().equals(roundedId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_rounded')._unsafeUnwrap())
      ._unsafeUnwrap();

    const linkConfig = LinkFieldConfig.create({
      relationship: 'manyOne',
      foreignTableId: ordersIdStr,
      lookupFieldId: xIdStr,
      fkHostTableName: `${baseIdStr}.${customersIdStr}`,
      selfKeyName: '__id',
      foreignKeyName: fkCol,
    })._unsafeUnwrap();
    const lookupOptions = LookupOptions.create({
      linkFieldId: linkIdStr,
      lookupFieldId: roundedIdStr,
      foreignTableId: ordersIdStr,
    })._unsafeUnwrap();

    const customersBuilder = Table.builder()
      .withId(customersId)
      .withBaseId(baseId)
      .withName(TableName.create('FastForwardCustomers')._unsafeUnwrap())
      .withDbTableName(DbTableName.rehydrate(`${baseIdStr}.${customersIdStr}`)._unsafeUnwrap());
    customersBuilder
      .field()
      .singleLineText()
      .withId(nameId)
      .withName(FieldName.create('Name')._unsafeUnwrap())
      .primary()
      .done();
    customersBuilder
      .field()
      .link()
      .withId(linkId)
      .withName(FieldName.create('Order')._unsafeUnwrap())
      .withConfig(linkConfig)
      .done();
    customersBuilder
      .field()
      .lookup()
      .withId(lookupId)
      .withName(FieldName.create('RoundedLookup')._unsafeUnwrap())
      .withLookupOptions(lookupOptions)
      .withInnerField(orders.getField((f) => f.id().equals(roundedId))._unsafeUnwrap())
      .done();
    customersBuilder.view().defaultGrid().done();
    const customers = customersBuilder.build()._unsafeUnwrap();
    customers
      .getField((f) => f.id().equals(nameId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_name')._unsafeUnwrap())
      ._unsafeUnwrap();
    customers
      .getField((f) => f.id().equals(linkId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_link')._unsafeUnwrap())
      ._unsafeUnwrap();
    customers
      .getField((f) => f.id().equals(lookupId))
      ._unsafeUnwrap()
      .setDbFieldName(DbFieldName.rehydrate('col_lookup')._unsafeUnwrap())
      ._unsafeUnwrap();

    await created.pglite.exec(`
      CREATE SCHEMA IF NOT EXISTS "${baseIdStr}";
      DROP TABLE IF EXISTS "${baseIdStr}"."${customersIdStr}";
      DROP TABLE IF EXISTS "${baseIdStr}"."${ordersIdStr}";
      CREATE TABLE "${baseIdStr}"."${ordersIdStr}" (
        __id text PRIMARY KEY,
        __version integer NOT NULL,
        col_x double precision,
        col_rounded double precision
      );
      CREATE TABLE "${baseIdStr}"."${customersIdStr}" (
        __id text PRIMARY KEY,
        __version integer NOT NULL,
        col_name text,
        col_link jsonb,
        "${fkCol}" text,
        col_lookup jsonb
      );
      INSERT INTO "${baseIdStr}"."${ordersIdStr}" VALUES
        ('rec_ff_1', 1, 1.1, 1),
        ('rec_ff_2', 1, 2.1, 2),
        ('rec_ff_3', 1, 3.1, 3),
        ('rec_ff_4', 1, 4.1, 4),
        ('rec_ff_5', 1, 5.1, 5),
        ('rec_ff_6', 1, 6.1, 6),
        ('rec_ff_7', 1, 7.1, 7);
      INSERT INTO "${baseIdStr}"."${customersIdStr}" VALUES
        ('rec_cus_6', 1, 'c6', NULL, 'rec_ff_6', NULL);
    `);

    const logger: ILogger = {
      child: () => logger,
      scope: () => logger,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const tableRepo: ITableRepository = {
      insert: async () => err(domainError.notImplemented({ message: 'unused' })),
      insertMany: async () => err(domainError.notImplemented({ message: 'unused' })),
      findOne: async () => err(domainError.notImplemented({ message: 'unused' })),
      find: async () => ok([orders, customers]),
      updateOne: async () => err(domainError.notImplemented({ message: 'unused' })),
      delete: async () => err(domainError.notImplemented({ message: 'unused' })),
      restore: async () => err(domainError.notImplemented({ message: 'unused' })),
    };

    const scopeId = 'cuo_ff_prepare_1';
    await sql`
      insert into ${sql.table(ledgerTable)} (scope_id, kind, table_id, record_id, seq)
      select ${scopeId}, 'frontier', ${ordersIdStr}, 'rec_ff_' || seq, seq
      from generate_series(1, 7) as seeds(seq)
    `.execute(created.db);

    const plan: ComputedUpdatePlan = {
      baseId,
      seedTableId: ordersId,
      seedRecordIds: [],
      extraSeedRecords: [],
      changedFieldIds: [xId],
      steps: [{ tableId: customersId, fieldIds: [lookupId], level: 0 }],
      edges: [
        {
          fromTableId: ordersId,
          toTableId: customersId,
          fromFieldId: roundedId,
          toFieldId: lookupId,
          linkFieldId: linkId,
          propagationMode: 'linkTraversal',
          order: 0,
        },
      ],
      estimatedComplexity: 1,
      changeType: 'update',
      sameTableBatches: [],
    };

    await created.db.transaction().execute(async (trx) => {
      const updater = new ComputedFieldUpdater(
        tableRepo,
        logger,
        trx,
        undefined,
        new Pg16TypeValidationStrategy()
      );
      const preparedResult = await updater.prepareDirtyState(
        plan,
        { actorId: ActorId.create('usr_ff_test')._unsafeUnwrap() },
        {
          maxDirtyRecords: 2,
          dirtyBudgetMode: 'partial',
          ledgerScopeId: scopeId,
        }
      );
      if (preparedResult.isErr()) throw new Error(preparedResult.error.message);
      const prepared = preparedResult._unsafeUnwrap();
      expect(prepared.dirtyStats).toHaveLength(2);
      expect(prepared.dirtyStats).toEqual(
        expect.arrayContaining([
          { tableId: ordersIdStr, recordCount: 1 },
          { tableId: customersIdStr, recordCount: 1 },
        ])
      );
      expect(prepared.propagationStats.dirtyBudget).toMatchObject({
        status: 'partial',
        frontierMaxSeq: '6',
        frontierConsumed: 1,
      });
      const remaining = await sql<{ record_id: string }>`
        select record_id from ${sql.table(ledgerTable)}
        where scope_id = ${scopeId} and kind = 'frontier' order by seq
      `.execute(trx);
      expect(remaining.rows.map((row) => row.record_id)).toEqual(['rec_ff_6', 'rec_ff_7']);
    });
  });
});
