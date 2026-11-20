/* eslint-disable @typescript-eslint/naming-convention */
import {
  PostgresTableRecordQueryRepository,
  v2RecordRepositoryPostgresTokens,
  type TableRecordQueryBuilderManager,
} from '@teable/v2-adapter-table-repository-postgres';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateTableCommand,
  DeleteFieldCommand,
  NoopLogger,
  RecordByIdsSpec,
  RecordSearch,
  TableByIdSpec,
  TableId,
  UpdateFieldCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateTableResult,
  type DeleteFieldResult,
  type DomainError,
  type ICommandBus,
  type ITableRecordCountOptions,
  type ITableRecordCountQueryRepository,
  type ITableRepository,
  type Table,
  type UpdateFieldResult,
} from '@teable/v2-core';
import type { V1TeableDatabase } from '@teable/v2-postgres-schema';
import {
  registerV2TableOps,
  resolveTableSearchAccessPath,
  RunTableQueryRemediationTaskCommand,
  v2TableOpsTokens,
  type TableQueryRemediationTask,
  type TableQueryRemediationTaskRepository,
} from '@teable/v2-table-query-ops';
import { CompiledQuery, PostgresQueryCompiler, sql, type Kysely } from 'kysely';
import type { Result } from 'neverthrow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { getTablePhysicalName, makePhysicalTableSql, quoteIdentifier } from './helpers';
import { registerV2TableOpsPostgresAdapter } from './register';
import { createResidualSearchIndex, inspectResidualSearchIndex } from './searchResidual';
import {
  PostgresTableSearchVectorAdvisor,
  PostgresTableSearchVectorExecutor,
  PostgresTableSearchVectorReconciler,
  readSubstringSearchCapabilities,
} from './searchVector';
import { PostgresTableSearchAccessPathMetadataPublisher } from './searchVectorMetadata';
import type { UnknownPostgresDatabase } from './types';

type ObservedSearch = {
  ids: string[];
  count: number;
  cells: number;
  countStatement: CompiledQuery<unknown>;
};

const enabled =
  /^postgres(?:ql)?:/.test(process.env.TEABLE_V2_TEST_DATABASE_URL ?? '') ||
  process.env.TEABLE_V2_RUN_SEARCH_VECTOR_PG_INTEGRATION === '1';
const context = { actorId: ActorId.create('system')._unsafeUnwrap() };

const expectOk = <T>(result: Result<T, DomainError>): T => {
  expect(result.isErr() ? result.error : undefined).toBeUndefined();
  return result._unsafeUnwrap();
};

(enabled ? describe : describe.skip)(
  'combined residual substring serving lifecycle (real PG)',
  () => {
    let test: IV2NodeTestContainer;
    let commands: ICommandBus;
    let tables: ITableRepository;
    let records: ITableRecordCountQueryRepository;
    let db: Kysely<UnknownPostgresDatabase>;
    let reconciler: PostgresTableSearchVectorReconciler;
    let publisher: PostgresTableSearchAccessPathMetadataPublisher;
    const fixtureTableIds: string[] = [];
    const captured: CompiledQuery<unknown>[] = [];

    beforeAll(async () => {
      test = await createV2NodeTestContainer();
      registerV2TableOps(test.container);
      await registerV2TableOpsPostgresAdapter(test.container, { ensureSchema: true });
      commands = test.container.resolve(v2CoreTokens.commandBus);
      tables = test.container.resolve(v2CoreTokens.tableRepository);
      db = test.dataDb as unknown as Kysely<UnknownPostgresDatabase>;
      await sql.raw('CREATE EXTENSION IF NOT EXISTS pg_trgm').execute(db);
      const nativeDb = db.withPlugin({
        transformQuery(args) {
          captured.push(new PostgresQueryCompiler().compileQuery(args.node, args.queryId));
          return args.node;
        },
        async transformResult(args) {
          return args.result;
        },
      }) as unknown as Kysely<V1TeableDatabase>;
      records = new PostgresTableRecordQueryRepository(
        test.container.resolve<TableRecordQueryBuilderManager>(
          v2RecordRepositoryPostgresTokens.tableRecordQueryBuilderManager
        ),
        nativeDb,
        new NoopLogger()
      );
      reconciler = new PostgresTableSearchVectorReconciler(
        test.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
        db
      );
      publisher = new PostgresTableSearchAccessPathMetadataPublisher(
        test.metaDb as unknown as Kysely<UnknownPostgresDatabase>,
        db,
        tables
      );
    }, 120_000);
    afterAll(async () => {
      await test?.dispose();
    });
    afterEach(async () => {
      if (!fixtureTableIds.length) return;
      await sql`DELETE FROM table_query_remediation_task
        WHERE table_id = ANY(${fixtureTableIds.splice(0)}::text[])`.execute(test.metaDb);
    });

    const load = async (table: Table) =>
      expectOk(
        await tables.findOne(
          context,
          TableByIdSpec.create(expectOk(TableId.create(table.id().toString())))
        )
      );

    const fixture = async () => {
      const { table } = expectOk(
        await commands.execute<CreateTableCommand, CreateTableResult>(
          context,
          expectOk(
            CreateTableCommand.create({
              baseId: test.baseId.toString(),
              name: 'Residual generated projections',
              fields: [
                { name: 'Title', type: 'singleLineText', isPrimary: true },
                { name: 'Code', type: 'singleLineText' },
                {
                  name: 'Rounded',
                  type: 'number',
                  options: { formatting: { type: 'decimal', precision: 2 } },
                },
                { name: 'Tags', type: 'multipleSelect', options: { choices: [] } },
                { name: 'Sequence', type: 'autoNumber' },
              ],
              views: [{ type: 'grid' }],
            })
          )
        )
      );
      fixtureTableIds.push(table.id().toString());
      const physical = expectOk(getTablePhysicalName(table));
      const relation = makePhysicalTableSql(physical.schema, physical.tableName);
      const field = (name: string) =>
        table.getFields().find((field) => field.name().toString() === name)!;
      const column = (name: string) =>
        quoteIdentifier(expectOk(expectOk(field(name).dbFieldName()).value()));
      await sql
        .raw(`ALTER TABLE ${relation} ADD COLUMN seed_text text, ADD COLUMN seed_num numeric, ADD COLUMN seed_tags jsonb,
      DROP COLUMN ${column('Code')}, DROP COLUMN ${column('Rounded')}, DROP COLUMN ${column('Tags')}`)
        .execute(db);
      await sql
        .raw(`ALTER TABLE ${relation}
      ADD COLUMN ${column('Code')} text GENERATED ALWAYS AS (seed_text) STORED,
      ADD COLUMN ${column('Rounded')} numeric GENERATED ALWAYS AS (seed_num) STORED,
      ADD COLUMN ${column('Tags')} jsonb GENERATED ALWAYS AS (seed_tags) STORED`)
        .execute(db);
      await sql
        .raw(`INSERT INTO ${relation} (__id, __created_by, __version, ${column('Title')}, seed_text, seed_num, seed_tags) VALUES
      ('residual_row_a', 'system', 1, 'coveredunique', 'residualunique %_\\\\ literal 订单', 123.456, '["rarelist", "a_b"]'),
      ('residual_row_b', 'system', 1, 'neutral', '#ERROR!', 7.111, '["common", "100%"]'),
      ('residual_row_c', 'system', 1, null, null, null, null)`)
        .execute(db);
      await sql
        .raw(`INSERT INTO ${relation} (__id, __created_by, __version, ${column('Title')}, seed_text, seed_num, seed_tags)
      SELECT 'residual_filler_' || n, 'system', 1, 'ordinary ' || n, 'unrelated ' || n, n + 10000.1, '["ordinary"]'::jsonb
      FROM generate_series(1, 12000) n`)
        .execute(db);
      await sql.raw(`ANALYZE ${relation}`).execute(db);
      return { table, physical, relation, field, column };
    };

    const observe = async (
      table: Table,
      options: ITableRecordCountOptions
    ): Promise<ObservedSearch> => {
      const ids: string[] = [];
      if (options.fieldMasks?.length) {
        const result = expectOk(
          await records.find(context, table, undefined, { ...options, mode: 'stored' })
        );
        for (const row of result.records) ids.push(row.id.toString());
      } else {
        for await (const row of records.findStream(context, table, undefined, {
          ...options,
          mode: 'stored',
          batchSize: 2000,
        })) {
          ids.push(expectOk(row).id.toString());
        }
      }
      const count = expectOk(
        await records.count(context, table, undefined, { ...options, mode: 'stored' })
      );
      const countStatement = captured.at(-1)!;
      const cells = expectOk(
        await records.countSearchMatches(context, table, undefined, { ...options, mode: 'stored' })
      );
      ids.sort();
      expect(count).toBe(ids.length);
      return { ids, count, cells, countStatement };
    };

    it.for(['pg_trgm', 'pg_bigm'] as const)(
      'preserves complete IDs and row/cell counts with independent %s branches',
      { timeout: 120_000 },
      async (provider, testContext) => {
        if (
          !(await readSubstringSearchCapabilities(db)).providers.some(
            (capability) => capability.provider === provider && capability.usable
          )
        ) {
          testContext.skip();
          return;
        }
        const { table: original, field, relation } = await fixture();
        const probes = [
          'coveredunique',
          'residualunique',
          'rarelist',
          '123.46',
          '订单',
          '%',
          '_',
          '\\',
          '#ERROR!',
          'absent-unique',
          'ordinary',
        ];
        const scope = [
          undefined,
          [field('Title').id()],
          [field('Code').id()],
          [field('Rounded').id()],
          [field('Tags').id()],
        ];
        const before = new Map<string, ObservedSearch>();
        for (const probe of probes)
          for (const visibleFieldIds of scope) {
            const search = { search: RecordSearch.fromTuple([probe, '', true]), visibleFieldIds };
            before.set(
              JSON.stringify([probe, visibleFieldIds]),
              await observe(original, { search })
            );
          }
        expectOk(
          await reconciler.reconcile(context, {
            table: original,
            mode: 'create',
            provider,
            validationMode: 'real_ddl',
            requirePlanImprovement: false,
            allowLargeTableRewrite: true,
          })
        );
        let table = await load(original);
        expect(table.searchIndex()).toMatchObject({
          version: 2,
          document: { ready: true },
          residual: { ready: true },
        });
        expect(table.searchIndex()!.residual!.fields.map((field) => field.fieldId)).toContain(
          field('Sequence').id().toString()
        );
        for (const probe of probes)
          for (const visibleFieldIds of scope) {
            const search = { search: RecordSearch.fromTuple([probe, '', true]), visibleFieldIds };
            const actual = await observe(table, {
              search,
              searchAccessPath: resolveTableSearchAccessPath(table),
            });
            const expected = before.get(JSON.stringify([probe, visibleFieldIds]))!;
            expect(actual.ids).toEqual(expected.ids);
            expect(actual.count).toBe(expected.count);
            expect(actual.cells).toBe(expected.cells);
          }
        for (const [probe, member, branch] of [
          ['coveredunique', field('Title'), 'document'],
          ['residualunique', field('Code'), 'residual'],
        ] as const) {
          const actual = await observe(table, {
            search: {
              search: RecordSearch.fromTuple([probe, '', true]),
              visibleFieldIds: [member.id()],
            },
            searchAccessPath: resolveTableSearchAccessPath(table),
          });
          const plan = await db.executeQuery(
            CompiledQuery.raw(`EXPLAIN (FORMAT JSON) ${actual.countStatement.sql}`, [
              ...actual.countStatement.parameters,
            ])
          );
          expect(JSON.stringify(plan.rows)).toContain(table.searchIndex()![branch]!.indexName);
        }
        for (const probe of ['coveredunique', 'residualunique']) {
          const global = await observe(table, {
            search: { search: RecordSearch.fromTuple([probe, '', true]) },
            searchAccessPath: resolveTableSearchAccessPath(table),
          });
          const plan = await db.executeQuery(
            CompiledQuery.raw(`EXPLAIN (FORMAT JSON) ${global.countStatement.sql}`, [
              ...global.countStatement.parameters,
            ])
          );
          const physicalPlan = JSON.stringify(plan.rows);
          expect(global).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
          expect(physicalPlan).toContain('BitmapOr');
          expect(physicalPlan).toContain(table.searchIndex()!.document!.indexName);
          expect(physicalPlan).toContain(table.searchIndex()!.residual!.indexName);
        }
        const maskedSearch = { search: RecordSearch.fromTuple(['residualunique', '', true]) };
        const masks = [
          { fieldId: field('Code').id().toString(), visibleWhen: RecordByIdsSpec.create([]) },
        ];
        expect(
          await observe(table, {
            search: maskedSearch,
            fieldMasks: masks,
            searchAccessPath: resolveTableSearchAccessPath(table),
          })
        ).toMatchObject({ ids: [], count: 0, cells: 0 });
        const residual = table.searchIndex()!.residual!;
        await sql
          .raw(
            `DROP INDEX ${quoteIdentifier(getTablePhysicalName(table)._unsafeUnwrap().schema)}.${quoteIdentifier(residual.indexName)}`
          )
          .execute(db);
        expectOk(await publisher.refresh(context, table.id().toString()));
        table = await load(table);
        expect(resolveTableSearchAccessPath(table)).toMatchObject({
          document: { ready: true },
          residual: { ready: false },
        });
        expect(
          (
            await observe(table, {
              search: maskedSearch,
              searchAccessPath: resolveTableSearchAccessPath(table),
            })
          ).ids
        ).toEqual(['residual_row_a']);
        expectOk(await reconciler.maintainAfterSchemaChange(context, table));
        table = await load(table);
        expect(table.searchIndex()!.residual!.ready).toBe(true);
        const document = table.searchIndex()!.document!;
        await sql
          .raw(
            `DROP INDEX ${quoteIdentifier(getTablePhysicalName(table)._unsafeUnwrap().schema)}.${quoteIdentifier(document.indexName)}`
          )
          .execute(db);
        expectOk(await publisher.refresh(context, table.id().toString()));
        table = await load(table);
        expect(resolveTableSearchAccessPath(table)).toMatchObject({
          document: { ready: false },
          residual: { ready: true },
        });
        expect(
          (
            await observe(table, {
              search: maskedSearch,
              searchAccessPath: resolveTableSearchAccessPath(table),
            })
          ).ids
        ).toEqual(['residual_row_a']);
        expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
        expect((await load(table)).searchIndex()).toBeUndefined();
        const indexes = await sql<{
          indexname: string;
        }>`SELECT indexname FROM pg_indexes WHERE schemaname = ${getTablePhysicalName(table)._unsafeUnwrap().schema} AND tablename = ${getTablePhysicalName(table)._unsafeUnwrap().tableName}`.execute(
          db
        );
        expect(indexes.rows.some((row) => row.indexname.startsWith('idx_tqops_search_'))).toBe(
          false
        );
        await sql.raw(`ANALYZE ${relation}`).execute(db);
      }
    );

    it('supports a residual-only selected intent and retains exact empty-selection fallback', async () => {
      const { table: original, field } = await fixture();
      expectOk(
        await reconciler.reconcile(context, {
          table: original,
          mode: 'create',
          provider: 'pg_trgm',
          fieldIds: [field('Code').id().toString()],
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
        })
      );
      const table = await load(original);
      expect(table.searchIndex()).not.toHaveProperty('document');
      expect(table.searchIndex()!.residual?.ready).toBe(true);
      const path = resolveTableSearchAccessPath(table)!;
      expect(
        (
          await observe(table, {
            search: { search: RecordSearch.fromTuple(['residualunique', '', true]) },
            searchAccessPath: path,
          })
        ).ids
      ).toEqual(['residual_row_a']);
      expect(
        (
          await observe(table, {
            search: { search: RecordSearch.fromTuple(['coveredunique', '', true]) },
            searchAccessPath: path,
          })
        ).count
      ).toBe(0);
      const emptySelection = await observe(table, {
        search: { search: RecordSearch.fromTuple(['residualunique', '', true]) },
        searchAccessPath: { kind: 'generated_text', searchScope: 'selected_fields', fieldIds: [] },
      });
      expect(emptySelection).toMatchObject({ ids: [], count: 0, cells: 0 });
    }, 120_000);
    it('invalidates the whole residual expression on rename, precision drift and member deletion without disabling its document', async () => {
      const fixture_ = await fixture();
      let table = fixture_.table;
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      table = await load(table);
      const old = table.searchIndex()!;
      const meta = test.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const code = fixture_.field('Code');
      const renamedColumn = 'renamed_residual_code';
      await sql
        .raw(
          `ALTER TABLE ${fixture_.relation} RENAME COLUMN ${fixture_.column('Code')} TO ${quoteIdentifier(renamedColumn)}`
        )
        .execute(db);
      await sql`UPDATE field SET db_field_name = ${renamedColumn} WHERE id = ${code.id().toString()}`.execute(
        meta
      );
      await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
        meta
      );
      expectOk(await publisher.refresh(context, table.id().toString()));
      table = await load(table);
      expect(resolveTableSearchAccessPath(table)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      const query = { search: RecordSearch.fromTuple(['residualunique', '', true]) };
      expect(
        (
          await observe(table, {
            search: query,
            searchAccessPath: resolveTableSearchAccessPath(table),
          })
        ).ids
      ).toEqual(['residual_row_a']);
      expectOk(await reconciler.maintainAfterSchemaChange(context, table));
      table = await load(table);
      expect(
        table
          .searchIndex()!
          .residual!.fields.find((field) => field.fieldId === code.id().toString())!.fieldDbName
      ).toBe(renamedColumn);
      const rounded = fixture_.field('Rounded');
      await sql`UPDATE field SET options = ${JSON.stringify({ formatting: { type: 'decimal', precision: 1 } })} WHERE id = ${rounded.id().toString()}`.execute(
        meta
      );
      await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
        meta
      );
      expectOk(await publisher.refresh(context, table.id().toString()));
      table = await load(table);
      expect(resolveTableSearchAccessPath(table)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      expectOk(await reconciler.maintainAfterSchemaChange(context, table));
      table = await load(table);
      expect(
        (
          await observe(table, {
            search: { search: RecordSearch.fromTuple(['123.5', rounded.id().toString(), true]) },
            searchAccessPath: resolveTableSearchAccessPath(table),
          })
        ).ids
      ).toEqual(['residual_row_a']);
      await sql`UPDATE field SET deleted_time = now() WHERE id = ${code.id().toString()}`.execute(
        meta
      );
      await sql
        .raw(
          `ALTER TABLE ${fixture_.relation} DROP COLUMN ${quoteIdentifier(renamedColumn)} CASCADE`
        )
        .execute(db);
      await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${table.id().toString()}`.execute(
        meta
      );
      expectOk(await publisher.refresh(context, table.id().toString()));
      table = await load(table);
      expect(resolveTableSearchAccessPath(table)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      expectOk(await reconciler.maintainAfterSchemaChange(context, table));
      table = await load(table);
      expect(
        table
          .searchIndex()!
          .residual!.fields.some((field) => field.fieldId === code.id().toString())
      ).toBe(false);
      const executor = new PostgresTableSearchVectorExecutor(meta, db);
      await sql`UPDATE table_query_search_vector_config SET status = 'disabled', reclaim_drop_after = now() - interval '1 second', reclaim_drop_queued_at = now() WHERE table_id = ${table.id().toString()} AND candidate_key = ${old.definitionKey}`.execute(
        meta
      );
      await executor.drop(table.id().toString(), old.definitionKey);
      expect(
        (
          await observe(table, {
            search: { search: RecordSearch.fromTuple(['coveredunique', '', true]) },
            searchAccessPath: resolveTableSearchAccessPath(table),
          })
        ).ids
      ).toEqual(['residual_row_a']);
      expect((await load(table)).searchIndex()!.definitionKey).toBe(
        table.searchIndex()!.definitionKey
      );
      expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
    }, 120_000);

    it('reclaims the unused document independently while retaining a serving residual and all external references', async () => {
      const native = await fixture();
      await sql
        .raw(`DELETE FROM ${native.relation} WHERE __id LIKE 'residual_filler_%'`)
        .execute(db);
      await sql.raw(`ANALYZE ${native.relation}`).execute(db);
      const meta = test.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      expectOk(
        await reconciler.reconcile(context, {
          table: native.table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      let table = await load(native.table);
      const old = table.searchIndex()!;
      const tableId = table.id().toString();
      table = expectOk(
        await commands.execute<CreateFieldCommand, CreateFieldResult>(
          context,
          expectOk(
            CreateFieldCommand.create({
              baseId: table.baseId().toString(),
              tableId,
              field: { type: 'singleLineText', name: 'Additional document' },
            })
          )
        )
      ).table;
      const next = (
        await new PostgresTableSearchVectorAdvisor(db, meta).analyze(context, {
          table,
          provider: 'pg_trgm',
          searchScope: 'all_fields',
          maxRecommendations: 1,
        })
      ).recommendations[0]!;
      const now = new Date();
      const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
      const hhmm = (value: number) =>
        `${Math.floor(value / 60)
          .toString()
          .padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
      const executor = new PostgresTableSearchVectorExecutor(meta, db);
      await executor.execute({
        tableId,
        maintenance: {
          configKey: old.definitionKey,
          searchScope: 'all_fields',
          expansion: true,
          options: {
            windowUtc: `${hhmm((minute + 1410) % 1440)}-${hhmm((minute + 30) % 1440)}`,
            allowUnknownOrLargeRewrite: true,
          },
        },
        payload: {
          candidateKey: next.candidateKey,
          fields: next.coveredFields.map((field) => ({
            ...field,
            fieldDbName: field.fieldDbName!,
          })),
          provider: next.provider,
          operatorClass: next.operatorClass,
          languageConfig: next.languageConfig,
          generatedColumnName: next.generatedColumnName,
          indexName: next.indexName,
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
          searchScope: 'all_fields',
          rebuild: true,
        },
      });
      table = await load(table);
      const published = table.searchIndex()!;
      expect(published.document!.generatedColumnName).not.toBe(old.document!.generatedColumnName);
      // Model a persisted generation that reuses an unchanged residual branch.
      const serving = {
        ...published,
        residual: { ...published.residual!, indexName: old.residual!.indexName },
      };
      await sql`UPDATE table_meta SET search_index = ${JSON.stringify(serving)}::jsonb WHERE id = ${tableId}`.execute(
        meta
      );
      await sql`UPDATE table_query_search_vector_config SET serving_snapshot = ${JSON.stringify(serving)}::jsonb
        WHERE table_id = ${tableId} AND candidate_key = ${published.definitionKey}`.execute(meta);
      table = await load(table);
      expect(table.searchIndex()!.residual!.indexName).toBe(old.residual!.indexName);
      await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
        WHERE table_id = ${tableId} AND candidate_key = ${old.definitionKey}`.execute(meta);
      await sql`UPDATE table_meta SET search_index = ${JSON.stringify(old)}::jsonb WHERE id = ${tableId}`.execute(
        meta
      );
      await expect(executor.drop(tableId, old.definitionKey)).rejects.toThrow('referenced');
      await sql`UPDATE table_meta SET search_index = ${JSON.stringify(serving)}::jsonb WHERE id = ${tableId}`.execute(
        meta
      );
      await sql`INSERT INTO table_query_search_vector_config SELECT
        (jsonb_populate_record(NULL::table_query_search_vector_config,
          to_jsonb(source) || jsonb_build_object('id', ${`foreign_ref_${tableId}`}::text, 'candidate_key', 'external-config-reference'))).*
        FROM table_query_search_vector_config source WHERE table_id = ${tableId} AND candidate_key = ${old.definitionKey}`.execute(
        meta
      );
      await expect(executor.drop(tableId, old.definitionKey)).rejects.toThrow('referenced');
      await sql`DELETE FROM table_query_search_vector_config WHERE table_id = ${tableId} AND candidate_key = 'external-config-reference'`.execute(
        meta
      );
      const foreignIndex = `${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(`foreign_${tableId}`)}`;
      await sql
        .raw(
          `CREATE INDEX ${quoteIdentifier(`foreign_${tableId}`)} ON ${native.relation} (${quoteIdentifier(old.document!.generatedColumnName)})`
        )
        .execute(db);
      await expect(executor.drop(tableId, old.definitionKey)).rejects.toThrow();
      expect(
        (
          await sql<{ present: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(${native.relation}) AND attname = ${old.document!.generatedColumnName}
          AND NOT attisdropped) AS present`.execute(db)
        ).rows[0].present
      ).toBe(true);
      await sql.raw(`DROP INDEX ${foreignIndex}`).execute(db);
      await expect(executor.drop(tableId, old.definitionKey)).rejects.toThrow('referenced');
      expect(
        (
          await sql<{ present: boolean }>`SELECT EXISTS (SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(${native.relation}) AND attname = ${old.document!.generatedColumnName}
          AND NOT attisdropped) AS present`.execute(db)
        ).rows[0].present
      ).toBe(false);
      expect(
        (
          await sql<{
            present: boolean;
          }>`SELECT to_regclass(${`${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(old.residual!.indexName)}`}) IS NOT NULL AS present`.execute(
            db
          )
        ).rows[0].present
      ).toBe(true);
      const retained = (
        await sql<{
          serving_snapshot: unknown;
          reclaim_drop_queued_at: Date;
          reclaim_drop_after: Date;
        }>`
        SELECT serving_snapshot, reclaim_drop_queued_at, reclaim_drop_after FROM table_query_search_vector_config
        WHERE table_id = ${tableId} AND candidate_key = ${old.definitionKey}`.execute(meta)
      ).rows[0];
      expect(retained.serving_snapshot).not.toBeNull();
      expect(retained.reclaim_drop_queued_at).not.toBeNull();
      expect(retained.reclaim_drop_after).not.toBeNull();
      expect((await load(table)).searchIndex()).toEqual(serving);
      expect(
        await observe(table, {
          search: { search: RecordSearch.fromTuple(['residualunique', '', true]) },
          searchAccessPath: resolveTableSearchAccessPath(table),
        })
      ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
      await sql`DELETE FROM table_query_remediation_task WHERE table_id = ${tableId}`.execute(meta);
    }, 120_000);

    it('retires a residual-only physical generation after its persisted grace deadline', async () => {
      const native = await fixture();
      const meta = test.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      expectOk(
        await reconciler.reconcile(context, {
          table: native.table,
          mode: 'create',
          provider: 'pg_trgm',
          fieldIds: [native.field('Code').id().toString(), native.field('Rounded').id().toString()],
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
        })
      );
      const table = await load(native.table);
      const old = table.searchIndex()!;
      const next = (
        await new PostgresTableSearchVectorAdvisor(db, meta).analyze(context, {
          table,
          fieldIds: [native.field('Rounded').id().toString()],
          provider: 'pg_trgm',
          searchScope: 'selected_fields',
          maxRecommendations: 1,
        })
      ).recommendations[0]!;
      const executor = new PostgresTableSearchVectorExecutor(meta, db);
      await executor.execute({
        tableId: table.id().toString(),
        maintenance: {
          configKey: old.definitionKey,
          searchScope: 'selected_fields',
          expansion: false,
          options: {},
        },
        payload: {
          candidateKey: next.candidateKey,
          fields: next.coveredFields.map((field) => ({
            ...field,
            fieldDbName: field.fieldDbName!,
          })),
          provider: next.provider,
          operatorClass: next.operatorClass,
          languageConfig: next.languageConfig,
          indexName: next.indexName,
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          searchScope: 'selected_fields',
          rebuild: true,
        },
      });
      const serving = await load(table);
      expect(serving.searchIndex()!.document).toBeUndefined();
      const tasks = (
        await sql<{
          payload: { scopeKey: string };
        }>`SELECT payload FROM table_query_remediation_task
        WHERE table_id = ${table.id().toString()} AND payload->>'trigger' = 'reclaim'`.execute(meta)
      ).rows;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].payload.scopeKey).toBe(old.definitionKey);
      await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
        WHERE table_id = ${table.id().toString()} AND candidate_key = ${old.definitionKey}`.execute(
        meta
      );
      await sql`UPDATE table_query_remediation_task SET status = 'running', attempts = 1,
        locked_by = 'departed-reclaim', locked_at = now() - interval '2 minutes'
        WHERE table_id = ${table.id().toString()} AND payload->>'trigger' = 'reclaim'`.execute(
        meta
      );
      const repository = test.container.resolve<TableQueryRemediationTaskRepository>(
        v2TableOpsTokens.taskRepository
      );
      const departedId = (
        await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${table.id().toString()} AND payload->>'trigger' = 'reclaim'`.execute(meta)
      ).rows[0].id;
      const departed = expectOk(await repository.findById(context, departedId));
      await executor.drop(table.id().toString(), old.definitionKey);
      expect(
        (
          await sql<{
            present: boolean;
          }>`SELECT to_regclass(${`${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(old.residual!.indexName)}`}) IS NOT NULL AS present`.execute(
            db
          )
        ).rows[0].present
      ).toBe(false);
      expect((await load(table)).searchIndex()).toEqual(serving.searchIndex());
      expect(
        await observe(serving, {
          search: { search: RecordSearch.fromTuple(['123.46', '', true]) },
          searchAccessPath: resolveTableSearchAccessPath(serving),
        })
      ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
      // Metadata cleanup committed, but the old worker died before its success receipt.
      const resumed = expectOk(
        await repository.claimNextAccepted(context, {
          scope: 'search_maintenance',
          workerId: 'residual-restart',
          now: new Date(),
          allowedKinds: ['drop_search_access_path'],
          allowManualIndexExecution: false,
          allowPolicyIndexExecution: false,
        })
      );
      expect(resumed).toBeDefined();
      const completed = expectOk(
        await commands.execute<RunTableQueryRemediationTaskCommand, TableQueryRemediationTask>(
          context,
          new RunTableQueryRemediationTaskCommand(resumed!.snapshot().id, false, 'residual-restart')
        )
      );
      expect(completed.snapshot()).toMatchObject({ status: 'succeeded', attempts: 1 });
      expect(
        (
          await repository.save(context, expectOk(departed.succeed({ obsolete: true }, new Date())))
        ).isErr()
      ).toBe(true);
      await sql`DELETE FROM table_query_remediation_task WHERE table_id = ${table.id().toString()}`.execute(
        meta
      );
    }, 120_000);

    it.for(['residual-only', 'hybrid'] as const)(
      'retires canonical and unjournaled %s rebuilds after successor maintenance without touching current objects',
      { timeout: 120_000 },
      async (kind) => {
        const native = await fixture();
        const meta = test.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
        let table = native.table;
        const tableId = table.id().toString();
        const fieldIds = [
          ...(kind === 'hybrid' ? [native.field('Title').id().toString()] : []),
          native.field('Code').id().toString(),
          native.field('Rounded').id().toString(),
        ];
        const reconcile = async (mode: 'create' | 'rebuild') => {
          expectOk(
            await reconciler.reconcile(context, {
              table,
              mode,
              provider: 'pg_trgm',
              fieldIds,
              validationMode: 'real_ddl',
              requirePlanImprovement: false,
              allowLargeTableRewrite: true,
            })
          );
          table = await load(table);
          return table.searchIndex()!;
        };
        const canonical = await reconcile('create');
        const firstShadow = await reconcile('rebuild');
        const firstIndex = firstShadow.document?.indexName ?? firstShadow.residual!.indexName;
        const shadow = await reconcile('rebuild');
        const canonicalIndex = canonical.document?.indexName ?? canonical.residual!.indexName;
        const shadowIndex = shadow.document?.indexName ?? shadow.residual!.indexName;
        const suffix = shadowIndex.slice(-13);
        expect(suffix).toMatch(/^_[a-f0-9]{12}$/);
        expect(shadowIndex).toBe(`${firstIndex.slice(0, 50)}${suffix}`);
        if (kind === 'hybrid') {
          expect(shadow.document!.generatedColumnName).toBe(
            `${firstShadow.document!.generatedColumnName.slice(0, 50)}${suffix}`
          );
          expect(shadow.residual!.indexName).not.toBe(canonical.residual!.indexName);
        } else {
          expect(shadow.document).toBeUndefined();
        }
        expect(
          (
            await sql<{ count: number }>`SELECT count(*)::int AS count
              FROM table_query_remediation_task WHERE table_id = ${tableId}
                AND execution_state->>'kind' = 'search_generation'`.execute(meta)
          ).rows[0].count
        ).toBe(0);

        // Change only formatting: the old indexes remain physically intact while
        // schema maintenance builds a different logical definition.
        await sql`UPDATE field
          SET options = ${JSON.stringify({ formatting: { type: 'decimal', precision: 1 } })}
          WHERE id = ${native.field('Rounded').id().toString()}`.execute(meta);
        await sql`UPDATE table_meta SET version = version + 1 WHERE id = ${tableId}`.execute(meta);
        expectOk(await publisher.refresh(context, tableId));
        table = await load(table);
        expectOk(await reconciler.maintainAfterSchemaChange(context, table));
        table = await load(table);
        const current = table.searchIndex()!;
        expect(current.definitionKey).not.toBe(shadow.definitionKey);
        const retired = (
          await sql<{
            candidate_key: string;
            index_name: string;
            reclaim_drop_after: Date;
          }>`SELECT candidate_key, index_name, reclaim_drop_after
            FROM table_query_search_vector_config WHERE table_id = ${tableId} AND status = 'disabled'
            ORDER BY candidate_key`.execute(meta)
        ).rows;
        expect(retired).toHaveLength(3);
        expect(retired.map((row) => row.index_name).sort()).toEqual(
          [canonicalIndex, firstIndex, shadowIndex].sort()
        );
        const executor = new PostgresTableSearchVectorExecutor(meta, db);
        const presence = async (snapshot: typeof shadow) =>
          (
            await sql<{
              column_present: boolean;
              document_present: boolean;
              residual_present: boolean;
            }>`SELECT
              EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(${native.relation})
                AND attname = ${snapshot.document?.generatedColumnName ?? null} AND NOT attisdropped) AS column_present,
              to_regclass(${snapshot.document ? `${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(snapshot.document.indexName)}` : null}) IS NOT NULL AS document_present,
              to_regclass(${`${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(snapshot.residual!.indexName)}`}) IS NOT NULL AS residual_present`.execute(
              db
            )
          ).rows[0];
        const present = {
          column_present: kind === 'hybrid',
          document_present: kind === 'hybrid',
          residual_present: true,
        };
        for (const row of retired) {
          expect(row.reclaim_drop_after.getTime()).toBeGreaterThan(Date.now());
          expect((await executor.drop(tableId, row.candidate_key)).hadManagedObjects).toBe(false);
        }
        expect(await presence(canonical)).toEqual(present);
        expect(await presence(firstShadow)).toEqual(present);
        expect(await presence(shadow)).toEqual(present);
        await sql`UPDATE table_query_search_vector_config SET reclaim_drop_after = now() - interval '1 second'
          WHERE table_id = ${tableId} AND status = 'disabled'`.execute(meta);

        // Catalog-compatible objects with only a managed prefix are insufficient
        // provenance, even when the retained config and snapshot name them.
        const shadowConfig = retired.find((row) => row.index_name === shadowIndex)!;
        const forgedIndex = `${shadowIndex.slice(0, 46)}_unproven`;
        const forgedSnapshot = {
          ...shadow,
          ...(shadow.document
            ? { document: { ...shadow.document, indexName: forgedIndex } }
            : { residual: { ...shadow.residual!, indexName: forgedIndex } }),
        };
        await sql
          .raw(
            `ALTER INDEX ${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(shadowIndex)} RENAME TO ${quoteIdentifier(forgedIndex)}`
          )
          .execute(db);
        await sql`UPDATE table_query_search_vector_config
          SET index_name = ${forgedIndex}, serving_snapshot = ${JSON.stringify(forgedSnapshot)}::jsonb
          WHERE table_id = ${tableId} AND candidate_key = ${shadowConfig.candidate_key}`.execute(
          meta
        );
        await expect(executor.drop(tableId, shadowConfig.candidate_key)).rejects.toThrow(
          'artifact ownership or definition cannot be proven'
        );
        expect(await presence(forgedSnapshot)).toEqual(present);
        await sql
          .raw(
            `ALTER INDEX ${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(forgedIndex)} RENAME TO ${quoteIdentifier(shadowIndex)}`
          )
          .execute(db);
        await sql`UPDATE table_query_search_vector_config
          SET index_name = ${shadowIndex}, serving_snapshot = ${JSON.stringify(shadow)}::jsonb
          WHERE table_id = ${tableId} AND candidate_key = ${shadowConfig.candidate_key}`.execute(
          meta
        );

        await sql`UPDATE table_meta SET search_index = ${JSON.stringify(shadow)}::jsonb
          WHERE id = ${tableId}`.execute(meta);
        await expect(executor.drop(tableId, shadowConfig.candidate_key)).rejects.toThrow(
          'referenced'
        );
        expect(await presence(shadow)).toEqual(present);
        await sql`UPDATE table_meta SET search_index = ${JSON.stringify(current)}::jsonb
          WHERE id = ${tableId}`.execute(meta);

        for (const row of retired)
          expect((await executor.drop(tableId, row.candidate_key)).hadManagedObjects).toBe(true);
        const absent = { column_present: false, document_present: false, residual_present: false };
        expect(await presence(canonical)).toEqual(absent);
        expect(await presence(firstShadow)).toEqual(absent);
        expect(await presence(shadow)).toEqual(absent);
        expect(await presence(current)).toEqual(present);
        expect((await load(table)).searchIndex()).toEqual(current);
        expect(
          await observe(table, {
            search: { search: RecordSearch.fromTuple(['123.5', '', true]) },
            searchAccessPath: resolveTableSearchAccessPath(table),
          })
        ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
        expect(
          (
            await sql<{ count: number }>`SELECT count(*)::int AS count
              FROM table_query_search_vector_config WHERE table_id = ${tableId} AND status = 'disabled'
                AND serving_snapshot IS NULL AND reclaim_drop_after IS NULL
                AND last_inspection->'staleReasons' @> '["reclaimed_after_grace"]'::jsonb`.execute(
              meta
            )
          ).rows[0].count
        ).toBe(3);
      }
    );

    it('repairs residual rename and deletion through schema commands and queued maintenance', async () => {
      const native = await fixture();
      let table = native.table;
      expectOk(
        await reconciler.reconcile(context, {
          table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const tasks = test.container.resolve<TableQueryRemediationTaskRepository>(
        v2TableOpsTokens.taskRepository
      );
      const meta = test.metaDb as unknown as Kysely<UnknownPostgresDatabase>;
      const repair = async () => {
        const pending = await sql<{ id: string }>`SELECT id FROM table_query_remediation_task
        WHERE table_id = ${table.id().toString()} AND status = 'queued'
          AND payload ->> 'trigger' = 'schema_change'`.execute(meta);
        expect(pending.rows).toHaveLength(1);
        const taskId = pending.rows[0]!.id;
        expect(expectOk(await tasks.findById(context, taskId)).snapshot().kind).toBe(
          'rebuild_search_access_path'
        );
        const result = expectOk(
          await commands.execute<RunTableQueryRemediationTaskCommand, TableQueryRemediationTask>(
            context,
            new RunTableQueryRemediationTaskCommand(taskId, false, 'native-residual-schema-worker')
          )
        );
        expect(result.snapshot().status).toBe('succeeded');
        table = await load(table);
        expect(resolveTableSearchAccessPath(table)).toMatchObject({
          document: { ready: true },
          residual: { ready: true },
        });
      };
      const code = native.field('Code');
      expectOk(
        await commands.execute<UpdateFieldCommand, UpdateFieldResult>(
          context,
          expectOk(
            UpdateFieldCommand.create({
              tableId: table.id().toString(),
              fieldId: code.id().toString(),
              field: { name: 'Renamed Code', dbFieldName: 'command_renamed_residual' },
            })
          )
        )
      );
      table = await load(table);
      expect(resolveTableSearchAccessPath(table)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      const search = { search: RecordSearch.fromTuple(['residualunique', '', true]) };
      expect(
        await observe(table, { search, searchAccessPath: resolveTableSearchAccessPath(table) })
      ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
      await repair();
      expect(
        table
          .searchIndex()!
          .residual!.fields.find((field) => field.fieldId === code.id().toString())?.fieldDbName
      ).toBe('command_renamed_residual');
      expect(
        await observe(table, { search, searchAccessPath: resolveTableSearchAccessPath(table) })
      ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
      expectOk(
        await commands.execute<DeleteFieldCommand, DeleteFieldResult>(
          context,
          expectOk(
            DeleteFieldCommand.create({
              baseId: table.baseId().toString(),
              tableId: table.id().toString(),
              fieldId: code.id().toString(),
            })
          )
        )
      );
      table = await load(table);
      expect(resolveTableSearchAccessPath(table)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      await repair();
      expect(
        table
          .searchIndex()!
          .residual!.fields.some((field) => field.fieldId === code.id().toString())
      ).toBe(false);
      expect(
        await observe(table, { search, searchAccessPath: resolveTableSearchAccessPath(table) })
      ).toMatchObject({ ids: [], count: 0, cells: 0 });
      expect(
        await observe(table, {
          search: { search: RecordSearch.fromTuple(['rarelist', '', true]) },
          searchAccessPath: resolveTableSearchAccessPath(table),
        })
      ).toMatchObject({ ids: ['residual_row_a'], count: 1, cells: 1 });
      expectOk(await reconciler.reconcile(context, { table, mode: 'drop' }));
    }, 120_000);

    it.for(['pg_trgm', 'pg_bigm'] as const)(
      'uses the versioned numeric-list helper in a real %s residual GIN and repository query',
      { timeout: 120_000 },
      async (provider, testContext) => {
        if (
          !(await readSubstringSearchCapabilities(db)).providers.some(
            (capability) => capability.provider === provider && capability.usable
          )
        ) {
          testContext.skip();
          return;
        }
        const native = await fixture();
        const source = expectOk(
          await commands.execute<CreateTableCommand, CreateTableResult>(
            context,
            expectOk(
              CreateTableCommand.create({
                baseId: test.baseId.toString(),
                name: 'Numeric lookup source',
                fields: [
                  { name: 'Name', type: 'singleLineText', isPrimary: true },
                  {
                    name: 'Amount',
                    type: 'number',
                    options: { formatting: { type: 'decimal', precision: 2 } },
                  },
                ],
              })
            )
          )
        ).table;
        const linked = expectOk(
          await commands.execute<CreateFieldCommand, CreateFieldResult>(
            context,
            expectOk(
              CreateFieldCommand.create({
                baseId: test.baseId.toString(),
                tableId: native.table.id().toString(),
                field: {
                  name: 'Source',
                  type: 'link',
                  options: {
                    relationship: 'manyMany',
                    foreignTableId: source.id().toString(),
                    isOneWay: true,
                  },
                },
              })
            )
          )
        ).table;
        const link = linked.getFields().find((field) => field.name().toString() === 'Source')!;
        const table = expectOk(
          await commands.execute<CreateFieldCommand, CreateFieldResult>(
            context,
            expectOk(
              CreateFieldCommand.create({
                baseId: test.baseId.toString(),
                tableId: native.table.id().toString(),
                field: {
                  name: 'Amounts',
                  type: 'lookup',
                  options: {
                    linkFieldId: link.id().toString(),
                    foreignTableId: source.id().toString(),
                    lookupFieldId: source
                      .getFields()
                      .find((field) => field.name().toString() === 'Amount')!
                      .id()
                      .toString(),
                  },
                },
              })
            )
          )
        ).table;
        const amount = table.getFields().find((field) => field.name().toString() === 'Amounts')!;
        const amountColumn = quoteIdentifier(expectOk(expectOk(amount.dbFieldName()).value()));
        await sql
          .raw(`ALTER TABLE ${native.relation} DROP COLUMN ${amountColumn},
      ADD COLUMN seed_list jsonb, ADD COLUMN ${amountColumn} jsonb GENERATED ALWAYS AS (seed_list) STORED`)
          .execute(db);
        await sql
          .raw(`UPDATE ${native.relation} SET seed_list = CASE __id
      WHEN 'residual_row_a' THEN '[1.234, null, -2.345]'::jsonb
      WHEN 'residual_row_b' THEN '42.556'::jsonb
      WHEN 'residual_row_c' THEN null ELSE '[0]'::jsonb END`)
          .execute(db);
        await sql.raw(`ANALYZE ${native.relation}`).execute(db);
        const probes = ['1.23', '-2.35', '1.23, -2.35', '42.56', '0', '%', '_', 'not-present'];
        const baseline = new Map<string, ObservedSearch>();
        for (const probe of probes)
          baseline.set(
            probe,
            await observe(table, {
              search: { search: RecordSearch.fromTuple([probe, amount.id().toString(), true]) },
            })
          );
        expectOk(
          await reconciler.reconcile(context, {
            table,
            mode: 'create',
            provider,
            validationMode: 'real_ddl',
            requirePlanImprovement: false,
            allowLargeTableRewrite: true,
          })
        );
        const serving = await load(table);
        expect(serving.searchIndex()!.residual!.expression).toContain(
          'teable_search_rounded_number_list_v1'
        );
        for (const probe of probes) {
          const actual = await observe(serving, {
            search: { search: RecordSearch.fromTuple([probe, amount.id().toString(), true]) },
            searchAccessPath: resolveTableSearchAccessPath(serving),
          });
          const expected = baseline.get(probe)!;
          expect(actual.ids).toEqual(expected.ids);
          expect(actual.cells).toBe(expected.cells);
          expect(actual.count).toBe(expected.count);
          if (probe === '1.23') {
            const plan = await db.executeQuery(
              CompiledQuery.raw(`EXPLAIN (FORMAT JSON) ${actual.countStatement.sql}`, [
                ...actual.countStatement.parameters,
              ])
            );
            expect(JSON.stringify(plan.rows)).toContain(serving.searchIndex()!.residual!.indexName);
          }
        }
        expectOk(await reconciler.reconcile(context, { table: serving, mode: 'drop' }));
      }
    );

    it('preserves an incompatible same-name residual index during invalid-index recovery', async () => {
      const native = await fixture();
      expectOk(
        await reconciler.reconcile(context, {
          table: native.table,
          mode: 'create',
          provider: 'pg_trgm',
          validationMode: 'real_ddl',
          requirePlanImprovement: false,
          allowLargeTableRewrite: true,
        })
      );
      const table = await load(native.table);
      const residual = table.searchIndex()!.residual!;
      const qualified = `${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(residual.indexName)}`;
      await sql.raw(`DROP INDEX ${qualified}`).execute(db);
      await sql
        .raw(
          `CREATE INDEX ${quoteIdentifier(residual.indexName)} ON ${native.relation} USING GIN ((lower(${native.column('Title')}::text)) gin_trgm_ops)`
        )
        .execute(db);
      await sql`UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass(${qualified})`.execute(
        db
      );
      const before = await sql<{
        oid: string;
      }>`SELECT to_regclass(${qualified})::oid::text AS oid`.execute(db);
      const provider = (await readSubstringSearchCapabilities(db)).providers.find(
        (provider) => provider.provider === 'pg_trgm'
      )!;
      await expect(
        createResidualSearchIndex(
          db,
          native.physical,
          residual.indexName,
          residual.fields,
          provider
        )
      ).rejects.toThrow('incompatible physical object');
      const after = await sql<{
        oid: string;
      }>`SELECT to_regclass(${qualified})::oid::text AS oid`.execute(db);
      expect(after.rows).toEqual(before.rows);
      expectOk(await publisher.refresh(context, table.id().toString()));
      const degraded = await load(table);
      expect(resolveTableSearchAccessPath(degraded)).toMatchObject({
        document: { ready: true },
        residual: { ready: false },
      });
      expect(
        (
          await observe(degraded, {
            search: { search: RecordSearch.fromTuple(['residualunique', '', true]) },
            searchAccessPath: resolveTableSearchAccessPath(degraded),
          })
        ).ids
      ).toEqual(['residual_row_a']);
      expectOk(await reconciler.reconcile(context, { table: degraded, mode: 'drop' }));
    }, 120_000);

    it('inspects canonical residual expressions read-only without rewriting quoted identifiers', async () => {
      const native = await fixture();
      const column = `quoted.${native.physical.tableName.slice(0, 16)}."Code\\literal`;
      await sql
        .raw(
          `ALTER TABLE ${native.relation} RENAME COLUMN ${native.column('Code')} TO ${quoteIdentifier(column)}`
        )
        .execute(db);
      const fields = [{ fieldDbName: column, textProjection: { kind: 'plain' as const } }];
      const provider = (await readSubstringSearchCapabilities(db)).providers.find(
        (item) => item.provider === 'pg_trgm'
      )!;
      const indexName = `idx_residual_quoted_${native.table.id().toString()}`;
      await createResidualSearchIndex(db, native.physical, indexName, fields, provider);
      const qualified = `${quoteIdentifier(native.physical.schema)}.${quoteIdentifier(indexName)}`;
      const before = (
        await sql<{ oid: string }>`SELECT to_regclass(${qualified})::oid::text AS oid`.execute(db)
      ).rows;
      const statementStart = captured.length;
      expect(
        await inspectResidualSearchIndex(db, native.physical, indexName, fields, provider)
      ).toEqual({
        present: true,
        owned: true,
        ready: true,
        oid: before[0].oid,
        foreignDependents: false,
      });
      expect(
        captured.slice(statementStart).every((query) => /^\s*(?:SELECT|EXPLAIN)\b/i.test(query.sql))
      ).toBe(true);
      expect(
        await inspectResidualSearchIndex(
          db,
          native.physical,
          indexName,
          [
            {
              fieldDbName: native
                .field('Title')
                .dbFieldName()
                ._unsafeUnwrap()
                .value()
                ._unsafeUnwrap(),
              textProjection: { kind: 'plain' },
            },
          ],
          provider
        )
      ).toEqual({
        present: true,
        owned: false,
        ready: false,
        oid: before[0].oid,
        foreignDependents: false,
      });
      const after = (
        await sql<{ oid: string }>`SELECT to_regclass(${qualified})::oid::text AS oid`.execute(db)
      ).rows;
      expect(after).toEqual(before);
      await sql.raw(`DROP INDEX ${qualified}`).execute(db);
    }, 120_000);
  }
);
