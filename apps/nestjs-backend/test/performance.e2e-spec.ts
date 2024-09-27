/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import { Colors, FieldType, RatingIcon, Relationship } from '@teable/core';
import { createRecords, createTable } from '@teable/openapi';
import type { ITableFullVo } from '@teable/openapi';
import { initApp, permanentDeleteTable } from './utils/init-app';

describe('OpenAPI RecordController (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const userId = globalThis.testConfig.userId;
  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create records performance', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    const batchSize = 1000;

    beforeEach(async () => {
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'Title',
          },
        ],
        records: [
          {
            fields: {
              Title: 'A1',
            },
          },
          {
            fields: {
              Title: 'A2',
            },
          },
          {
            fields: {
              Title: 'A3',
            },
          },
        ],
      }).then((res) => res.data);

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: [
          {
            type: FieldType.SingleLineText,
            name: 'Title',
          },
          {
            type: FieldType.Number,
            name: 'Count',
          },
          {
            type: FieldType.SingleSelect,
            name: 'Status',
            options: {
              choices: [{ name: 'Not Started' }, { name: 'In Progress' }, { name: 'Completed' }],
            },
          },
          {
            type: FieldType.LongText,
            name: 'Text',
          },
          {
            type: FieldType.MultipleSelect,
            name: 'Tags',
            options: {
              choices: [
                { name: 'Tag 1' },
                { name: 'Tag 2' },
                { name: 'Tag 3' },
                { name: 'Tag 4' },
                { name: 'Tag 5' },
              ],
            },
          },
          {
            type: FieldType.User,
            name: 'Member',
          },
          {
            type: FieldType.Date,
            name: 'Date',
          },
          {
            type: FieldType.Rating,
            name: 'Rating',
            options: {
              icon: RatingIcon.Star,
              color: Colors.YellowBright,
              max: 5,
            },
          },
          {
            type: FieldType.Link,
            name: 'One-way Link',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: table2.id,
              isOneWay: true,
            },
          },
          {
            type: FieldType.Link,
            name: 'Two-way Link',
            options: {
              relationship: Relationship.ManyOne,
              foreignTableId: table2.id,
            },
          },
        ],
      }).then((res) => res.data);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it(
      'batch create records',
      async () => {
        const { data } = await createRecords(table1.id, {
          typecast: true,
          records: Array.from({ length: batchSize }, () => ({
            fields: {
              Title: faker.lorem.sentence(),
              Count: faker.number.int({ min: 1, max: 100 }),
              Status: faker.helpers.arrayElement(['Not Started', 'In Progress', 'Completed']),
              Text: faker.lorem.paragraph(),
              Tags: faker.helpers.arrayElements(['Tag 1', 'Tag 2', 'Tag 3', 'Tag 4', 'Tag 5'], {
                min: 1,
                max: 5,
              }),
              Member: userId,
              Date: faker.date.recent().toISOString(),
              Rating: faker.number.int({ min: 0, max: 5 }),
              'One-way Link': faker.helpers.arrayElement(['A1', 'A2', 'A3']),
              'Two-way Link': faker.helpers.arrayElement(['A1', 'A2', 'A3']),
            },
          })),
        });

        expect(data.records).toHaveLength(batchSize);
      },
      {
        timeout: 10000,
      }
    );
  });
});
