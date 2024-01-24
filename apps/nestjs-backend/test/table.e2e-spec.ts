/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { ICreateTableRo } from '@teable-group/core';
import { FieldType, RowHeightLevel, ViewType } from '@teable-group/core';
import { DB_PROVIDER_SYMBOL } from '../src/db-provider/db.provider';
import type { IDbProvider } from '../src/db-provider/db.provider.interface';
import {
  createRecords,
  createTable,
  deleteTable,
  getRecords,
  getTable,
  initApp,
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
      type: FieldType.SingleLineText,
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
        groupingFieldId: 'Project Status',
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

describe('OpenAPI FieldController (e2e)', () => {
  let app: INestApplication;
  let tableId = '';
  let dbProvider: IDbProvider;

  const baseId = globalThis.testConfig.baseId;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    dbProvider = app.get(DB_PROVIDER_SYMBOL);
  });

  afterAll(async () => {
    await deleteTable(baseId, tableId);

    await app.close();
  });

  it('/api/table/ (POST) with assertData data', async () => {
    const result = await createTable(baseId, assertData);

    tableId = result.id;
    const recordResult = await getRecords(tableId);

    expect(recordResult.records).toHaveLength(2);
  });

  it('/api/table/ (POST) empty', async () => {
    const result = await createTable(baseId, { name: 'new table' });

    tableId = result.id;
    const recordResult = await getRecords(tableId);
    expect(recordResult.records).toHaveLength(3);
  });

  it('should refresh table lastModifyTime when add a record', async () => {
    const result = await createTable(baseId, { name: 'new table' });
    const prevTime = result.lastModifiedTime;
    tableId = result.id;

    await createRecords(tableId, {
      records: [{ fields: {} }],
    });

    const tableResult = await getTable(baseId, tableId);
    const currTime = tableResult.lastModifiedTime;
    expect(new Date(currTime).getTime() > new Date(prevTime).getTime()).toBeTruthy();
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
});
