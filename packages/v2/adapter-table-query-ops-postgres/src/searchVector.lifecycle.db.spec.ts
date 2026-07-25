/* eslint-disable @typescript-eslint/naming-convention */
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  ActorId,
  CreateFieldCommand,
  CreateRecordCommand,
  CreateRecordsCommand,
  CreateTableCommand,
  DeleteFieldCommand,
  FieldId,
  RecordSearch,
  TableByIdSpec,
  TableId,
  UpdateFieldCommand,
  v2CoreTokens,
  type CreateFieldResult,
  type CreateRecordResult,
  type CreateRecordsResult,
  type CreateTableResult,
  type DeleteFieldResult,
  type ICommandBus,
  type IExecutionContext,
  type ITableRecordQueryRepository,
  type ITableRepository,
  type Table,
  type UpdateFieldResult,
} from '@teable/v2-core';
import {
  registerV2TableOps,
  RunTableQueryRemediationTaskCommand,
  v2TableOpsTokens,
  type TableQueryRemediationTask,
  type TableQueryRemediationTaskRepository,
  type TableSearchVectorReconciler,
  type TableSearchVectorSchemaMaintenanceScheduler,
  type TableSearchVectorStatusReader,
} from '@teable/v2-table-query-ops';
import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getTablePhysicalName, quoteIdentifier } from './helpers';
import { registerV2TableOpsPostgresAdapter } from './register';
import type { TableQueryOpsDatabase } from './schema';
import type { UnknownPostgresDatabase } from './types';

type SearchVectorConfig = {
  candidate_key: string;
  generated_column_name: string;
  index_name: string;
  field_ids: unknown;
  search_scope: string;
  field_db_names: unknown;
  status: string;
};

type SearchVectorPhysicalState = {
  expression: string;
  generated: string;
  index_valid: boolean;
};

const context: IExecutionContext = {
  actorId: ActorId.create('system')._unsafeUnwrap(),
  requestId: 'search-vector-schema-lifecycle-e2e',
};

const asStringArray = (value: unknown): string[] => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
};

describe('generated tsvector schema lifecycle (db)', () => {
  let testContainer: IV2NodeTestContainer;
  let commandBus: ICommandBus;
  let tableRepository: ITableRepository;
  let recordQueryRepository: ITableRecordQueryRepository;
  let taskRepository: TableQueryRemediationTaskRepository;
  let reconciler: TableSearchVectorReconciler;
  let maintenanceScheduler: TableSearchVectorSchemaMaintenanceScheduler;
  let statusReader: TableSearchVectorStatusReader;
  let db: Kysely<UnknownPostgresDatabase>;

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
    registerV2TableOps(testContainer.container);
    await registerV2TableOpsPostgresAdapter(testContainer.container, { ensureSchema: true });

    commandBus = testContainer.container.resolve<ICommandBus>(v2CoreTokens.commandBus);
    tableRepository = testContainer.container.resolve<ITableRepository>(
      v2CoreTokens.tableRepository
    );
    recordQueryRepository = testContainer.container.resolve<ITableRecordQueryRepository>(
      v2CoreTokens.tableRecordQueryRepository
    );
    reconciler = testContainer.container.resolve<TableSearchVectorReconciler>(
      v2TableOpsTokens.searchVectorReconciler
    );
    taskRepository = testContainer.container.resolve<TableQueryRemediationTaskRepository>(
      v2TableOpsTokens.taskRepository
    );
    maintenanceScheduler =
      testContainer.container.resolve<TableSearchVectorSchemaMaintenanceScheduler>(
        v2TableOpsTokens.searchVectorSchemaMaintenanceScheduler
      );
    statusReader = testContainer.container.resolve<TableSearchVectorStatusReader>(
      v2TableOpsTokens.searchVectorStatusReader
    );
    db = testContainer.dataDb as unknown as Kysely<UnknownPostgresDatabase>;
  }, 120_000);

  afterAll(async () => {
    await testContainer?.dispose();
  });

  it('keeps generated search effective while searchable fields are added, converted, and deleted', async () => {
    const created = await createTable();
    let table = created.table;
    const titleField = fieldByName(table, 'Title');
    const scoreField = fieldByName(table, 'Score');

    await createSemanticRecords(table, titleField.id().toString(), scoreField.id().toString());
    await insertPlannerFiller(table, titleField, scoreField, 4_000);

    const initial = await reconciler.reconcile(context, {
      table,
      mode: 'create',
      languageConfig: 'simple',
      searchProbe: 'lifecycleunique',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(initial._unsafeUnwrap()).toMatchObject({ action: 'created', status: 'ready' });
    expect((await statusReader.read(context, table.id().toString()))._unsafeUnwrap()).toMatchObject(
      {
        state: 'ready',
        configured: true,
        languageConfig: 'simple',
        coveredFieldCount: 2,
      }
    );

    let config = await expectReadyConfig(table);
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);

    const scheduleSpy = vi.spyOn(maintenanceScheduler, 'schedule');
    const regionFieldId = FieldId.mustGenerate().toString();
    const addRegion = CreateFieldCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      field: { id: regionFieldId, type: 'singleLineText', name: 'Region' },
    })._unsafeUnwrap();
    const addRegionResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      addRegion
    );
    table = addRegionResult._unsafeUnwrap().table;
    const createRegionRecord = await commandBus.execute<CreateRecordCommand, CreateRecordResult>(
      context,
      CreateRecordCommand.create({
        tableId: table.id().toString(),
        fields: {
          [titleField.id().toString()]: 'Regional order',
          [scoreField.id().toString()]: '88',
          [regionFieldId]: 'SingaporeWest',
        },
      })._unsafeUnwrap()
    );
    createRegionRecord._unsafeUnwrap();

    const addCheckboxResult = await commandBus.execute<CreateFieldCommand, CreateFieldResult>(
      context,
      CreateFieldCommand.create({
        baseId: table.baseId().toString(),
        tableId: table.id().toString(),
        field: { type: 'checkbox', name: 'Reviewed' },
      })._unsafeUnwrap()
    );
    table = addCheckboxResult._unsafeUnwrap().table;

    expect(scheduleSpy).toHaveBeenCalledTimes(2);
    const firstScheduleResult = await scheduleSpy.mock.results.at(0)?.value;
    expect(
      firstScheduleResult?.isOk(),
      firstScheduleResult?.isErr()
        ? JSON.stringify(firstScheduleResult.error)
        : 'schedule result missing'
    ).toBe(true);
    expect(firstScheduleResult?._unsafeUnwrap()).toMatchObject({ status: 'queued' });
    const coalescedScheduleResult = await scheduleSpy.mock.results.at(1)?.value;
    expect(coalescedScheduleResult?._unsafeUnwrap()).toMatchObject({ status: 'coalesced' });
    expect((await statusReader.read(context, table.id().toString()))._unsafeUnwrap()).toMatchObject(
      {
        state: 'rebuild_pending',
        configured: true,
      }
    );
    await expectPendingConfig(table);
    expect(await searchTotalWithDefaultPath(table, 'SingaporeWest')).toBe(1);
    await runPendingMaintenance();

    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).toContain(regionFieldId);
    expect(await searchTotal(table, config, 'SingaporeWest')).toBe(1);

    const convertScore = UpdateFieldCommand.create({
      tableId: table.id().toString(),
      fieldId: scoreField.id().toString(),
      field: { type: 'number' },
    })._unsafeUnwrap();
    const convertResult = await commandBus.execute<UpdateFieldCommand, UpdateFieldResult>(
      context,
      convertScore
    );
    table = convertResult._unsafeUnwrap().table;

    await expectPendingConfig(table);
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
    await runPendingMaintenance();

    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).not.toContain(scoreField.id().toString());
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);

    const deleteRegion = DeleteFieldCommand.create({
      baseId: table.baseId().toString(),
      tableId: table.id().toString(),
      fieldId: regionFieldId,
    })._unsafeUnwrap();
    const deleteResult = await commandBus.execute<DeleteFieldCommand, DeleteFieldResult>(
      context,
      deleteRegion
    );
    deleteResult._unsafeUnwrap();
    table = await loadTable(table.id().toString());

    await expectPendingConfig(table);
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
    await runPendingMaintenance();

    config = await expectReadyConfig(table);
    expect(asStringArray(config.field_ids)).not.toContain(regionFieldId);
    expect(await searchTotal(table, config, 'SingaporeWest')).toBe(0);
    expect(await searchTotal(table, config, 'lifecycleunique')).toBe(1);
  }, 120_000);
  it('falls back safely and removes new objects when real-DDL rebuild validation fails', async () => {
    const created = await createTable();
    const table = created.table;
    const titleField = fieldByName(table, 'Title');
    const scoreField = fieldByName(table, 'Score');
    await createSemanticRecords(table, titleField.id().toString(), scoreField.id().toString());
    await insertPlannerFiller(table, titleField, scoreField, 4_000);

    const initial = await reconciler.reconcile(context, {
      table,
      mode: 'create',
      languageConfig: 'simple',
      searchProbe: 'lifecycleunique',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(initial.isOk()).toBe(true);
    const config = await expectReadyConfig(table);

    const failedRebuild = await reconciler.reconcile(context, {
      table,
      mode: 'rebuild',
      languageConfig: 'simple',
      searchProbe: 'ordinary',
      validationMode: 'real_ddl',
      allowLargeTableRewrite: true,
    });
    expect(failedRebuild.isErr()).toBe(true);

    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const objectState = await sql<{ column_exists: boolean; index_exists: boolean }>`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_attribute a
          JOIN pg_class c ON c.oid = a.attrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = ${physical.schema}
            AND c.relname = ${physical.tableName}
            AND a.attname = ${config.generated_column_name}
            AND NOT a.attisdropped
        ) AS column_exists,
        to_regclass(${`${physical.schema}.${config.index_name}`}) IS NOT NULL AS index_exists
    `.execute(db);
    expect(objectState.rows[0]).toEqual({ column_exists: false, index_exists: false });

    const latestConfig = await sql<{ status: string }>`
      SELECT status
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(latestConfig.rows[0]?.status).toBe('rebuild_pending');
    expect(await searchTotalWithDefaultPath(table, 'lifecycleunique')).toBe(1);
  }, 120_000);

  const createTable = async (): Promise<CreateTableResult> => {
    const result = await commandBus.execute<CreateTableCommand, CreateTableResult>(
      context,
      CreateTableCommand.create({
        baseId: testContainer.baseId.toString(),
        name: 'Search Vector Lifecycle',
        fields: [
          { type: 'singleLineText', name: 'Title', isPrimary: true },
          { type: 'singleLineText', name: 'Score' },
        ],
        views: [{ type: 'grid' }],
      })._unsafeUnwrap()
    );
    return result._unsafeUnwrap();
  };

  const createSemanticRecords = async (
    table: Table,
    titleFieldId: string,
    scoreFieldId: string
  ) => {
    const result = await commandBus.execute<CreateRecordsCommand, CreateRecordsResult>(
      context,
      CreateRecordsCommand.create({
        tableId: table.id().toString(),
        records: [
          { fields: { [titleFieldId]: 'lifecycleunique order', [scoreFieldId]: '42' } },
          { fields: { [titleFieldId]: 'ordinary order alpha', [scoreFieldId]: '7' } },
          { fields: { [titleFieldId]: 'ordinary order beta', [scoreFieldId]: '9' } },
        ],
      })._unsafeUnwrap()
    );
    expect(result._unsafeUnwrap().records).toHaveLength(3);
  };

  const insertPlannerFiller = async (
    table: Table,
    titleField: ReturnType<typeof fieldByName>,
    scoreField: ReturnType<typeof fieldByName>,
    count: number
  ) => {
    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const tableSql = `${quoteIdentifier(physical.schema)}.${quoteIdentifier(physical.tableName)}`;
    const titleDbName = titleField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    const scoreDbName = scoreField.dbFieldName()._unsafeUnwrap().value()._unsafeUnwrap();
    await sql
      .raw(
        `INSERT INTO ${tableSql} ("__id", "__created_by", "__version", ${quoteIdentifier(
          titleDbName
        )}, ${quoteIdentifier(
          scoreDbName
        )}) SELECT 'rec_tqops_fill_' || g::text, 'system', 1, 'ordinary order ' || g::text, (g % 100)::text FROM generate_series(1, ${count}) AS g`
      )
      .execute(db);
    await sql.raw(`ANALYZE ${tableSql}`).execute(db);
  };

  const expectReadyConfig = async (table: Table): Promise<SearchVectorConfig> => {
    const configs = await sql<SearchVectorConfig>`
      SELECT candidate_key, generated_column_name, index_name, field_ids, field_db_names, search_scope, status
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    const ready = configs.rows.filter((row) => row.status === 'ready');
    expect(ready).toHaveLength(1);
    const config = ready[0] as SearchVectorConfig;

    const physical = getTablePhysicalName(table)._unsafeUnwrap();
    const state = await sql<SearchVectorPhysicalState>`
      SELECT
        pg_get_expr(ad.adbin, ad.adrelid) AS expression,
        a.attgenerated AS generated,
        i.indisvalid AS index_valid
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      JOIN pg_index i ON i.indrelid = c.oid
      JOIN pg_class idx ON idx.oid = i.indexrelid AND idx.relname = ${config.index_name}
      WHERE n.nspname = ${physical.schema}
        AND c.relname = ${physical.tableName}
        AND a.attname = ${config.generated_column_name}
    `.execute(db);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ generated: 's', index_valid: true });
    for (const fieldDbName of asStringArray(config.field_db_names)) {
      expect(state.rows[0]?.expression).toContain(fieldDbName);
    }
    return config;
  };

  const expectPendingConfig = async (table: Table): Promise<void> => {
    const configs = await sql<Pick<SearchVectorConfig, 'status'>>`
      SELECT status
      FROM table_query_search_vector_config
      WHERE table_id = ${table.id().toString()}
      ORDER BY last_modified_time DESC NULLS LAST, created_time DESC
      LIMIT 1
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(configs.rows[0]?.status).toBe('rebuild_pending');

    const tasks = await sql<{ count: string }>`
      SELECT count(*)::text AS count
      FROM table_query_remediation_task
      WHERE table_id = ${table.id().toString()}
        AND kind = 'rebuild_search_vector'
        AND status = 'queued'
    `.execute(testContainer.metaDb as unknown as Kysely<TableQueryOpsDatabase>);
    expect(Number(tasks.rows[0]?.count)).toBe(1);
  };

  const runPendingMaintenance = async (): Promise<void> => {
    const claimed = await taskRepository.claimNextAccepted(context, {
      workerId: 'search-vector-lifecycle-e2e-worker',
      now: new Date(),
      allowedKinds: ['rebuild_search_vector'],
    });
    const task = claimed._unsafeUnwrap();
    expect(task).toBeDefined();
    const result = await commandBus.execute<
      RunTableQueryRemediationTaskCommand,
      TableQueryRemediationTask
    >(
      context,
      new RunTableQueryRemediationTaskCommand(
        task!.snapshot().id,
        false,
        'search-vector-lifecycle-e2e-worker'
      )
    );
    expect(result._unsafeUnwrap().snapshot().status).toBe('succeeded');
  };

  const searchTotal = async (table: Table, config: SearchVectorConfig, value: string) => {
    const coveredFieldIds = asStringArray(config.field_ids).map((id) =>
      FieldId.create(id)._unsafeUnwrap()
    );
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, '', true]) },
      searchAccessPath: {
        kind: 'generated_tsvector',
        generatedColumnName: config.generated_column_name,
        languageConfig: 'simple',
        searchScope: config.search_scope === 'selected_fields' ? 'selected_fields' : 'all_fields',
        coveredFieldIds,
      },
    });
    return result._unsafeUnwrap().total;
  };

  const searchTotalWithDefaultPath = async (table: Table, value: string) => {
    const result = await recordQueryRepository.find(context, table, undefined, {
      search: { search: RecordSearch.fromTuple([value, '', true]) },
    });
    return result._unsafeUnwrap().total;
  };

  const loadTable = async (tableId: string) => {
    const id = TableByIdSpec.create(TableId.create(tableId)._unsafeUnwrap());
    return (await tableRepository.findOne(context, id))._unsafeUnwrap();
  };
});

const fieldByName = (table: Table, name: string) =>
  table.getField((field) => field.name().toString() === name)._unsafeUnwrap();
