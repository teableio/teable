/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { ILinkFieldOptions } from '@teable/core';
import { FieldKeyType, FieldType, Relationship } from '@teable/core';
import { DataPrismaService } from '@teable/db-data-prisma';
import { PrismaService } from '@teable/db-main-prisma';
import {
  createTable as apiCreateTable,
  deleteRecord as apiDeleteRecord,
  ensureUndoRedoWindowIdHeader,
  getRecordHistory,
  getTrashItems,
  redo,
  ResourceType,
  restoreTrash,
  undo,
} from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import type { IBaseConfig } from '../src/configs/base.config';
import { baseConfig } from '../src/configs/base.config';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createField,
  createTable,
  deleteRecord,
  getRecords,
  initApp,
  permanentDeleteTable,
  updateRecord,
} from './utils/init-app';

interface IRawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

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
const dataDatabaseUrl = process.env.PRISMA_DATA_DATABASE_URL;
const isTrueSplitDb =
  databaseIdentity(metaDatabaseUrl) != null &&
  databaseIdentity(dataDatabaseUrl) != null &&
  databaseIdentity(metaDatabaseUrl) !== databaseIdentity(dataDatabaseUrl);
const describeSplitDb = isTrueSplitDb ? describe : describe.skip;
const isForceV2 = process.env.FORCE_V2_ALL === 'true';

const parseDbTableName = (dbTableName: string) => {
  const [schemaName, tableName] = dbTableName.split('.');

  if (!schemaName || !tableName) {
    throw new Error(`Invalid dbTableName: ${dbTableName}`);
  }

  return { schemaName, tableName };
};

const tableExists = async (client: IRawQueryClient, dbTableName: string) => {
  const { schemaName, tableName } = parseDbTableName(dbTableName);
  const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_name = $2
      ) AS exists
    `,
    schemaName,
    tableName
  );

  return Boolean(rows[0]?.exists);
};

const isMissingRecordHistoryTable = (error: unknown) =>
  String((error as { message?: unknown })?.message).includes('record_history') &&
  String((error as { message?: unknown })?.message).includes('does not exist');

const isMissingPublicTable = (error: unknown, tableName: string) =>
  String((error as { message?: unknown })?.message).includes(tableName) &&
  String((error as { message?: unknown })?.message).includes('does not exist');

const countRecordHistory = async (client: IRawQueryClient, tableId: string, recordId: string) => {
  try {
    const rows = await client.$queryRawUnsafe<{ count: number }[]>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.record_history
        WHERE table_id = $1 AND record_id = $2
      `,
      tableId,
      recordId
    );

    return rows[0]?.count ?? 0;
  } catch (error) {
    if (isMissingRecordHistoryTable(error)) {
      return 0;
    }

    throw error;
  }
};

const countTableTrash = async (
  client: IRawQueryClient,
  tableId: string,
  resourceType: ResourceType
) => {
  try {
    const rows = await client.$queryRawUnsafe<{ count: number }[]>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.table_trash
        WHERE table_id = $1 AND resource_type = $2
      `,
      tableId,
      resourceType
    );

    return rows[0]?.count ?? 0;
  } catch (error) {
    if (isMissingPublicTable(error, 'table_trash')) {
      return 0;
    }

    throw error;
  }
};

const countRecordTrash = async (client: IRawQueryClient, tableId: string, recordId: string) => {
  try {
    const rows = await client.$queryRawUnsafe<{ count: number }[]>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.record_trash
        WHERE table_id = $1 AND record_id = $2
      `,
      tableId,
      recordId
    );

    return rows[0]?.count ?? 0;
  } catch (error) {
    if (isMissingPublicTable(error, 'record_trash')) {
      return 0;
    }

    throw error;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForCount = async (
  getCount: () => Promise<number>,
  expectedCount: number,
  maxRetries = 50
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

describeSplitDb('Dual DB split smoke (e2e)', () => {
  let app: INestApplication;
  let metaPrisma: PrismaService;
  let dataPrisma: DataPrismaService;
  let eventEmitterService: EventEmitterService;
  let awaitWithRecordHistory: <T>(fn: () => Promise<T>) => Promise<T>;
  let awaitWithOperation: <T>(fn: () => Promise<T>) => Promise<T>;
  let baseConfigService: IBaseConfig;
  let recordHistoryDisabled: boolean | undefined;

  const baseId = globalThis.testConfig.baseId;
  const createdTables: ITableFullVo[] = [];
  const itV1SplitDb = isForceV2 ? it.skip : it;
  const itV2SplitDb = isForceV2 ? it : it.skip;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    metaPrisma = app.get(PrismaService);
    dataPrisma = app.get(DataPrismaService);
    eventEmitterService = app.get(EventEmitterService);
    awaitWithRecordHistory = createAwaitWithEvent(
      eventEmitterService,
      Events.RECORD_HISTORY_CREATE
    );
    awaitWithOperation = createAwaitWithEvent(eventEmitterService, Events.OPERATION_PUSH);
    ensureUndoRedoWindowIdHeader(`win_split_${Date.now()}`);
    baseConfigService = app.get(baseConfig.KEY) as IBaseConfig;
    recordHistoryDisabled = baseConfigService.recordHistoryDisabled;
    baseConfigService.recordHistoryDisabled = false;
  });

  afterEach(async () => {
    for (const table of createdTables.splice(0).reverse()) {
      await permanentDeleteTable(baseId, table.id);
    }
  });

  afterAll(async () => {
    if (baseConfigService) {
      baseConfigService.recordHistoryDisabled = recordHistoryDisabled;
    }
    eventEmitterService?.eventEmitter.removeAllListeners(Events.RECORD_HISTORY_CREATE);
    await app?.close();
  });

  it('keeps metadata in meta DB and data artifacts in data DB', async () => {
    const mainTable = await createTable(baseId, {
      name: 'Split smoke main',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [{ fields: { Name: 'Source row' } }],
    });
    createdTables.push(mainTable);

    const foreignTable = await createTable(baseId, {
      name: 'Split smoke foreign',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [{ fields: { Name: 'Foreign row' } }],
    });
    createdTables.push(foreignTable);

    await expect(
      metaPrisma.tableMeta.findUnique({
        where: { id: mainTable.id },
        select: { dbTableName: true },
      })
    ).resolves.toMatchObject({ dbTableName: mainTable.dbTableName });

    await expect(tableExists(dataPrisma, mainTable.dbTableName)).resolves.toBe(true);
    await expect(tableExists(metaPrisma, mainTable.dbTableName)).resolves.toBe(false);
    await expect(tableExists(dataPrisma, foreignTable.dbTableName)).resolves.toBe(true);
    await expect(tableExists(metaPrisma, foreignTable.dbTableName)).resolves.toBe(false);

    const linkField = await createField(mainTable.id, {
      name: 'Foreign link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: foreignTable.id,
      },
    });
    const linkOptions = linkField.options as ILinkFieldOptions;

    expect(linkOptions.fkHostTableName).toContain('junction_');
    await expect(tableExists(dataPrisma, linkOptions.fkHostTableName)).resolves.toBe(true);
    await expect(tableExists(metaPrisma, linkOptions.fkHostTableName)).resolves.toBe(false);

    const recordId = mainTable.records[0].id;
    const foreignRecordId = foreignTable.records[0].id;
    await awaitWithRecordHistory(() =>
      updateRecord(mainTable.id, recordId, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: foreignRecordId }],
          },
        },
      })
    );

    const records = await getRecords(mainTable.id, { fieldKeyType: FieldKeyType.Id });
    const updatedRecord = records.records.find((record) => record.id === recordId);
    expect(updatedRecord?.fields[linkField.id]).toEqual([
      expect.objectContaining({ id: foreignRecordId }),
    ]);

    const { data: recordHistory } = await getRecordHistory(mainTable.id, recordId, {});

    expect(recordHistory.historyList.length).toBeGreaterThan(0);
    await expect(countRecordHistory(dataPrisma, mainTable.id, recordId)).resolves.toBeGreaterThan(
      0
    );
    await expect(countRecordHistory(metaPrisma, mainTable.id, recordId)).resolves.toBe(0);
  });

  itV1SplitDb('keeps record trash snapshots in data DB through restore and undo/redo', async () => {
    const table = await createTable(baseId, {
      name: 'Split trash smoke',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [{ fields: { Name: 'Trash row' } }],
    });
    createdTables.push(table);

    const recordId = table.records[0].id;
    await awaitWithOperation(() => deleteRecord(table.id, recordId));

    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 1)
    ).resolves.toBe(1);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 1)
    ).resolves.toBe(1);
    await expect(countTableTrash(metaPrisma, table.id, ResourceType.Record)).resolves.toBe(0);
    await expect(countRecordTrash(metaPrisma, table.id, recordId)).resolves.toBe(0);

    const trash = await getTrashItems({ resourceId: table.id, resourceType: ResourceType.Table });
    const recordTrashItem = trash.data.trashItems.find(
      (item) =>
        item.resourceType === ResourceType.Record &&
        'resourceIds' in item &&
        item.resourceIds.includes(recordId)
    );

    expect(recordTrashItem).toBeDefined();
    await restoreTrash(recordTrashItem!.id);

    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 0)
    ).resolves.toBe(0);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 0)
    ).resolves.toBe(0);

    const recordsAfterRestore = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(recordsAfterRestore.records.some((record) => record.id === recordId)).toBe(true);

    await awaitWithOperation(() => deleteRecord(table.id, recordId));
    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 1)
    ).resolves.toBe(1);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 1)
    ).resolves.toBe(1);

    const undoResult = await undo(table.id);
    expect(undoResult.data.status).toBe('fulfilled');
    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 0)
    ).resolves.toBe(0);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 0)
    ).resolves.toBe(0);

    const recordsAfterUndo = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(recordsAfterUndo.records.some((record) => record.id === recordId)).toBe(true);

    const redoResult = await redo(table.id);
    expect(redoResult.data.status).toBe('fulfilled');
    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 1)
    ).resolves.toBe(1);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 1)
    ).resolves.toBe(1);

    const recordsAfterRedo = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
    expect(recordsAfterRedo.records.some((record) => record.id === recordId)).toBe(false);
  });

  itV2SplitDb('keeps forced v2 table and record delete artifacts in the data DB', async () => {
    const createRes = await apiCreateTable(baseId, {
      name: 'Split v2 smoke',
      fields: [{ name: 'Name', type: FieldType.SingleLineText, isPrimary: true }],
      records: [{ fields: { Name: 'V2 row' } }],
    });
    expect(createRes.status).toBe(201);
    expect(createRes.headers['x-teable-v2']).toBe('true');
    expect(createRes.headers['x-teable-v2-feature']).toBe('createTable');
    expect(createRes.headers['x-teable-v2-reason']).toBeTruthy();

    const table = createRes.data;
    createdTables.push(table);

    await expect(
      metaPrisma.tableMeta.findUnique({
        where: { id: table.id },
        select: { dbTableName: true },
      })
    ).resolves.toMatchObject({ dbTableName: table.dbTableName });
    await expect(tableExists(dataPrisma, table.dbTableName)).resolves.toBe(true);
    await expect(tableExists(metaPrisma, table.dbTableName)).resolves.toBe(false);

    const recordId = table.records[0].id;
    const deleteRes = await apiDeleteRecord(table.id, recordId);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.headers['x-teable-v2']).toBe('true');
    expect(deleteRes.headers['x-teable-v2-feature']).toBe('deleteRecord');
    expect(deleteRes.headers['x-teable-v2-reason']).toBeTruthy();

    await expect(
      waitForCount(() => countTableTrash(dataPrisma, table.id, ResourceType.Record), 1)
    ).resolves.toBe(1);
    await expect(
      waitForCount(() => countRecordTrash(dataPrisma, table.id, recordId), 1)
    ).resolves.toBe(1);
    await expect(countTableTrash(metaPrisma, table.id, ResourceType.Record)).resolves.toBe(0);
    await expect(countRecordTrash(metaPrisma, table.id, recordId)).resolves.toBe(0);
  });
});
