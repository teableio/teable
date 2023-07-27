/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { ICreateRecordsRo } from '@teable-group/core';
import request from 'supertest';
import { initApp } from './utils/init-app';

const assertData = {
  name: 'Project Management',
  description: 'A table for managing projects',
  fields: [
    {
      name: 'Project Name',
      description: 'The name of the project',
      type: 'singleLineText',
      notNull: true,
      unique: true,
    },
    {
      name: 'Project Description',
      description: 'A brief description of the project',
      type: 'singleLineText',
    },
    {
      name: 'Project Status',
      description: 'The current status of the project',
      type: 'singleSelect',
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
      type: 'date',
    },
    {
      name: 'End Date',
      description: 'The date the project is expected to end',
      type: 'date',
    },
  ],
  views: [
    {
      name: 'Grid View',
      description: 'A grid view of all projects',
      type: 'grid',
      options: {
        rowHeight: 'short',
      },
    },
    {
      name: 'Kanban View',
      description: 'A kanban view of all projects',
      type: 'kanban',
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

  beforeAll(async () => {
    app = await initApp();
  });

  afterAll(async () => {
    await request(app.getHttpServer()).delete(`/api/table/arbitrary/${tableId}`);
  });

  it('/api/table/ (POST) with assertData data', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/table')
      .send(assertData)
      .expect(201);
    expect(result.body).toMatchObject({
      success: true,
    });

    tableId = result.body.data.id;
    const recordResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .expect(200);

    expect(recordResult.body.data.records).toHaveLength(2);
  });

  it('/api/table/ (POST) empty', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/table')
      .send({ name: 'new table' })
      .expect(201);
    expect(result.body).toMatchObject({
      success: true,
    });
    tableId = result.body.data.id;
    const recordResult = await request(app.getHttpServer())
      .get(`/api/table/${tableId}/record`)
      .expect(200);
    expect(recordResult.body.data.records).toHaveLength(3);
  });

  it('should refresh table lastModifyTime when add a record', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/table')
      .send({ name: 'new table' })
      .expect(201);
    const prevTime = result.body.data.lastModifiedTime;
    tableId = result.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/table/${tableId}/record`)
      .send({ records: [{ fields: {} }] } as ICreateRecordsRo);

    const tableResult = await request(app.getHttpServer()).get(`/api/table/${tableId}`).expect(200);
    const currTime = tableResult.body.data.lastModifiedTime;
    console.log(currTime, prevTime);
    expect(new Date(currTime).getTime() > new Date(prevTime).getTime()).toBeTruthy();
  });
});
