/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldKeyType, FieldType, Relationship, RowHeightLevel, ViewType } from '@teable/core';
import type { ICreateTableRo } from '@teable/openapi';
import {
  BaseNodeResourceType,
  getBaseNodeTree,
  updateTableDescription,
  updateTableIcon,
  updateTableName,
  deleteTable as apiDeleteTable,
} from '@teable/openapi';
import { v2RecordRepositoryPostgresTokens } from '@teable/v2-adapter-table-repository-postgres';
import type { ComputedUpdateWorker } from '@teable/v2-adapter-table-repository-postgres';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { Events } from '../src/event-emitter/events';
import type {
  FieldCreateEvent,
  TableCreateEvent,
  ViewCreateEvent,
  RecordCreateEvent,
} from '../src/event-emitter/events';
import { V2ContainerService } from '../src/features/v2/v2-container.service';
import {
  createField,
  createRecords,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecords,
  getTable,
  initApp,
  createBase,
  permanentDeleteBase,
  updateRecord,
} from './utils/init-app';

const isForceV2 = process.env.FORCE_V2_ALL === 'true';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const assertData: ICreateTableRo = {
  name: 'Project Management',
  description: 'A table for managing projects',
  fields: [
    {
      name: 'Project Name',
      description: 'The name of the project',
      type: FieldType.SingleLineText,
    },
    {
      name: 'Project Description',
      description: 'A brief description of the project',
      type: FieldType.SingleLineText,
    },
    {
      name: 'Project Status',
      description: 'The current status of the project',
      type: FieldType.SingleSelect,
      options: {
        choices: [
          {
            name: 'Not Started',
            color: 'gray',
          },
          {
            name: 'In Progress',
            color: 'blue',
          },
          {
            name: 'Completed',
            color: 'green',
          },
        ],
      },
    },
    {
      name: 'Start Date',
      description: 'The date the project started',
      type: FieldType.Date,
    },
    {
      name: 'End Date',
      description: 'The date the project is expected to end',
      type: FieldType.Date,
    },
  ],
  views: [
    {
      name: 'Grid View',
      description: 'A grid view of all projects',
      type: ViewType.Grid,
      options: {
        rowHeight: RowHeightLevel.Short,
      },
    },
    {
      name: 'Kanban View',
      description: 'A kanban view of all projects',
      type: ViewType.Kanban,
      options: {
        stackFieldId: 'Project Status',
        isFieldNameHidden: true,
        isEmptyStackHidden: true,
      },
    },
  ],
  records: [
    {
      fields: {
        'Project Name': 'Project A',
        'Project Description': 'A project to develop a new product',
        'Project Status': 'Not Started',
      },
    },
    {
      fields: {
        'Project Name': 'Project B',
        'Project Description': 'A project to improve customer service',
        'Project Status': 'In Progress',
      },
    },
  ],
};

describe('OpenAPI TableController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  let dbProvider: IDbProvider;
  let event: EventEmitter2;
  let v2ContainerService: V2ContainerService;

  const baseId = globalThis.testConfig.baseId;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    dbProvider = app.get(DB_PROVIDER_SYMBOL);
    event = app.get(EventEmitter2);
    v2ContainerService = app.get(V2ContainerService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    if (tableId) {
      await permanentDeleteTable(baseId, tableId);
      tableId = '';
    }
  });

  async function processV2Outbox(times = 1): Promise<void> {
    if (!isForceV2) return;

    const container = await v2ContainerService.getContainer();
    const worker = container.resolve<ComputedUpdateWorker>(
      v2RecordRepositoryPostgresTokens.computedUpdateWorker
    );

    for (let i = 0; i < times; i++) {
      const maxIterations = 100;
      let iterations = 0;

      while (iterations < maxIterations) {
        const result = await worker.runOnce({
          workerId: 'table-delete-test-worker',
          limit: 100,
        });

        if (result.isErr()) {
          throw new Error(`Outbox processing failed: ${result.error.message}`);
        }

        if (result.value === 0) {
          break;
        }

        iterations++;
      }
    }
  }

  async function waitForDeleteTableCleanup(
    targetTableId: string,
    options: {
      twoWayLinkFieldId: string;
      oneWayLinkFieldId: string;
      lookupFieldId: string;
      rollupFieldId: string;
    }
  ) {
    const maxRetries = isForceV2 ? 40 : 1;

    for (let i = 0; i < maxRetries; i++) {
      if (isForceV2) {
        await processV2Outbox();
      }

      const fields = await getFields(targetTableId);
      const { records } = await getRecords(targetTableId, { fieldKeyType: FieldKeyType.Id });
      const twoWayLinkField = fields.find((field) => field.id === options.twoWayLinkFieldId);
      const oneWayLinkField = fields.find((field) => field.id === options.oneWayLinkFieldId);
      const lookupField = fields.find((field) => field.id === options.lookupFieldId);
      const rollupField = fields.find((field) => field.id === options.rollupFieldId);

      const deleteSettled =
        twoWayLinkField?.type === FieldType.SingleLineText &&
        oneWayLinkField?.type === FieldType.SingleLineText &&
        records[0]?.fields[options.twoWayLinkFieldId] === 'A' &&
        records[0]?.fields[options.oneWayLinkFieldId] === 'A' &&
        Boolean(lookupField?.hasError) &&
        Boolean(rollupField?.hasError);

      if (deleteSettled) {
        return { fields, records };
      }

      await sleep(100);
    }

    const fields = await getFields(targetTableId);
    const { records } = await getRecords(targetTableId, { fieldKeyType: FieldKeyType.Id });
    return { fields, records };
  }

  it('/api/table/ (POST) with assertData data', async () => {
    let eventCount = 0;
    event.once(Events.TABLE_CREATE, async (payload: TableCreateEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.TABLE_CREATE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.baseId).toBeDefined();
      expect(payload?.payload?.table).toBeDefined();
      eventCount++;
    });

    event.once(Events.TABLE_FIELD_CREATE, async (payload: FieldCreateEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.TABLE_FIELD_CREATE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.tableId).toBeDefined();
      expect(payload?.payload?.field).toHaveLength(5);
      eventCount++;
    });

    event.once(Events.TABLE_VIEW_CREATE, async (payload: ViewCreateEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.TABLE_VIEW_CREATE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.tableId).toBeDefined();
      expect(payload?.payload?.view).toHaveLength(2);
      eventCount++;
    });

    event.once(Events.TABLE_RECORD_CREATE, async (payload: RecordCreateEvent) => {
      expect(payload).toBeDefined();
      expect(payload.name).toBe(Events.TABLE_RECORD_CREATE);
      expect(payload?.payload).toBeDefined();
      expect(payload?.payload?.tableId).toBeDefined();
      expect(payload?.payload?.record).toHaveLength(2);
      eventCount++;
    });

    const result = await createTable(baseId, assertData);

    tableId = result.id;
    const recordResult = await getRecords(tableId);

    expect(recordResult.records).toHaveLength(2);
    expect(eventCount).toBe(isForceV2 ? 0 : 4);
  });

  it('/api/table/ (POST) empty', async () => {
    const result = await createTable(baseId, { name: 'new table' });

    tableId = result.id;
    const recordResult = await getRecords(tableId);
    expect(recordResult.records).toHaveLength(3);
  });

  it('should invalidate base-node tree cache after table creation', async () => {
    const isolatedBase = await createBase({
      spaceId: globalThis.testConfig.spaceId,
      name: `base-node-cache-${Date.now()}`,
    });

    try {
      const initialTree = await getBaseNodeTree(isolatedBase.id).then((res) => res.data);
      const initialTableNodeIds = new Set(
        initialTree.nodes
          .filter((node) => node.resourceType === BaseNodeResourceType.Table)
          .map((node) => node.resourceId)
      );

      const createdTable = await createTable(isolatedBase.id, {
        name: 'cache invalidation table',
        fields: [{ name: 'Name', type: FieldType.SingleLineText }],
        views: [{ name: 'Grid view', type: ViewType.Grid }],
        records: [],
      });

      const refreshedTree = await getBaseNodeTree(isolatedBase.id).then((res) => res.data);
      const createdNode = refreshedTree.nodes.find(
        (node) =>
          node.resourceType === BaseNodeResourceType.Table && node.resourceId === createdTable.id
      );

      expect(initialTableNodeIds.has(createdTable.id)).toBe(false);
      expect(createdNode).toBeDefined();
    } finally {
      await permanentDeleteBase(isolatedBase.id);
    }
  });

  it('should refresh table lastModifyTime when add a record', async () => {
    const result = await createTable(baseId, { name: 'new table' });
    tableId = result.id;

    await createRecords(tableId, {
      records: [{ fields: {} }],
    });

    const tableResult = await getTable(baseId, tableId);
    const currTime = tableResult.lastModifiedTime;
    expect(new Date(currTime!).getTime() > 0).toBeTruthy();
  });

  it('should create table with add a record', async () => {
    const timeStr = new Date().getTime() + '';
    const result = await createTable(baseId, {
      name: 'new table',
      dbTableName: 'my_awesome_table_name' + timeStr,
    });

    tableId = result.id;

    const tableResult = await getTable(baseId, tableId);

    expect(tableResult.dbTableName).toEqual(
      dbProvider.generateDbTableName(baseId, 'my_awesome_table_name' + timeStr)
    );
  });

  it('should create table with ordered fields', async () => {
    const table = await createTable(baseId, {
      name: 'ordered fields table',
      fields: [
        {
          name: 'Single line text',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Formula',
          options: {
            expression: '1 + 1',
          },
          type: FieldType.Formula,
        },
        {
          name: 'Long text',
          type: FieldType.LongText,
        },
      ],
    });

    const tableResult = await getTable(baseId, table.id, { includeContent: true });
    const fields = tableResult.fields!;

    expect(fields.length).toEqual(3);
    expect(fields[0].type).toEqual(FieldType.SingleLineText);
    expect(fields[1].type).toEqual(FieldType.Formula);
    expect(fields[2].type).toEqual(FieldType.LongText);
  });

  it('should reject createTable when first field has unsupported primary type', async () => {
    // Without the fix, the service would auto-promote a checkbox first field to primary
    // (bypassing prepareCreateFields validation), persisting a bad-type primary.
    await expect(
      createTable(baseId, {
        name: 'bad primary table',
        fields: [
          { name: 'Done', type: FieldType.Checkbox },
          { name: 'Note', type: FieldType.SingleLineText },
        ],
      })
    ).rejects.toThrow(/primary/i);
  });

  it('should update table simple properties', async () => {
    const result = await createTable(baseId, {
      name: 'table',
    });

    tableId = result.id;

    await updateTableName(baseId, tableId, { name: 'newTableName' });
    await updateTableDescription(baseId, tableId, { description: 'newDescription' });
    await updateTableIcon(baseId, tableId, { icon: '😀' });

    const table = await getTable(baseId, tableId);

    expect(table.name).toEqual('newTableName');
    expect(table.description).toEqual('newDescription');
    expect(table.icon).toEqual('😀');
  });

  it('should delete table and clean up link and lookup fields', async () => {
    const table1 = await createTable(baseId, {
      fields: [
        {
          name: 'name',
          type: FieldType.SingleLineText,
        },
        {
          name: 'other',
          type: FieldType.SingleLineText,
        },
      ],
      records: [
        {
          fields: {
            name: 'A',
            other: 'Other',
          },
        },
        {
          fields: {
            name: 'B',
          },
        },
      ],
    });

    const table2 = await createTable(baseId, {
      fields: [
        {
          name: 'name',
          type: FieldType.SingleLineText,
        },
      ],
    });
    tableId = table2.id;

    const twoWayLinkRo = {
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: table1.id,
      },
    };

    const oneWayLinkRo = {
      type: FieldType.Link,
      options: {
        relationship: Relationship.OneOne,
        foreignTableId: table1.id,
        isOneWay: true,
      },
    };

    const twoWayLink = await createField(table2.id, twoWayLinkRo);
    const oneWayLink = await createField(table2.id, oneWayLinkRo);

    const lookupFieldRo = {
      type: FieldType.SingleLineText,
      isLookup: true,
      lookupOptions: {
        foreignTableId: table1.id,
        lookupFieldId: table1.fields[1].id,
        linkFieldId: twoWayLink.id,
      },
    };

    const rollupFieldRo = {
      type: FieldType.Rollup,
      options: {
        expression: 'countall({values})',
      },
      lookupOptions: {
        foreignTableId: table1.id,
        lookupFieldId: table1.fields[1].id,
        linkFieldId: twoWayLink.id,
      },
    };

    const lookupField = await createField(table2.id, lookupFieldRo);
    const rollupField = await createField(table2.id, rollupFieldRo);
    const lookupFieldId = lookupField.id;
    const rollupFieldId = rollupField.id;

    await updateRecord(table2.id, table2.records[0].id, {
      record: {
        fields: {
          [twoWayLink.id]: [{ id: table1.records[0].id }],
          [oneWayLink.id]: { id: table1.records[0].id },
        },
      },
      fieldKeyType: FieldKeyType.Id,
    });

    await apiDeleteTable(baseId, table1.id);

    const { fields, records } = await waitForDeleteTableCleanup(table2.id, {
      twoWayLinkFieldId: twoWayLink.id,
      oneWayLinkFieldId: oneWayLink.id,
      lookupFieldId,
      rollupFieldId,
    });
    const twoWayLinkField = fields.find((field) => field.id === twoWayLink.id);
    const oneWayLinkField = fields.find((field) => field.id === oneWayLink.id);
    const refreshedLookupField = fields.find((field) => field.id === lookupFieldId);
    const refreshedRollupField = fields.find((field) => field.id === rollupFieldId);

    if (!isForceV2) {
      expect(twoWayLinkField?.type).toEqual(FieldType.SingleLineText);
      expect(records[0].fields[twoWayLink.id]).toEqual('A');
      expect(refreshedLookupField?.hasError).toBeTruthy();
      expect(refreshedRollupField?.hasError).toBeTruthy();
      return;
    }

    expect(twoWayLinkField?.type).toEqual(FieldType.SingleLineText);
    expect(oneWayLinkField?.type).toEqual(FieldType.SingleLineText);
    expect(records[0].fields[twoWayLink.id]).toEqual('A');
    expect(records[0].fields[oneWayLink.id]).toEqual('A');
    expect(refreshedLookupField?.hasError).toBeTruthy();
    expect(refreshedRollupField?.hasError).toBeTruthy();
  });
});
