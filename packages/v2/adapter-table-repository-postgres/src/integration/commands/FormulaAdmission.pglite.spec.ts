import {
  createV2PostgresPgliteDb,
  registerV2PostgresPgliteDb,
  v2DataDbTokens,
  v2PostgresDbTokens,
} from '@teable/v2-adapter-db-postgres-pglite';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateTableCommand,
  CreateFieldCommand,
  CreateFieldsCommand,
  UpdateFieldCommand,
  DuplicateFieldCommand,
  DuplicateTableCommand,
  DuplicateBaseCommand,
  MemoryUndoRedoStore,
  UndoCommand,
  RedoCommand,
  TableId,
  FieldId,
  v2CoreTokens,
  type ICommandBus,
  type CreateTableResult,
  type CreateFieldsResult,
  type DuplicateBaseResult,
  type ITableMapper,
} from '@teable/v2-core';
import {
  createFormulaCompileBudgetPolicy,
  defaultFormulaCompileBudgetLimits,
} from '@teable/v2-formula-sql-pg';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Uses the real metadata repository, DDL repository, plugins, command bus and async outbox.
describe('formula admission persistence', () => {
  let test: IV2NodeTestContainer;
  let commands: ICommandBus;
  const context = { actorId: ActorId.create('system')._unsafeUnwrap() };
  beforeEach(async () => {
    test = await createV2NodeTestContainer({
      connectionString: process.env.FORMULA_PLAN_DATABASE_URL ?? 'memory://',
      formulaCompileBudget: {
        policyVersion: 1,
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          uniqueNodes: 2,
        }),
      },
      computedUpdate: { fieldBackfillConfig: { mode: 'async' } },
    });
    commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
  });

  it('rejects before either split metadata or customer data database is changed', async () => {
    await test.dispose();
    test = await createV2NodeTestContainer({
      connectionString: 'memory://',
      formulaCompileBudget: {
        policyVersion: 1,
        policy: createFormulaCompileBudgetPolicy({
          ...defaultFormulaCompileBudgetLimits,
          uniqueNodes: 2,
        }),
      },
      registerDb: async (container, config) => {
        await registerV2PostgresPgliteDb(container, config);
        const dataDb = await createV2PostgresPgliteDb(config);
        container.registerInstance(v2DataDbTokens.db, dataDb);
        container.registerInstance(v2PostgresDbTokens.db, dataDb);
      },
    });
    commands = test.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const result = await commands.execute(
      context,
      CreateTableCommand.create({
        baseId: test.baseId.toString(),
        tableId,
        name: 'Split rejected',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'formula', name: 'Bad', options: { expression: '1 + 2' } },
        ],
      })._unsafeUnwrap()
    );
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
    expect(
      await test.metaDb.selectFrom('table_meta').select('id').where('id', '=', tableId).execute()
    ).toEqual([]);
    expect(
      await test.metaDb.selectFrom('field').select('id').where('table_id', '=', tableId).execute()
    ).toEqual([]);
    const physical = await sql<{
      count: string;
    }>`select count(*)::text as count from information_schema.tables where table_schema = ${test.baseId.toString()} and table_name = ${tableId}`.execute(
      test.dataDb
    );
    expect(physical.rows[0].count).toBe('0');
    expect(test.eventBus.events()).toEqual([]);
  });
  afterEach(async () => {
    await test?.dispose();
  });

  it('rejects a new table without metadata, DDL, tasks or successful events', async () => {
    const tableId = TableId.generate()._unsafeUnwrap().toString();
    const beforeEvents = test.eventBus.events();
    const result = await commands.execute(
      context,
      CreateTableCommand.create({
        baseId: test.baseId.toString(),
        tableId,
        name: 'Rejected',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'formula', name: 'Dangerous', options: { expression: '1 + 2' } },
        ],
      })._unsafeUnwrap()
    );
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
    expect(
      await test.db.selectFrom('table_meta').select('id').where('id', '=', tableId).execute()
    ).toEqual([]);
    expect(
      await test.db.selectFrom('field').select('id').where('table_id', '=', tableId).execute()
    ).toEqual([]);
    expect(
      await test.db.selectFrom('view').select('id').where('table_id', '=', tableId).execute()
    ).toEqual([]);
    expect(
      await test.db
        .selectFrom('computed_update_outbox')
        .select('id')
        .where('seed_table_id', '=', tableId)
        .execute()
    ).toEqual([]);
    const physical = await sql<{
      count: string;
    }>`select count(*)::text as count from information_schema.tables where table_schema = ${test.baseId.toString()} and table_name = ${tableId}`.execute(
      test.db
    );
    expect(physical.rows[0].count).toBe('0');
    expect(test.eventBus.events()).toEqual(beforeEvents);
  });

  it.each([0, 10000])(
    'preserves legacy and rejected definitions with %i existing records',
    async (recordCount) => {
      const formulaId = FieldId.generate()._unsafeUnwrap().toString();
      const textId = FieldId.generate()._unsafeUnwrap().toString();
      const created = (
        await commands.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create({
            baseId: test.baseId.toString(),
            name: 'Legacy',
            fields: [
              { type: 'singleLineText', name: 'Name', isPrimary: true },
              { id: textId, type: 'singleLineText', name: 'Convert me' },
              {
                id: formulaId,
                type: 'formula',
                name: 'Legacy formula',
                options: { expression: '1' },
              },
            ],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const tableId = created.table.id().toString();
      const physicalTable = created.table.dbTableName()._unsafeUnwrap().value()._unsafeUnwrap();
      await sql`INSERT INTO ${sql.table(physicalTable)} (__id, __version, __created_by, __last_modified_by)
      SELECT 'rec' || lpad(n::text, 16, '0'), 7, 'system', 'system' FROM generate_series(1, ${recordCount}::int) AS n`.execute(
        test.db
      );
      const dataState = () =>
        sql<{ count: number; version_sum: string }>`SELECT count(*)::int AS count,
      coalesce(sum(__version), 0)::text AS version_sum FROM ${sql.table(physicalTable)}`.execute(
          test.db
        );
      const beforeData = await dataState();
      expect(beforeData.rows[0]).toEqual({
        count: recordCount,
        version_sum: String(recordCount * 7),
      });
      // Model a pre-rollout row, not a user-supplied metadata flag.
      await test.db
        .updateTable('field')
        .set({ options: JSON.stringify({ expression: '1 + 2' }), meta: null })
        .where('id', '=', formulaId)
        .execute();
      (
        await commands.execute(
          context,
          UpdateFieldCommand.create({
            tableId,
            fieldId: formulaId,
            field: { name: 'Renamed legacy' },
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const previous = await test.db
        .selectFrom('field')
        .selectAll()
        .where('table_id', '=', tableId)
        .orderBy('id')
        .execute();
      const tasks = await test.db
        .selectFrom('computed_update_outbox')
        .selectAll()
        .where('seed_table_id', '=', tableId)
        .orderBy('id')
        .execute();
      const events = test.eventBus.events();
      (
        await commands.execute(
          context,
          UpdateFieldCommand.create(
            { tableId, fieldId: formulaId, field: { options: { expression: '1 + 2' } } },
            { allowNoop: true }
          )._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const attempted = [
        CreateFieldCommand.create({
          baseId: test.baseId.toString(),
          tableId,
          field: { type: 'formula', name: 'New', options: { expression: '1 + 2' } },
        })._unsafeUnwrap(),
        UpdateFieldCommand.create({
          tableId,
          fieldId: textId,
          field: { type: 'formula', options: { expression: '1 + 2' } },
        })._unsafeUnwrap(),
        UpdateFieldCommand.create({
          tableId,
          fieldId: formulaId,
          field: { options: { expression: '2 + 3' } },
        })._unsafeUnwrap(),
        DuplicateFieldCommand.create({
          baseId: test.baseId.toString(),
          tableId,
          fieldId: formulaId,
        })._unsafeUnwrap(),
      ];
      for (const command of attempted) {
        const result = await commands.execute(context, command);
        expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
      }
      expect(
        await test.db
          .selectFrom('field')
          .selectAll()
          .where('table_id', '=', tableId)
          .orderBy('id')
          .execute()
      ).toEqual(previous);
      expect(
        await test.db
          .selectFrom('computed_update_outbox')
          .selectAll()
          .where('seed_table_id', '=', tableId)
          .orderBy('id')
          .execute()
      ).toEqual(tasks);
      expect(test.eventBus.events()).toEqual(events);
      expect((await dataState()).rows).toEqual(beforeData.rows);
      expect(previous.find((field) => field.id === formulaId)?.meta).toBeNull();
      (
        await commands.execute(
          context,
          UpdateFieldCommand.create({
            tableId,
            fieldId: formulaId,
            field: { options: { expression: '2' } },
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const saved = await test.db
        .selectFrom('field')
        .select('meta')
        .where('id', '=', formulaId)
        .executeTakeFirstOrThrow();
      expect(JSON.parse(saved.meta!)).toMatchObject({ formulaSafetyVersion: 1 });
    }
  );

  it('uses the full same-batch candidate for references and marks both admitted fields', async () => {
    const legacyId = FieldId.generate()._unsafeUnwrap().toString();
    const created = (
      await commands.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: test.baseId.toString(),
          name: 'Batch',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: legacyId, type: 'formula', name: 'Legacy', options: { expression: '1' } },
          ],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const tableId = created.table.id().toString();
    await test.db
      .updateTable('field')
      .set({ options: JSON.stringify({ expression: '1 + 2' }), meta: null })
      .where('id', '=', legacyId)
      .execute();
    const sourceId = FieldId.generate()._unsafeUnwrap().toString();
    const rootId = FieldId.generate()._unsafeUnwrap().toString();
    const result = await commands.execute<CreateFieldsCommand, CreateFieldsResult>(
      context,
      CreateFieldsCommand.create({
        baseId: test.baseId.toString(),
        tableId,
        fields: [
          {
            id: rootId,
            type: 'formula',
            name: 'Forward reference',
            options: { expression: `{${sourceId}}` },
          },
          { id: sourceId, type: 'formula', name: 'Source', options: { expression: '1' } },
        ],
      })._unsafeUnwrap()
    );
    result._unsafeUnwrap();
    const rows = await test.db
      .selectFrom('field')
      .select(['id', 'meta'])
      .where('id', 'in', [rootId, sourceId])
      .orderBy('id')
      .execute();
    expect(
      rows.map((row) => ({ id: row.id, version: JSON.parse(row.meta!).formulaSafetyVersion }))
    ).toEqual([rootId, sourceId].sort().map((id) => ({ id, version: 1 })));
    expect(
      (
        await test.db
          .selectFrom('field')
          .select('meta')
          .where('id', '=', legacyId)
          .executeTakeFirstOrThrow()
      ).meta
    ).toBeNull();
  });

  it('rejects an unsafe legacy formula through the real duplicate-table command', async () => {
    const source = (
      await commands.execute<CreateTableCommand, CreateTableResult>(
        context,
        CreateTableCommand.create({
          baseId: test.baseId.toString(),
          name: 'Duplicate source',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { type: 'formula', name: 'Formula', options: { expression: '1' } },
          ],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const sourceId = source.table.id().toString();
    await test.db
      .updateTable('field')
      .set({ options: JSON.stringify({ expression: '1 + 2' }), meta: null })
      .where('table_id', '=', sourceId)
      .where('type', '=', 'formula')
      .execute();
    const beforeTables = await test.db.selectFrom('table_meta').select('id').execute();
    const beforeEvents = test.eventBus.events();
    const result = await commands.execute(
      context,
      DuplicateTableCommand.create({
        baseId: test.baseId.toString(),
        tableId: sourceId,
        name: 'Rejected duplicate',
        includeRecords: false,
      })._unsafeUnwrap()
    );
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
    expect(await test.db.selectFrom('table_meta').select('id').execute()).toEqual(beforeTables);
    expect(test.eventBus.events()).toEqual(beforeEvents);
  });
  it.each(['portable', 'native'] as const)(
    'admits %s formula imports through the real base-copy stream before persisting any table',
    async (mode) => {
      const sourceTableId = TableId.generate()._unsafeUnwrap().toString();
      const sourceFormulaId = FieldId.generate()._unsafeUnwrap().toString();
      const sourceNameId = FieldId.generate()._unsafeUnwrap().toString();
      const { table: source } = (
        await commands.execute<CreateTableCommand, CreateTableResult>(
          context,
          CreateTableCommand.create({
            baseId: test.baseId.toString(),
            tableId: sourceTableId,
            name: 'Copy source',
            fields: [
              { id: sourceNameId, name: 'Name', type: 'singleLineText', isPrimary: true },
              {
                id: sourceFormulaId,
                name: 'Formula',
                type: 'formula',
                options: { expression: '1' },
              },
            ],
          })._unsafeUnwrap()
        )
      )._unsafeUnwrap();
      const snapshot = test.container
        .resolve<ITableMapper>(v2CoreTokens.tableMapper)
        .toDTO(source)
        ._unsafeUnwrap();
      const state = async () => ({
        tables: await test.metaDb.selectFrom('table_meta').selectAll().orderBy('id').execute(),
        fields: await test.metaDb.selectFrom('field').selectAll().orderBy('id').execute(),
        tasks: await test.dataDb
          .selectFrom('computed_update_outbox')
          .selectAll()
          .orderBy('id')
          .execute(),
        physical: (
          await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = ${test.baseId.toString()} ORDER BY table_name`.execute(
            test.dataDb
          )
        ).rows,
        events: test.eventBus.events(),
      });
      const before = await state();
      const importFormula = async (expression: string) => {
        const stream = (
          await commands.execute<DuplicateBaseCommand, DuplicateBaseResult>(
            context,
            DuplicateBaseCommand.createFromSource({
              baseId: test.baseId.toString(),
              withRecords: false,
              source: {
                structure: {
                  tables: [
                    {
                      id: sourceTableId,
                      name: 'Portable formula',
                      views: snapshot.views,
                      fields: [
                        { id: sourceNameId, name: 'Name', type: 'singleLineText', isPrimary: true },
                        {
                          id: sourceFormulaId,
                          name: 'Formula',
                          type: 'formula',
                          options: { expression },
                        },
                      ],
                    },
                  ],
                },
                tableSnapshots:
                  mode === 'native'
                    ? new Map([
                        [
                          sourceTableId,
                          {
                            ...snapshot,
                            fields: snapshot.fields.map((field) =>
                              field.type === 'formula'
                                ? { ...field, options: { ...field.options, expression } }
                                : field
                            ),
                          },
                        ],
                      ])
                    : undefined,
                records: async function* () {
                  yield { fields: { [sourceNameId]: 'Copy source' } };
                },
              },
            })._unsafeUnwrap()
          )
        )._unsafeUnwrap();
        const events = [];
        for await (const event of stream) events.push(event);
        return events;
      };
      const rejected = await importFormula('1 + 2');
      expect(rejected.find((event) => event.id === 'error')).toMatchObject({
        code: 'validation.limit.formula_compile_nodes_max',
      });
      expect(rejected.some((event) => event.id === 'done')).toBe(false);
      expect(await state()).toEqual(before);
      const accepted = await importFormula('1');
      const done = accepted.find((event) => event.id === 'done');
      if (!done || done.id !== 'done') throw new Error(JSON.stringify(accepted));
      const stored = await test.metaDb
        .selectFrom('field')
        .select('meta')
        .where('id', '=', done.fieldIdMap[sourceFormulaId])
        .executeTakeFirstOrThrow();
      expect(JSON.parse(stored.meta!)).toMatchObject({ formulaSafetyVersion: 1 });
    }
  );

  it('retains enforced ownership through real undo and redo without promoting unchanged legacy renames', async () => {
    test.container.registerInstance(v2CoreTokens.undoRedoStore, new MemoryUndoRedoStore());
    const editing = { ...context, windowId: 'formula-admission-history' };
    const fieldId = FieldId.generate()._unsafeUnwrap().toString();
    const { table } = (
      await commands.execute<CreateTableCommand, CreateTableResult>(
        editing,
        CreateTableCommand.create({
          baseId: test.baseId.toString(),
          name: 'Undo safety',
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            { id: fieldId, type: 'formula', name: 'Formula', options: { expression: '1' } },
          ],
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const tableId = table.id().toString();
    const saved = () =>
      test.metaDb
        .selectFrom('field')
        .select(['meta', 'options', 'name'])
        .where('id', '=', fieldId)
        .executeTakeFirstOrThrow();
    await test.metaDb.updateTable('field').set({ meta: null }).where('id', '=', fieldId).execute();
    (
      await commands.execute(
        editing,
        UpdateFieldCommand.create({
          tableId,
          fieldId,
          field: { options: { expression: '2' } },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    for (const [command, expression] of [
      [UndoCommand.create({ tableId, windowId: editing.windowId })._unsafeUnwrap(), '1'],
      [RedoCommand.create({ tableId, windowId: editing.windowId })._unsafeUnwrap(), '2'],
    ] as const) {
      (await commands.execute(editing, command))._unsafeUnwrap();
      const row = await saved();
      expect(JSON.parse(row.meta!)).toMatchObject({ formulaSafetyVersion: 1 });
      expect(JSON.parse(row.options!)).toMatchObject({ expression });
    }
    await test.metaDb.updateTable('field').set({ meta: null }).where('id', '=', fieldId).execute();
    (
      await commands.execute(
        editing,
        UpdateFieldCommand.create({
          tableId,
          fieldId,
          field: { name: 'Renamed legacy' },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    for (const command of [
      UndoCommand.create({ tableId, windowId: editing.windowId })._unsafeUnwrap(),
      RedoCommand.create({ tableId, windowId: editing.windowId })._unsafeUnwrap(),
    ]) {
      (await commands.execute(editing, command))._unsafeUnwrap();
      expect((await saved()).meta).toBeNull();
    }
    await test.metaDb
      .updateTable('field')
      .set({ meta: null, options: JSON.stringify({ expression: '1 + 2' }) })
      .where('id', '=', fieldId)
      .execute();
    (
      await commands.execute(
        editing,
        UpdateFieldCommand.create({
          tableId,
          fieldId,
          field: { options: { expression: '2' } },
        })._unsafeUnwrap()
      )
    )._unsafeUnwrap();
    const beforeRejectedUndo = await saved();
    const rejectedUndo = await commands.execute(
      editing,
      UndoCommand.create({ tableId, windowId: editing.windowId })._unsafeUnwrap()
    );
    expect(rejectedUndo._unsafeUnwrapErr().code).toBe('validation.limit.formula_compile_nodes_max');
    expect(await saved()).toEqual(beforeRejectedUndo);
  });
});
