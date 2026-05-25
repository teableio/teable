/* eslint-disable sonarjs/no-duplicate-string */
import fs from 'fs';
import path from 'path';
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, SortFunc, StatisticsFunc } from '@teable/core';
import {
  analyzeFile as apiAnalyzeFile,
  axios,
  ensureUndoRedoWindowIdHeader,
  exportBase,
  getAggregation,
  getFields,
  getGroupPoints,
  getImportStatus as apiGetImportStatus,
  getRecordHistory,
  getRowCount,
  getSignature as apiGetSignature,
  getTableList,
  getTableActivatedIndex,
  GroupPointType,
  importBase,
  importTableFromFile as apiImportTableFromFile,
  type INotifyVo,
  notify as apiNotify,
  redo,
  ResourceType,
  SettingKey,
  SUPPORTEDTYPE,
  TableIndex,
  toggleTableIndex,
  undo,
  updateSetting,
  updateDbTableName,
  updateRecordOrders,
  UploadType,
  uploadFile as apiUploadFile,
  X_CANARY_HEADER,
  type ITableFullVo,
} from '@teable/openapi';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';
import type { ClsStore } from 'nestjs-cls';
import { ClsService } from 'nestjs-cls';
import type { IBaseConfig } from '../src/configs/base.config';
import { baseConfig } from '../src/configs/base.config';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import StorageAdapter from '../src/features/attachments/plugins/adapter';
import {
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import { CsvImporter } from '../src/features/import/open-api/import.class';
import { createAwaitWithEventWithResult } from './utils/event-promise';
import {
  createBase,
  createField,
  createRecords,
  createSpace,
  createTable,
  deleteField,
  deleteRecord,
  deleteTable,
  getRecords,
  getTable,
  initApp,
  permanentDeleteBase,
  permanentDeleteSpace,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

const databaseIdentity = (url?: string) => {
  if (!url) {
    return undefined;
  }

  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
};

const metaDatabaseUrl =
  process.env.PRISMA_META_DATABASE_URL ??
  process.env.PRISMA_DATABASE_URL ??
  process.env.DATABASE_URL;
const byodbDataDatabaseUrl = process.env.BYODB_E2E_DATA_DATABASE_URL;
const isIndependentByodbDataDb =
  databaseIdentity(metaDatabaseUrl) != null &&
  databaseIdentity(byodbDataDatabaseUrl) != null &&
  databaseIdentity(metaDatabaseUrl) !== databaseIdentity(byodbDataDatabaseUrl);
const describeByodbStorage = isIndependentByodbDataDb ? describe : describe.skip;

const dataPlaneSystemTables = [
  '__teable_data_schema_migrations',
  'computed_update_outbox',
  'computed_update_outbox_seed',
  'computed_update_dead_letter',
  'computed_update_pause_scope',
  'record_history',
  'table_trash',
  'record_trash',
  '__undo_log',
];

const metaPlaneTables = [
  'space',
  'base',
  'base_node',
  'table_meta',
  'field',
  'view',
  'reference',
  'ops',
  'trash',
  'data_db_connection',
  'space_data_db_binding',
];

const quoteIdent = (value: string) => `"${value.replace(/"/g, '""')}"`;

const parseDbTableName = (dbTableName: string) => {
  const [schemaName, tableName] = dbTableName.split('.');

  if (!schemaName || !tableName) {
    throw new Error(`Invalid dbTableName: ${dbTableName}`);
  }

  return { schemaName, tableName };
};

const rawRows = async <T>(
  client: KnexType,
  query: string,
  bindings: unknown[] = []
): Promise<T[]> => {
  const result = await client.raw(query, bindings);
  return result.rows as T[];
};

const schemaExists = async (client: KnexType, schemaName: string) => {
  const rows = await rawRows<{ exists: boolean }>(
    client,
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.schemata
        WHERE schema_name = ?
      ) AS exists
    `,
    [schemaName]
  );

  return Boolean(rows[0]?.exists);
};

const relationExists = async (client: KnexType, schemaName: string, tableName: string) => {
  const rows = await rawRows<{ exists: boolean }>(
    client,
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = ? AND table_name = ?
      ) AS exists
    `,
    [schemaName, tableName]
  );

  return Boolean(rows[0]?.exists);
};

const tableExists = async (client: KnexType, dbTableName: string) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  return relationExists(client, schemaName, tableName);
};

const columnExists = async (client: KnexType, dbTableName: string, columnName: string) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  const rows = await rawRows<{ exists: boolean }>(
    client,
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ? AND column_name = ?
      ) AS exists
    `,
    [schemaName, tableName, columnName]
  );

  return Boolean(rows[0]?.exists);
};

const countRows = async (
  client: KnexType,
  schemaName: string,
  tableName: string,
  whereSql?: string,
  bindings: unknown[] = []
) => {
  if (!(await relationExists(client, schemaName, tableName))) {
    return 0;
  }

  const where = whereSql ? ` WHERE ${whereSql}` : '';
  const rows = await rawRows<{ count: number | string }>(
    client,
    `SELECT COUNT(*)::int AS count FROM ${quoteIdent(schemaName)}.${quoteIdent(tableName)}${where}`,
    bindings
  );

  return Number(rows[0]?.count ?? 0);
};

const countDbTableRows = async (client: KnexType, dbTableName: string) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  return countRows(client, schemaName, tableName);
};

const dataDbMigrationVersions = async (client: KnexType, schemaName: string) =>
  rawRows<{ id: string }>(
    client,
    `SELECT ${quoteIdent('id')} FROM ${quoteIdent(schemaName)}.${quoteIdent(
      '__teable_data_schema_migrations'
    )} ORDER BY ${quoteIdent('id')}`
  );

const dataDbConnectionVersionForSpace = async (client: KnexType, targetSpaceId: string) =>
  rawRows<{ schema_version: string | null }>(
    client,
    `
      SELECT c.${quoteIdent('schema_version')}
      FROM ${quoteIdent('space_data_db_binding')} b
      JOIN ${quoteIdent('data_db_connection')} c ON c.${quoteIdent('id')} = b.${quoteIdent(
        'data_db_connection_id'
      )}
      WHERE b.${quoteIdent('space_id')} = ?
    `,
    [targetSpaceId]
  );

const constraintExists = async (client: KnexType, schemaName: string, constraintName: string) => {
  const rows = await rawRows<{ exists: boolean }>(
    client,
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = ? AND c.conname = ?
      ) AS exists
    `,
    [schemaName, constraintName]
  );

  return Boolean(rows[0]?.exists);
};

const countDbTableRowsWhere = async (
  client: KnexType,
  dbTableName: string,
  whereSql: string,
  bindings: unknown[]
) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  return countRows(client, schemaName, tableName, whereSql, bindings);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const streamToBuffer = async (stream: NodeJS.ReadableStream) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

const waitForCount = async (
  getCount: () => Promise<number>,
  expectedCount: number,
  maxRetries = 60
) => {
  for (let i = 0; i < maxRetries; i++) {
    const count = await getCount();
    if (count === expectedCount) {
      return count;
    }
    await sleep(100);
  }

  return getCount();
};

const waitForAtLeast = async (
  getCount: () => Promise<number>,
  expectedMinimum: number,
  maxRetries = 60
) => {
  for (let i = 0; i < maxRetries; i++) {
    const count = await getCount();
    if (count >= expectedMinimum) {
      return count;
    }
    await sleep(100);
  }

  return getCount();
};

const waitForImportCompleted = async (tableId: string, expectedSuccessCount: number) => {
  const maxRetries = 60;

  for (let i = 0; i < maxRetries; i++) {
    const { data } = await apiGetImportStatus(tableId);

    if (data.status === 'completed' || data.status === 'failed') {
      expect(data.status).toBe('completed');
      expect(data.successCount).toBe(expectedSuccessCount);
      expect(data.failedCount ?? 0).toBe(0);
      return;
    }

    expect(data.status).not.toBe('not_found');
    await sleep(500);
  }

  const { data } = await apiGetImportStatus(tableId);
  throw new Error(`BYODB import timed out with latest status: ${data.status}`);
};

const createPgClient = (url: string) =>
  Knex({
    client: 'pg',
    connection: url,
  });

const importCsvData = `You_Xiang,Ming_Zi,order_count
ada@example.com,Ada,3
bob@example.com,Bob,5
`;

const uploadImportCsv = async () => {
  const tmpPath = path.resolve(
    path.join(StorageAdapter.TEMPORARY_DIR, `byodb-import-${Date.now().toString(36)}.csv`)
  );
  fs.writeFileSync(tmpPath, importCsvData);

  try {
    const stats = fs.statSync(tmpPath);
    const { token, requestHeaders } = (
      await apiGetSignature(
        {
          type: UploadType.Import,
          contentLength: stats.size,
          contentType: 'text/csv',
        },
        undefined
      )
    ).data;

    await apiUploadFile(token, fs.createReadStream(tmpPath), requestHeaders);
    const {
      data: { presignedUrl },
    } = await apiNotify(token, undefined, 'byodb-import.csv');

    return presignedUrl;
  } finally {
    fs.unlinkSync(tmpPath);
  }
};

const safeDropSchema = async (client: KnexType | undefined, schemaName: string | undefined) => {
  if (!client || !schemaName) {
    return;
  }

  await client
    .raw(`DROP SCHEMA IF EXISTS ${quoteIdent(schemaName)} CASCADE`)
    .catch(() => undefined);
};

describeByodbStorage('BYODB space storage placement (e2e)', () => {
  let app: INestApplication;
  let metaDb: KnexType;
  let dataDb: KnexType;
  let baseConfigService: IBaseConfig;
  let recordHistoryDisabled: boolean | undefined;
  let spaceId: string | undefined;
  let baseId: string | undefined;
  const userId = globalThis.testConfig.userId;

  const internalSchema = `byodb_e2e_${Date.now().toString(36)}`;

  beforeAll(async () => {
    metaDb = createPgClient(metaDatabaseUrl!);
    dataDb = createPgClient(byodbDataDatabaseUrl!);

    const appCtx = await initApp();
    app = appCtx.app;
    baseConfigService = app.get(baseConfig.KEY) as IBaseConfig;
    recordHistoryDisabled = baseConfigService.recordHistoryDisabled;
    baseConfigService.recordHistoryDisabled = false;
    ensureUndoRedoWindowIdHeader(`win_byodb_storage_${Date.now()}`);
  }, 60_000);

  afterAll(async () => {
    if (baseId) {
      await permanentDeleteBase(baseId).catch(() => undefined);
    }
    if (spaceId) {
      await permanentDeleteSpace(spaceId).catch(() => undefined);
    }

    await safeDropSchema(dataDb, baseId);
    await safeDropSchema(metaDb, baseId);
    await safeDropSchema(dataDb, internalSchema);
    await safeDropSchema(metaDb, internalSchema);

    if (baseConfigService) {
      baseConfigService.recordHistoryDisabled = recordHistoryDisabled ?? false;
    }

    await dataDb?.destroy().catch(() => undefined);
    await metaDb?.destroy().catch(() => undefined);
    await app?.close();
  }, 60_000);

  const uploadExportedBase = async (targetBaseId: string) => {
    const awaitExportWithPreview = createAwaitWithEventWithResult<{
      status?: 'success' | 'failed';
      previewUrl: string;
      attachment?: { name: string; path: string };
      errorMessage?: string;
    }>(app.get(EventEmitterService), Events.BASE_EXPORT_COMPLETE);
    const { status, previewUrl, attachment, errorMessage } = await awaitExportWithPreview(
      async () => {
        await exportBase(targetBaseId);
      }
    );

    if (status === 'failed') {
      throw new Error(`Exported base is not available: ${errorMessage ?? 'unknown error'}`);
    }

    return await app.get(ClsService).runWith<Promise<INotifyVo>>(
      {
        user: {
          id: userId,
          name: 'Test User',
          email: 'test@example.com',
          isAdmin: null,
        },
      } as unknown as ClsStore,
      async () => {
        if (!attachment) {
          throw new Error(`Missing exported base attachment payload for ${previewUrl}`);
        }

        const storageAdapter = app.get<StorageAdapter>(Symbol.for('ObjectStorage'));
        const exportStream = await storageAdapter.downloadFile(
          StorageAdapter.getBucket(UploadType.ExportBase),
          attachment.path
        );
        const exportBuffer = await streamToBuffer(exportStream);
        const { token, requestHeaders } = (
          await apiGetSignature({
            type: UploadType.Import,
            contentType: 'application/octet-stream',
            contentLength: exportBuffer.length,
          })
        ).data;
        await apiUploadFile(token, exportBuffer, requestHeaders);

        return (await apiNotify(token, undefined, attachment.name)).data;
      }
    );
  };

  it('keeps metadata in the meta DB and physical data artifacts in the bound data DB', async () => {
    const space = await createSpace({
      name: 'BYODB placement e2e',
      dataDb: {
        mode: 'byodb',
        url: byodbDataDatabaseUrl!,
        targetMode: 'initialize-empty',
        internalSchema,
      },
    });
    spaceId = space.id;

    const base = await createBase({ spaceId: space.id, name: 'BYODB placement base' });
    baseId = base.id;

    const mainTable = await createTable(base.id, {
      name: 'BYODB placement main',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        { name: 'Amount', type: FieldType.Number },
        {
          name: 'Status',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { id: 'opt_todo', name: 'Todo', color: 'blue' },
              { id: 'opt_done', name: 'Done', color: 'green' },
            ],
          },
        },
      ],
      records: [{ fields: {} }, { fields: {} }, { fields: {} }],
    });
    expect(mainTable.records).toHaveLength(3);
    const foreignTable = await createTable(base.id, {
      name: 'BYODB placement foreign',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [],
    });

    const linkField = await createField(mainTable.id, {
      name: 'Foreign link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
      },
    });
    const linkOptions = linkField.options as ILinkFieldOptions;
    const primaryFieldId = mainTable.fields.find((field) => field.isPrimary)?.id;
    const amountFieldId = mainTable.fields.find((field) => field.name === 'Amount')?.id;
    const statusFieldId = mainTable.fields.find((field) => field.name === 'Status')?.id;
    const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
    expect(primaryFieldId).toBeTruthy();
    expect(amountFieldId).toBeTruthy();
    expect(statusFieldId).toBeTruthy();
    expect(foreignPrimaryFieldId).toBeTruthy();
    const defaultViewId = mainTable.defaultViewId!;

    await assertMetaPlaneRows(space.id, base.id, mainTable, foreignTable, linkField.id);
    await assertSchemaOperationsReady(base.id, mainTable.id, foreignTable.id);
    await assertMetaPlaneTablesAreNotCopiedToDataDb(base.id);
    await assertDataPlaneBaseline(internalSchema);
    await assertPhysicalTables(mainTable, foreignTable, linkOptions.fkHostTableName);
    await expect(countDbTableRows(dataDb, mainTable.dbTableName)).resolves.toBe(3);
    await expect(countDbTableRows(metaDb, mainTable.dbTableName)).resolves.toBe(0);
    const initialRecordList = await getRecords(mainTable.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: defaultViewId,
    });
    expect(initialRecordList.records).toHaveLength(3);
    expect(initialRecordList.records.map((record) => record.id)).toEqual(
      mainTable.records.map((record) => record.id)
    );
    await Promise.all(
      mainTable.records.map((record, index) =>
        updateRecord(mainTable.id, record.id, {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [primaryFieldId!]: `Seed row ${index + 1}`,
              [amountFieldId!]: (index + 1) * 10,
              [statusFieldId!]: index === 2 ? 'Done' : 'Todo',
            },
          },
        })
      )
    );
    const initialRowCount = await getRowCount(mainTable.id, {
      viewId: defaultViewId,
    });
    expect(initialRowCount.data.rowCount).toBe(3);
    await expect(countDbTableRows(dataDb, mainTable.dbTableName)).resolves.toBe(3);
    await expect(countDbTableRows(metaDb, mainTable.dbTableName)).resolves.toBe(0);

    const mainRecords = await createRecords(mainTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [primaryFieldId!]: 'Source row' } }],
    });
    const foreignRecords = await createRecords(foreignTable.id, {
      fieldKeyType: FieldKeyType.Id,
      records: [{ fields: { [foreignPrimaryFieldId!]: 'Foreign row' } }],
    });
    const recordId = mainRecords.records[0].id;
    const foreignRecordId = foreignRecords.records[0].id;

    await expect(
      countDbTableRowsWhere(dataDb, mainTable.dbTableName, `${quoteIdent('__id')} = ?`, [recordId])
    ).resolves.toBe(1);
    await expect(
      countDbTableRowsWhere(dataDb, foreignTable.dbTableName, `${quoteIdent('__id')} = ?`, [
        foreignRecordId,
      ])
    ).resolves.toBe(1);
    await expect(
      countDbTableRowsWhere(metaDb, mainTable.dbTableName, `${quoteIdent('__id')} = ?`, [recordId])
    ).resolves.toBe(0);
    await expect(
      countDbTableRowsWhere(metaDb, foreignTable.dbTableName, `${quoteIdent('__id')} = ?`, [
        foreignRecordId,
      ])
    ).resolves.toBe(0);

    const updatedRecord = await updateRecord(mainTable.id, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [primaryFieldId!]: 'Updated source row',
          [amountFieldId!]: 7,
          [statusFieldId!]: 'Done',
          [linkField.id]: [{ id: foreignRecordId }],
        },
      },
    });
    expect(updatedRecord.fields[primaryFieldId!]).toBe('Updated source row');
    expect(updatedRecord.fields[linkField.id]).toEqual([
      expect.objectContaining({ id: foreignRecordId }),
    ]);
    const rowCountAfterInsert = await getRowCount(mainTable.id, {
      viewId: defaultViewId,
    });
    expect(rowCountAfterInsert.data.rowCount).toBe(4);
    const aggregation = (
      await getAggregation(mainTable.id, {
        viewId: defaultViewId,
        field: {
          [StatisticsFunc.Sum]: [amountFieldId!],
          [StatisticsFunc.Count]: [primaryFieldId!],
        },
        groupBy: [{ fieldId: statusFieldId!, order: SortFunc.Asc }],
      })
    ).data;
    const amountAggregation = aggregation.aggregations?.find(
      (item) => item.fieldId === amountFieldId
    );
    const primaryAggregation = aggregation.aggregations?.find(
      (item) => item.fieldId === primaryFieldId
    );
    expect(Number(amountAggregation?.total?.value)).toBe(67);
    expect(Number(primaryAggregation?.total?.value)).toBe(4);
    expect(Object.keys(amountAggregation?.group ?? {})).toHaveLength(2);

    const groupPoints = (
      await getGroupPoints(mainTable.id, {
        viewId: defaultViewId,
        groupBy: [{ fieldId: statusFieldId!, order: SortFunc.Asc }],
      })
    ).data;
    expect(groupPoints?.filter((point) => point.type === GroupPointType.Header)).toHaveLength(2);
    expect(
      groupPoints?.reduce(
        (sum, point) => (point.type === GroupPointType.Row ? sum + point.count : sum),
        0
      )
    ).toBe(4);

    await updateRecordOrders(mainTable.id, defaultViewId, {
      anchorId: mainTable.records[0].id,
      position: 'before',
      recordIds: [recordId],
    });
    const reorderedRecords = await getRecords(mainTable.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: defaultViewId,
    });
    expect(reorderedRecords.records[0].id).toBe(recordId);

    await toggleTableIndex(base.id, mainTable.id, { type: TableIndex.search });
    expect((await getTableActivatedIndex(base.id, mainTable.id)).data).toContain(TableIndex.search);

    const extraField = await createField(mainTable.id, {
      name: 'BYODB extra notes',
      type: FieldType.LongText,
    });
    const extraDbFieldName = extraField.dbFieldName!;
    await expect(columnExists(dataDb, mainTable.dbTableName, extraDbFieldName)).resolves.toBe(true);
    await expect(columnExists(metaDb, mainTable.dbTableName, extraDbFieldName)).resolves.toBe(
      false
    );
    await deleteField(mainTable.id, extraField.id);
    await expect(columnExists(dataDb, mainTable.dbTableName, extraDbFieldName)).resolves.toBe(
      false
    );
    await expect(columnExists(metaDb, mainTable.dbTableName, extraDbFieldName)).resolves.toBe(
      false
    );

    await expect(countDbTableRows(dataDb, mainTable.dbTableName)).resolves.toBe(4);
    await expect(countDbTableRows(metaDb, mainTable.dbTableName)).resolves.toBe(0);

    await expect(
      waitForAtLeast(() => countDbTableRows(dataDb, linkOptions.fkHostTableName), 1)
    ).resolves.toBeGreaterThan(0);
    await expect(countDbTableRows(metaDb, linkOptions.fkHostTableName)).resolves.toBe(0);

    await expect(
      waitForAtLeast(
        () =>
          countRows(
            dataDb,
            internalSchema,
            'record_history',
            `${quoteIdent('table_id')} = ? AND ${quoteIdent('record_id')} = ?`,
            [mainTable.id, recordId]
          ),
        1
      )
    ).resolves.toBeGreaterThan(0);
    const { data: recordHistory } = await getRecordHistory(mainTable.id, recordId, {});
    expect(recordHistory.historyList.length).toBeGreaterThan(0);
    await expect(
      countRows(
        metaDb,
        'public',
        'record_history',
        `${quoteIdent('table_id')} = ? AND ${quoteIdent('record_id')} = ?`,
        [mainTable.id, recordId]
      )
    ).resolves.toBe(0);

    await deleteRecord(mainTable.id, recordId);
    await assertRecordTrashPlacement(mainTable.id, recordId, 1);

    const undoResult = await undo(mainTable.id);
    expect(undoResult.data.status).toBe('fulfilled');
    await assertRecordTrashPlacement(mainTable.id, recordId, 0);
    await expect(
      countDbTableRowsWhere(dataDb, mainTable.dbTableName, `${quoteIdent('__id')} = ?`, [recordId])
    ).resolves.toBe(1);

    const redoResult = await redo(mainTable.id);
    expect(redoResult.data.status).toBe('fulfilled');
    await assertRecordTrashPlacement(mainTable.id, recordId, 1);
    await expect(
      countDbTableRowsWhere(dataDb, mainTable.dbTableName, `${quoteIdent('__id')} = ?`, [recordId])
    ).resolves.toBe(0);

    await assertTableLifecycleRouting(base.id);
    await assertImportedTableRouting(base.id);
    await assertDotTeaBaseImportRouting(space.id);
    await assertComputedSideEffectsStayOutOfMetaDb(base.id, mainTable.id, recordId);
  }, 240_000);

  const assertMetaPlaneRows = async (
    targetSpaceId: string,
    targetBaseId: string,
    mainTable: ITableFullVo,
    foreignTable: ITableFullVo,
    linkFieldId: string
  ) => {
    await expect(
      countRows(metaDb, 'public', 'space', `${quoteIdent('id')} = ?`, [targetSpaceId])
    ).resolves.toBe(1);
    await expect(
      countRows(dataDb, 'public', 'space', `${quoteIdent('id')} = ?`, [targetSpaceId])
    ).resolves.toBe(0);

    await expect(
      countRows(metaDb, 'public', 'space_data_db_binding', `${quoteIdent('space_id')} = ?`, [
        targetSpaceId,
      ])
    ).resolves.toBe(1);
    await expect(
      countRows(dataDb, 'public', 'space_data_db_binding', `${quoteIdent('space_id')} = ?`, [
        targetSpaceId,
      ])
    ).resolves.toBe(0);

    await expect(
      countRows(metaDb, 'public', 'base', `${quoteIdent('id')} = ?`, [targetBaseId])
    ).resolves.toBe(1);
    await expect(
      countRows(dataDb, 'public', 'base', `${quoteIdent('id')} = ?`, [targetBaseId])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'table_meta', `${quoteIdent('base_id')} = ?`, [targetBaseId])
    ).resolves.toBeGreaterThanOrEqual(2);
    await expect(
      countRows(dataDb, 'public', 'table_meta', `${quoteIdent('base_id')} = ?`, [targetBaseId])
    ).resolves.toBe(0);

    await expect(
      countRows(metaDb, 'public', 'field', `${quoteIdent('table_id')} IN (?, ?)`, [
        mainTable.id,
        foreignTable.id,
      ])
    ).resolves.toBeGreaterThanOrEqual(3);
    await expect(
      countRows(dataDb, 'public', 'field', `${quoteIdent('table_id')} IN (?, ?)`, [
        mainTable.id,
        foreignTable.id,
      ])
    ).resolves.toBe(0);

    const selectFields = await rawRows<{ options: string | Record<string, unknown> | null }>(
      metaDb,
      `
        SELECT options
        FROM public.field
        WHERE table_id = ? AND type = ?
      `,
      [mainTable.id, FieldType.SingleSelect]
    );
    expect(selectFields).toHaveLength(1);
    const selectOptions =
      typeof selectFields[0]?.options === 'string'
        ? JSON.parse(selectFields[0].options)
        : selectFields[0]?.options;
    expect(selectOptions).toMatchObject({
      choices: [
        expect.objectContaining({ name: 'Todo' }),
        expect.objectContaining({ name: 'Done' }),
      ],
    });

    await expect(
      countRows(metaDb, 'public', 'view', `${quoteIdent('table_id')} IN (?, ?)`, [
        mainTable.id,
        foreignTable.id,
      ])
    ).resolves.toBeGreaterThanOrEqual(2);
    await expect(
      countRows(dataDb, 'public', 'view', `${quoteIdent('table_id')} IN (?, ?)`, [
        mainTable.id,
        foreignTable.id,
      ])
    ).resolves.toBe(0);

    await expect(
      countRows(
        metaDb,
        'public',
        'reference',
        `${quoteIdent('from_field_id')} = ? OR ${quoteIdent('to_field_id')} = ?`,
        [linkFieldId, linkFieldId]
      )
    ).resolves.toBeGreaterThan(0);
    await expect(
      countRows(
        dataDb,
        'public',
        'reference',
        `${quoteIdent('from_field_id')} = ? OR ${quoteIdent('to_field_id')} = ?`,
        [linkFieldId, linkFieldId]
      )
    ).resolves.toBe(0);
  };

  const assertSchemaOperationsReady = async (
    targetBaseId: string,
    mainTableId: string,
    foreignTableId: string
  ) => {
    const tableIdsPredicate = `${quoteIdent('base_id')} = ? AND ${quoteIdent(
      'table_id'
    )} IN (?, ?)`;
    const tableIdsParams = [targetBaseId, mainTableId, foreignTableId];

    await expect(
      countRows(
        metaDb,
        'public',
        'schema_operation',
        `${tableIdsPredicate} AND ${quoteIdent('type')} = ? AND ${quoteIdent('status')} = ?`,
        [...tableIdsParams, 'table.create', 'ready']
      )
    ).resolves.toBe(2);
    await expect(
      countRows(
        metaDb,
        'public',
        'schema_operation',
        `${tableIdsPredicate} AND ${quoteIdent('type')} = ? AND ${quoteIdent('status')} = ?`,
        [...tableIdsParams, 'table.update', 'ready']
      )
    ).resolves.toBe(2);
    await expect(
      countRows(
        metaDb,
        'public',
        'schema_operation',
        `${tableIdsPredicate} AND ${quoteIdent('status')} <> ?`,
        [...tableIdsParams, 'ready']
      )
    ).resolves.toBe(0);
    await expect(
      countRows(dataDb, 'public', 'schema_operation', tableIdsPredicate, tableIdsParams)
    ).resolves.toBe(0);
  };

  const assertMetaPlaneTablesAreNotCopiedToDataDb = async (targetBaseId: string) => {
    for (const tableName of metaPlaneTables) {
      await expect(relationExists(metaDb, 'public', tableName)).resolves.toBe(true);
      await expect(relationExists(dataDb, 'public', tableName)).resolves.toBe(false);
      await expect(relationExists(dataDb, internalSchema, tableName)).resolves.toBe(false);
      await expect(relationExists(dataDb, targetBaseId, tableName)).resolves.toBe(false);
    }
  };

  const assertDataPlaneBaseline = async (targetInternalSchema: string) => {
    await expect(schemaExists(dataDb, targetInternalSchema)).resolves.toBe(true);
    await expect(schemaExists(metaDb, targetInternalSchema)).resolves.toBe(false);

    for (const tableName of dataPlaneSystemTables) {
      await expect(relationExists(dataDb, targetInternalSchema, tableName)).resolves.toBe(true);
      await expect(relationExists(metaDb, targetInternalSchema, tableName)).resolves.toBe(false);
    }

    await expect(dataDbMigrationVersions(dataDb, targetInternalSchema)).resolves.toEqual(
      expect.arrayContaining([{ id: '20260421000000_init_data_db_baseline' }])
    );
    await expect(
      constraintExists(dataDb, targetInternalSchema, 'computed_update_outbox_seed_task_id_fkey')
    ).resolves.toBe(true);
  };

  it('initializes data DB migrations independently for multiple internal schemas', async () => {
    const firstInternalSchema = `byodb_migration_a_${Date.now().toString(36)}`;
    const secondInternalSchema = `byodb_migration_b_${Date.now().toString(36)}`;
    let firstSpaceId: string | undefined;
    let secondSpaceId: string | undefined;

    try {
      const firstSpace = await createSpace({
        name: 'BYODB migration smoke A',
        dataDb: {
          mode: 'byodb',
          url: byodbDataDatabaseUrl!,
          targetMode: 'initialize-empty',
          internalSchema: firstInternalSchema,
        },
      });
      firstSpaceId = firstSpace.id;
      const secondSpace = await createSpace({
        name: 'BYODB migration smoke B',
        dataDb: {
          mode: 'byodb',
          url: byodbDataDatabaseUrl!,
          targetMode: 'initialize-empty',
          internalSchema: secondInternalSchema,
        },
      });
      secondSpaceId = secondSpace.id;

      await assertDataPlaneBaseline(firstInternalSchema);
      await assertDataPlaneBaseline(secondInternalSchema);

      const firstVersions = await dataDbMigrationVersions(dataDb, firstInternalSchema);
      const secondVersions = await dataDbMigrationVersions(dataDb, secondInternalSchema);
      await expect(dataDbConnectionVersionForSpace(metaDb, firstSpace.id)).resolves.toEqual([
        { schema_version: firstVersions.at(-1)?.id },
      ]);
      await expect(dataDbConnectionVersionForSpace(metaDb, secondSpace.id)).resolves.toEqual([
        { schema_version: secondVersions.at(-1)?.id },
      ]);
    } finally {
      if (secondSpaceId) {
        await permanentDeleteSpace(secondSpaceId).catch(() => undefined);
      }
      if (firstSpaceId) {
        await permanentDeleteSpace(firstSpaceId).catch(() => undefined);
      }
      await safeDropSchema(dataDb, secondInternalSchema);
      await safeDropSchema(dataDb, firstInternalSchema);
      await safeDropSchema(metaDb, secondInternalSchema);
      await safeDropSchema(metaDb, firstInternalSchema);
    }
  });

  const assertPhysicalTables = async (
    mainTable: ITableFullVo,
    foreignTable: ITableFullVo,
    junctionTableName: string
  ) => {
    await expect(schemaExists(dataDb, baseId!)).resolves.toBe(true);
    await expect(schemaExists(metaDb, baseId!)).resolves.toBe(false);

    for (const dbTableName of [
      mainTable.dbTableName,
      foreignTable.dbTableName,
      junctionTableName,
    ]) {
      await expect(tableExists(dataDb, dbTableName)).resolves.toBe(true);
      await expect(tableExists(metaDb, dbTableName)).resolves.toBe(false);
      await expect(countDbTableRows(dataDb, dbTableName)).resolves.toBeGreaterThanOrEqual(0);
      await expect(countDbTableRows(metaDb, dbTableName)).resolves.toBe(0);
    }
  };

  const assertRecordTrashPlacement = async (
    tableId: string,
    recordId: string,
    expectedCount: number
  ) => {
    await expect(
      waitForCount(
        () =>
          countRows(
            dataDb,
            internalSchema,
            'table_trash',
            `${quoteIdent('table_id')} = ? AND ${quoteIdent('resource_type')} = ?`,
            [tableId, ResourceType.Record]
          ),
        expectedCount
      )
    ).resolves.toBe(expectedCount);
    await expect(
      waitForCount(
        () =>
          countRows(
            dataDb,
            internalSchema,
            'record_trash',
            `${quoteIdent('table_id')} = ? AND ${quoteIdent('record_id')} = ?`,
            [tableId, recordId]
          ),
        expectedCount
      )
    ).resolves.toBe(expectedCount);

    await expect(
      countRows(
        metaDb,
        'public',
        'table_trash',
        `${quoteIdent('table_id')} = ? AND ${quoteIdent('resource_type')} = ?`,
        [tableId, ResourceType.Record]
      )
    ).resolves.toBe(0);
    await expect(
      countRows(
        metaDb,
        'public',
        'record_trash',
        `${quoteIdent('table_id')} = ? AND ${quoteIdent('record_id')} = ?`,
        [tableId, recordId]
      )
    ).resolves.toBe(0);
  };

  const assertTableLifecycleRouting = async (targetBaseId: string) => {
    const lifecycleTable = await createTable(targetBaseId, {
      name: 'BYODB lifecycle table',
      fields: [{ name: 'Name', type: FieldType.SingleLineText }],
      records: [{ fields: { Name: 'Lifecycle row' } }],
    });
    const oldDbTableName = lifecycleTable.dbTableName;
    const renamedTableName = `byodb_lifecycle_${Date.now().toString(36)}`;
    const renamedDbTableName = `${targetBaseId}.${renamedTableName}`;

    await expect(tableExists(dataDb, oldDbTableName)).resolves.toBe(true);
    await expect(tableExists(metaDb, oldDbTableName)).resolves.toBe(false);

    await updateDbTableName(targetBaseId, lifecycleTable.id, {
      dbTableName: renamedTableName,
    });
    await expect(tableExists(dataDb, oldDbTableName)).resolves.toBe(false);
    await expect(tableExists(dataDb, renamedDbTableName)).resolves.toBe(true);
    await expect(tableExists(metaDb, renamedDbTableName)).resolves.toBe(false);
    await expect(countDbTableRows(dataDb, renamedDbTableName)).resolves.toBe(1);
    await expect(countDbTableRows(metaDb, renamedDbTableName)).resolves.toBe(0);

    const renamedRecords = await getRecords(lifecycleTable.id, {
      fieldKeyType: FieldKeyType.Id,
      viewId: lifecycleTable.defaultViewId,
    });
    expect(renamedRecords.records).toHaveLength(1);

    await deleteTable(targetBaseId, lifecycleTable.id, 200);
    await expect(
      waitForAtLeast(
        () =>
          countRows(
            dataDb,
            internalSchema,
            'table_trash',
            `${quoteIdent('table_id')} = ? AND ${quoteIdent('resource_type')} = ?`,
            [lifecycleTable.id, ResourceType.Table]
          ),
        1
      )
    ).resolves.toBeGreaterThan(0);
    await expect(
      countRows(
        metaDb,
        'public',
        'table_trash',
        `${quoteIdent('table_id')} = ? AND ${quoteIdent('resource_type')} = ?`,
        [lifecycleTable.id, ResourceType.Table]
      )
    ).resolves.toBe(0);

    await permanentDeleteTable(targetBaseId, lifecycleTable.id, 200);
    await expect(tableExists(dataDb, renamedDbTableName)).resolves.toBe(false);
    await expect(tableExists(metaDb, renamedDbTableName)).resolves.toBe(false);
    await expect(
      countRows(metaDb, 'public', 'table_meta', `${quoteIdent('id')} = ?`, [lifecycleTable.id])
    ).resolves.toBe(0);
  };

  const assertImportedTableRouting = async (targetBaseId: string) => {
    const attachmentUrl = await uploadImportCsv();
    const {
      data: { worksheets },
    } = await apiAnalyzeFile({
      attachmentUrl,
      fileType: SUPPORTEDTYPE.CSV,
    });
    const columns = worksheets[CsvImporter.DEFAULT_SHEETKEY].columns.map((column, index) => ({
      ...column,
      sourceColumnIndex: index,
    }));

    const importResult = await apiImportTableFromFile(targetBaseId, {
      attachmentUrl,
      fileType: SUPPORTEDTYPE.CSV,
      worksheets: {
        [CsvImporter.DEFAULT_SHEETKEY]: {
          name: 'BYODB imported table',
          columns,
          useFirstRowAsHeader: true,
          importData: true,
        },
      },
      tz: 'Asia/Shanghai',
    });
    const importedTable = importResult.data[0];
    expect(importedTable.fields.map((field) => ({ name: field.name, type: field.type }))).toEqual([
      { name: 'You_Xiang', type: FieldType.SingleLineText },
      { name: 'Ming_Zi', type: FieldType.SingleLineText },
      { name: 'order_count', type: FieldType.Number },
    ]);

    await waitForImportCompleted(importedTable.id, 2);

    const importedRecords = await getRecords(importedTable.id, {
      fieldKeyType: FieldKeyType.Name,
      viewId: importedTable.defaultViewId,
    });
    expect(importedRecords.records).toHaveLength(2);
    expect(importedRecords.records.map((record) => record.fields)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ['You_Xiang']: 'ada@example.com',
          ['Ming_Zi']: 'Ada',
          order_count: 3,
        }),
        expect.objectContaining({
          ['You_Xiang']: 'bob@example.com',
          ['Ming_Zi']: 'Bob',
          order_count: 5,
        }),
      ])
    );

    await expect(
      countRows(metaDb, 'public', 'table_meta', `${quoteIdent('id')} = ?`, [importedTable.id])
    ).resolves.toBe(1);
    await expect(
      countRows(dataDb, 'public', 'table_meta', `${quoteIdent('id')} = ?`, [importedTable.id])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'field', `${quoteIdent('table_id')} = ?`, [importedTable.id])
    ).resolves.toBe(3);
    await expect(
      countRows(dataDb, 'public', 'field', `${quoteIdent('table_id')} = ?`, [importedTable.id])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'view', `${quoteIdent('table_id')} = ?`, [importedTable.id])
    ).resolves.toBeGreaterThanOrEqual(1);
    await expect(
      countRows(dataDb, 'public', 'view', `${quoteIdent('table_id')} = ?`, [importedTable.id])
    ).resolves.toBe(0);

    await expect(tableExists(dataDb, importedTable.dbTableName)).resolves.toBe(true);
    await expect(tableExists(metaDb, importedTable.dbTableName)).resolves.toBe(false);
    await expect(countDbTableRows(dataDb, importedTable.dbTableName)).resolves.toBe(2);
    await expect(countDbTableRows(metaDb, importedTable.dbTableName)).resolves.toBe(0);

    await expect(
      countRows(
        metaDb,
        'public',
        'schema_operation',
        `${quoteIdent('base_id')} = ? AND ${quoteIdent('table_id')} = ? AND ${quoteIdent(
          'type'
        )} = ? AND ${quoteIdent('status')} = ?`,
        [targetBaseId, importedTable.id, 'table.create', 'ready']
      )
    ).resolves.toBe(1);
    await expect(
      countRows(
        metaDb,
        'public',
        'schema_operation',
        `${quoteIdent('base_id')} = ? AND ${quoteIdent('table_id')} = ? AND ${quoteIdent(
          'status'
        )} <> ?`,
        [targetBaseId, importedTable.id, 'ready']
      )
    ).resolves.toBe(0);
    await expect(
      countRows(dataDb, 'public', 'schema_operation', `${quoteIdent('table_id')} = ?`, [
        importedTable.id,
      ])
    ).resolves.toBe(0);

    await expect(
      waitForAtLeast(
        () =>
          countRows(dataDb, internalSchema, 'record_history', `${quoteIdent('table_id')} = ?`, [
            importedTable.id,
          ]),
        1
      )
    ).resolves.toBeGreaterThan(0);
    await expect(
      countRows(metaDb, 'public', 'record_history', `${quoteIdent('table_id')} = ?`, [
        importedTable.id,
      ])
    ).resolves.toBe(0);
  };

  const assertDotTeaBaseImportRouting = async (targetSpaceId: string) => {
    let sourceBaseId: string | undefined;
    let importedBaseId: string | undefined;
    const previousEnableCanaryFeature = process.env.ENABLE_CANARY_FEATURE;
    process.env.ENABLE_CANARY_FEATURE = 'true';

    try {
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: true,
          spaceIds: [targetSpaceId],
        },
      });

      const sourceBase = await createBase({
        spaceId: targetSpaceId,
        name: 'BYODB dottea source',
      });
      sourceBaseId = sourceBase.id;

      const foreignTable = await createTable(sourceBase.id, {
        name: 'BYODB dottea foreign',
        fields: [{ name: 'Title', type: FieldType.SingleLineText }],
        records: [{ fields: { Title: 'Foreign row' } }],
      });
      const foreignPrimaryFieldId = foreignTable.fields.find((field) => field.isPrimary)?.id;
      expect(foreignPrimaryFieldId).toBeTruthy();

      const hostTable = await createTable(sourceBase.id, {
        name: 'BYODB dottea host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        records: [{ fields: { Name: 'Host row' } }],
      });
      const hostRecordId = hostTable.records[0]?.id;
      const foreignRecordId = foreignTable.records[0]?.id;
      expect(hostRecordId).toBeTruthy();
      expect(foreignRecordId).toBeTruthy();

      const linkField = await createField(hostTable.id, {
        name: 'Foreign link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: foreignTable.id,
        },
      });
      await updateRecord(hostTable.id, hostRecordId!, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: foreignRecordId! }],
          },
        },
      });

      const notify = await uploadExportedBase(sourceBase.id);
      const previousCanaryHeader = axios.defaults.headers.common[X_CANARY_HEADER];
      axios.defaults.headers.common[X_CANARY_HEADER] = 'true';
      const importedResponse = await importBase({
        notify: notify as unknown as INotifyVo,
        spaceId: targetSpaceId,
      }).finally(() => {
        if (previousCanaryHeader === undefined) {
          delete axios.defaults.headers.common[X_CANARY_HEADER];
        } else {
          axios.defaults.headers.common[X_CANARY_HEADER] = previousCanaryHeader;
        }
      });
      expect({
        useV2: importedResponse.headers[X_TEABLE_V2_HEADER],
        reason: importedResponse.headers[X_TEABLE_V2_REASON_HEADER],
      }).toEqual({ useV2: 'true', reason: expect.any(String) });
      const imported = importedResponse.data;
      importedBaseId = imported.base.id;

      const importedTables = (await getTableList(importedBaseId)).data;
      expect(importedTables.map((table) => table.name).sort()).toEqual(
        ['BYODB dottea foreign', 'BYODB dottea host'].sort()
      );

      const importedHostMeta = importedTables.find((table) => table.name === hostTable.name)!;
      const importedForeignMeta = importedTables.find((table) => table.name === foreignTable.name)!;
      const importedHost = await getTable(importedBaseId, importedHostMeta.id, {
        includeContent: true,
      });
      const importedForeign = await getTable(importedBaseId, importedForeignMeta.id, {
        includeContent: true,
      });

      await expect(
        countRows(metaDb, 'public', 'base', `${quoteIdent('id')} = ?`, [importedBaseId])
      ).resolves.toBe(1);
      await expect(
        countRows(dataDb, 'public', 'base', `${quoteIdent('id')} = ?`, [importedBaseId])
      ).resolves.toBe(0);
      await expect(
        countRows(metaDb, 'public', 'table_meta', `${quoteIdent('base_id')} = ?`, [importedBaseId])
      ).resolves.toBe(2);
      await expect(
        countRows(dataDb, 'public', 'table_meta', `${quoteIdent('base_id')} = ?`, [importedBaseId])
      ).resolves.toBe(0);
      await expect(
        countRows(metaDb, 'public', 'field', `${quoteIdent('table_id')} IN (?, ?)`, [
          importedHostMeta.id,
          importedForeignMeta.id,
        ])
      ).resolves.toBeGreaterThanOrEqual(3);
      await expect(
        countRows(dataDb, 'public', 'field', `${quoteIdent('table_id')} IN (?, ?)`, [
          importedHostMeta.id,
          importedForeignMeta.id,
        ])
      ).resolves.toBe(0);

      await expect(tableExists(dataDb, importedHost.dbTableName)).resolves.toBe(true);
      await expect(tableExists(dataDb, importedForeign.dbTableName)).resolves.toBe(true);
      await expect(tableExists(metaDb, importedHost.dbTableName)).resolves.toBe(false);
      await expect(tableExists(metaDb, importedForeign.dbTableName)).resolves.toBe(false);
      await expect(
        waitForAtLeast(() => countDbTableRows(dataDb, importedHost.dbTableName), 1)
      ).resolves.toBe(1);
      await expect(
        waitForAtLeast(() => countDbTableRows(dataDb, importedForeign.dbTableName), 1)
      ).resolves.toBe(1);
      await expect(countDbTableRows(metaDb, importedHost.dbTableName)).resolves.toBe(0);
      await expect(countDbTableRows(metaDb, importedForeign.dbTableName)).resolves.toBe(0);

      const importedLinkField = (await getFields(importedHostMeta.id)).data.find(
        (field) => field.type === FieldType.Link
      );
      expect(importedLinkField).toBeDefined();
      await expect(
        countRows(
          metaDb,
          'public',
          'reference',
          `${quoteIdent('to_field_id')} = ? OR ${quoteIdent('from_field_id')} = ?`,
          [importedLinkField!.id, importedLinkField!.id]
        )
      ).resolves.toBeGreaterThan(0);
      await expect(
        countRows(
          dataDb,
          'public',
          'reference',
          `${quoteIdent('to_field_id')} = ? OR ${quoteIdent('from_field_id')} = ?`,
          [importedLinkField!.id, importedLinkField!.id]
        )
      ).resolves.toBe(0);

      const importedLinkOptions = importedLinkField!.options as ILinkFieldOptions;
      await expect(tableExists(dataDb, importedLinkOptions.fkHostTableName)).resolves.toBe(true);
      await expect(tableExists(metaDb, importedLinkOptions.fkHostTableName)).resolves.toBe(false);
      await expect(
        waitForAtLeast(() => countDbTableRows(dataDb, importedLinkOptions.fkHostTableName), 1)
      ).resolves.toBeGreaterThan(0);
      await expect(countDbTableRows(metaDb, importedLinkOptions.fkHostTableName)).resolves.toBe(0);
    } finally {
      if (previousEnableCanaryFeature === undefined) {
        delete process.env.ENABLE_CANARY_FEATURE;
      } else {
        process.env.ENABLE_CANARY_FEATURE = previousEnableCanaryFeature;
      }
      await updateSetting({
        [SettingKey.CANARY_CONFIG]: {
          enabled: false,
          spaceIds: [],
        },
      }).catch(() => undefined);
      if (importedBaseId) {
        await permanentDeleteBase(importedBaseId).catch(() => undefined);
      }
      if (sourceBaseId) {
        await permanentDeleteBase(sourceBaseId).catch(() => undefined);
      }
    }
  };

  const assertComputedSideEffectsStayOutOfMetaDb = async (
    targetBaseId: string,
    tableId: string,
    recordId: string
  ) => {
    await expect(
      countRows(metaDb, 'public', 'computed_update_outbox', `${quoteIdent('base_id')} = ?`, [
        targetBaseId,
      ])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'computed_update_dead_letter', `${quoteIdent('base_id')} = ?`, [
        targetBaseId,
      ])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'computed_update_outbox_seed', `${quoteIdent('table_id')} = ?`, [
        tableId,
      ])
    ).resolves.toBe(0);
    await expect(
      countRows(metaDb, 'public', 'computed_update_outbox_seed', `${quoteIdent('record_id')} = ?`, [
        recordId,
      ])
    ).resolves.toBe(0);
  };
});
