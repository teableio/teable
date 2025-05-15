/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FieldKeyType, FieldType, Relationship, RowHeightLevel, ViewType } from '@teable/core';
import type { ICreateTableRo } from '@teable/openapi';
import {
  updateTableDescription,
  updateTableIcon,
  updateTableName,
  deleteTable as apiDeleteTable,
} from '@teable/openapi';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import { Events } from '../src/event-emitter/events';
import type {
  FieldCreateEvent,
  TableCreateEvent,
  ViewCreateEvent,
  RecordCreateEvent,
} from '../src/event-emitter/events';
import {
  createField,
  createRecords,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecords,
  getTable,
  initApp,
  updateRecord,
} from './utils/init-app';

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

  const baseId = globalThis.testConfig.baseId;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    dbProvider = app.get(DB_PROVIDER_SYMBOL);
    event = app.get(EventEmitter2);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

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
    expect(eventCount).toBe(4);
  });

  it('/api/table/ (POST) empty', async () => {
    const result = await createTable(baseId, { name: 'new table' });

    tableId = result.id;
    const recordResult = await getRecords(tableId);
    expect(recordResult.records).toHaveLength(3);
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

    await createField(table2.id, lookupFieldRo);
    await createField(table2.id, rollupFieldRo);

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

    const fields = await getFields(table2.id);
    const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Id });

    expect(fields[1].type).toEqual(FieldType.SingleLineText);
    expect(records[0].fields[fields[1].id]).toEqual('A');
    expect(fields[2].hasError).toBeTruthy();
    expect(fields[3].hasError).toBeTruthy();
  });
});
