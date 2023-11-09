/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IFilter,
  ILookupOptionsRo,
  ITableFullVo,
} from '@teable-group/core';
import {
  Colors,
  DateUtil,
  FieldType,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable-group/core';
import qs from 'qs';
import type request from 'supertest';
import { createField, createRecords, initApp } from './utils/init-app';

// All kind of field type (except link)
const defaultFields: IFieldRo[] = [
  {
    name: FieldType.SingleLineText,
    type: FieldType.SingleLineText,
  },
  {
    name: FieldType.Number,
    type: FieldType.Number,
    options: {
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
    },
  },
  {
    name: FieldType.SingleSelect,
    type: FieldType.SingleSelect,
    options: {
      choices: [
        { name: 'todo', color: Colors.Yellow },
        { name: 'doing', color: Colors.Orange },
        { name: 'done', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.MultipleSelect,
    type: FieldType.MultipleSelect,
    options: {
      choices: [
        { name: 'rap', color: Colors.Yellow },
        { name: 'rock', color: Colors.Orange },
        { name: 'hiphop', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.Date,
    type: FieldType.Date,
    options: {
      formatting: {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'Asia/Singapore',
      },
    },
  },
  {
    name: FieldType.Attachment,
    type: FieldType.Attachment,
  },
];
describe('OpenAPI Record-Filter-Query (e2e)', () => {
  let app: INestApplication;
  let request: request.SuperAgentTest;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;
  });

  afterAll(async () => {
    await app.close();
  });

  async function getFilterRecord(tableId: string, viewId: string, filter: IFilter) {
    return (
      await request
        .get(`/api/table/${tableId}/record`)
        .query(
          qs.stringify({
            fieldKeyType: 'id',
            filter: filter,
          })
        )
        .expect(200)
    ).body;
  }

  function getFieldByType(fields: IFieldVo[], type: FieldType) {
    const field = fields.find((field) => field.type === type);
    if (!field) {
      throw new Error('field not found');
    }
    return field;
  }

  describe('simple record filter query', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      const result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table1]' })),
        })
        .expect(201);
      table = result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${table.id}`);
    });

    it('should isEmpty value', async () => {
      const fieldId = table.fields[0].id;

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: null,
            operator: 'isEmpty',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(3);
      expect(records).not.toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: expect.anything(),
          },
        }),
      ]);
    });

    it('should isNotEmpty value', async () => {
      const fieldId = table.fields[0].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 'string',
          },
        },
        {
          fields: {
            [fieldId]: 'string1',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: null,
            operator: 'isNotEmpty',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: expect.anything(),
            },
          }),
        ])
      );
    });

    it('should is value', async () => {
      const fieldId = table.fields[0].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 'string',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 'string',
            operator: 'is',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 'string',
          },
        }),
      ]);
    });

    it.each([
      { type: FieldType.SingleLineText, value: 'tom' },
      { type: FieldType.Number, value: 2 },
    ])('should isNot value - $type', async ({ type, value }) => {
      const fieldId = getFieldByType(table.fields, type).id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: value,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: value,
            operator: 'isNot',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(3);
      expect(records).not.toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 'tom',
          },
        }),
      ]);
    });

    it('should contains value', async () => {
      const fieldId = table.fields[0].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: '1dom1',
          },
        },
        {
          fields: {
            [fieldId]: '2dom2',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 'dom',
            operator: 'contains',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: '1dom1',
          },
        }),
        expect.objectContaining({
          fields: {
            [fieldId]: '2dom2',
          },
        }),
      ]);
    });

    it('should doesNotContain value', async () => {
      const fieldId = table.fields[0].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 'dom',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 'dom',
            operator: 'doesNotContain',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(3);
      expect(records).not.toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 'dom',
          },
        }),
      ]);
    });

    it('should isGreater value', async () => {
      const fieldId = table.fields[1].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 0,
          },
        },
        {
          fields: {
            [fieldId]: 1,
          },
        },
        {
          fields: {
            [fieldId]: 2,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 0,
            operator: 'isGreater',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 1,
          },
        }),
        expect.objectContaining({
          fields: {
            [fieldId]: 2,
          },
        }),
      ]);
    });

    it('should isGreaterEqual value', async () => {
      const fieldId = table.fields[1].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 2,
          },
        },
        {
          fields: {
            [fieldId]: 3,
          },
        },
        {
          fields: {
            [fieldId]: 4,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 3,
            operator: 'isGreaterEqual',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 3,
          },
        }),
        expect.objectContaining({
          fields: {
            [fieldId]: 4,
          },
        }),
      ]);
    });

    it('should isLess value', async () => {
      const fieldId = table.fields[1].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 7,
          },
        },
        {
          fields: {
            [fieldId]: 8,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 8,
            operator: 'isLess',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 7,
          },
        }),
      ]);
    });

    it('should isLessEqual value', async () => {
      const fieldId = table.fields[1].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 7,
          },
        },
        {
          fields: {
            [fieldId]: 8,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: 8,
            operator: 'isLessEqual',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 7,
          },
        }),
        expect.objectContaining({
          fields: {
            [fieldId]: 8,
          },
        }),
      ]);
    });

    it('should isAnyOf value', async () => {
      const fieldId = table.fields[2].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 'todo',
          },
        },
        {
          fields: {
            [fieldId]: 'doing',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['doing'],
            operator: 'isAnyOf',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: 'doing',
          },
        }),
      ]);
    });

    it('should isNoneOf value', async () => {
      const fieldId = table.fields[2].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: 'doing',
          },
        },
        {
          fields: {
            [fieldId]: 'done',
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['done'],
            operator: 'isNoneOf',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(4);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: expect.not.stringContaining('done'),
            },
          }),
        ])
      );
    });

    it('should hasAnyOf value', async () => {
      const fieldId = table.fields[3].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: ['rap'],
          },
        },
        {
          fields: {
            [fieldId]: ['rap', 'rock'],
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['rap'],
            operator: 'hasAnyOf',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: expect.arrayContaining(['rap']),
            },
          }),
        ])
      );
    });

    it('should hasAllOf value', async () => {
      const fieldId = table.fields[3].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: ['rap'],
          },
        },
        {
          fields: {
            [fieldId]: ['rap', 'rock'],
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['rock', 'rap'],
            operator: 'hasAllOf',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: ['rap', 'rock'],
            },
          }),
        ])
      );
    });

    it('should hasNoneOf value', async () => {
      const fieldId = table.fields[3].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: ['rap'],
          },
        },
        {
          fields: {
            [fieldId]: ['rock'],
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['rock'],
            operator: 'hasNoneOf',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(4);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: ['rap'],
            },
          }),
        ])
      );
    });

    it('should isExactly value', async () => {
      const fieldId = table.fields[3].id;
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: ['rap'],
          },
        },
        {
          fields: {
            [fieldId]: ['rock'],
          },
        },
        {
          fields: {
            [fieldId]: ['hiphop'],
          },
        },
        {
          fields: {
            [fieldId]: ['hiphop', 'rock', 'rap'],
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: ['rock', 'hiphop', 'rap'],
            operator: 'isExactly',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: ['hiphop', 'rock', 'rap'],
            },
          }),
        ])
      );
    });

    it('should isWithIn value', async () => {
      const fieldId = table.fields[4].id;
      const yesterday = new DateUtil('Asia/Singapore').offsetDay(-1).toISOString();
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: '2023-10-06T16:00:00.000Z',
          },
        },
        {
          fields: {
            [fieldId]: yesterday,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: {
              mode: 'pastNumberOfDays',
              numberOfDays: 1,
              timeZone: 'Asia/Singapore',
            },
            operator: 'isWithIn',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        expect.objectContaining({
          fields: {
            [fieldId]: yesterday,
          },
        }),
      ]);
    });

    it('should isBefore value', async () => {
      const fieldId = table.fields[4].id;
      const pastDate = faker.date.past({ years: 1 }).toISOString();
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: pastDate,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: {
              mode: 'today',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isBefore',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: pastDate,
            },
          }),
        ])
      );
    });

    it('should isAfter value', async () => {
      const fieldId = table.fields[4].id;
      const futureDate = faker.date.future({ years: 1 }).toISOString();
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: futureDate,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: {
              mode: 'exactDate',
              exactDate: new Date().toISOString(),
              timeZone: 'Asia/Singapore',
            },
            operator: 'isAfter',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: futureDate,
            },
          }),
        ])
      );
    });

    it('should isOnOrBefore value', async () => {
      const fieldId = table.fields[4].id;
      const nowDate = new Date().toISOString();
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: faker.date.past({ years: 1 }).toISOString(),
          },
        },
        {
          fields: {
            [fieldId]: nowDate,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: {
              mode: 'today',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isOnOrBefore',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: nowDate,
            },
          }),
        ])
      );
    });

    it('should isOnOrAfter value', async () => {
      const fieldId = table.fields[4].id;
      const nowDate = new Date().toISOString();
      await createRecords(request, table.id, [
        {
          fields: {
            [fieldId]: faker.date.future({ years: 1 }).toISOString(),
          },
        },
        {
          fields: {
            [fieldId]: nowDate,
          },
        },
      ]);

      const { records } = await getFilterRecord(table.id, table.views[0].id, {
        filterSet: [
          {
            fieldId: fieldId,
            value: {
              mode: 'today',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isOnOrAfter',
          },
        ],
        conjunction: 'and',
      });
      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: {
              [fieldId]: nowDate,
            },
          }),
        ])
      );
    });
  });

  describe('simple lookup value record filter query', () => {
    let lookupTable: ITableFullVo;
    let sourceTable: ITableFullVo;

    beforeEach(async () => {
      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: defaultFields,
          records: [
            {
              fields: {
                [FieldType.SingleLineText]: 'a1',
                [FieldType.Number]: 1,
                [FieldType.SingleSelect]: 'todo',
                [FieldType.MultipleSelect]: ['rap'],
                [FieldType.Date]: '2022-11-07T16:00:00.000Z',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a2',
                [FieldType.Number]: 2,
                [FieldType.SingleSelect]: 'doing',
                [FieldType.MultipleSelect]: ['rap', 'rock'],
                [FieldType.Date]: '2023-11-06T16:00:00.000Z',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a3',
                [FieldType.Number]: 3,
                [FieldType.SingleSelect]: 'done',
                [FieldType.MultipleSelect]: ['rock', 'hiphop'],
                [FieldType.Date]: '2023-11-05T16:00:00.000Z',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a4',
                [FieldType.Number]: 4,
                [FieldType.SingleSelect]: 'doing',
                [FieldType.MultipleSelect]: ['rap', 'rock', 'hiphop'],
                [FieldType.Date]: '2023-11-01T00:08:00.000Z',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a5',
                [FieldType.Number]: 5,
                [FieldType.SingleSelect]: 'doing',
                [FieldType.MultipleSelect]: ['rock', 'hiphop'],
                [FieldType.Date]: new DateUtil('Asia/Singapore').offsetDay(10).toISOString(),
              },
            },
          ],
        })
        .expect(201);
      sourceTable = createTable1Result.body;

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: sourceTable.id,
        },
      };

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [defaultFields[0], linkFieldRo],
        })
        .expect(201);
      lookupTable = createTable2Result.body;

      const { fields } = createTable2Result.body;
      const linkField = fields[1];

      for (const lookupField of defaultFields) {
        const { options } = lookupField as { options: any };
        const fieldRo = {
          name: `lookup ${lookupField.name} [${lookupTable.name}]`,
          type: lookupField.type,
          isLookup: true,
          options: options?.formatting
            ? {
                formatting: options.formatting,
              }
            : undefined,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: getFieldByType(createTable1Result.body.fields, lookupField.type).id,
          } as ILookupOptionsRo,
        };

        await createField(request, lookupTable.id, fieldRo);
      }

      const refreshTableData = await request
        .get(`/api/base/${baseId}/table/${lookupTable.id}`)
        .query({
          includeContent: true,
        })
        .expect(200);
      lookupTable = refreshTableData.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${sourceTable.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${lookupTable.id}`);
    });

    it('should is value', async () => {
      const fieldId = lookupTable.fields[0].id;
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[2].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [fieldId]: 'b1',
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [fieldId]: 'b2',
            [linkFieldId]: [{ id: sourceTable.records[1].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 'a1',
            operator: 'is',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['a1'],
          }),
        },
      ]);
    });

    it('should isNot value', async () => {
      const fieldId = lookupTable.fields[0].id;
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[2].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [fieldId]: 'b1',
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [fieldId]: 'b2',
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 'a3',
            operator: 'isNot',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(4);
      expect(records).not.toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: expect.arrayContaining(['a3']),
            }),
          }),
        ])
      );
    });

    it('should contains value', async () => {
      const fieldId = lookupTable.fields[0].id;
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[2].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [fieldId]: 'b1',
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [fieldId]: 'b2',
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 'a',
            operator: 'contains',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['a1', 'a2'],
          }),
        },
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['a3'],
          }),
        },
      ]);
    });

    it('should doesNotContain value', async () => {
      const fieldId = lookupTable.fields[0].id;
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[2].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [fieldId]: 'b1',
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [fieldId]: 'b2',
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 'a',
            operator: 'doesNotContain',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(3);
    });

    it('should isGreater value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[3].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 2,
            operator: 'isGreater',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [3],
          }),
        },
      ]);
    });

    it('should isGreaterEqual value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[3].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 2,
            operator: 'isGreaterEqual',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [1, 2],
          }),
        },
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [3],
          }),
        },
      ]);
    });

    it('should isLess value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[3].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }, { id: sourceTable.records[1].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 2,
            operator: 'isLess',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [1],
          }),
        },
      ]);
    });

    it('should isLessEqual value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = lookupTable.fields[3].id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }, { id: sourceTable.records[1].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: 2,
            operator: 'isLessEqual',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [1],
          }),
        },
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: [3, 2],
          }),
        },
      ]);
    });

    it('should isAnyOf value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.SingleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['doing', 'todo'],
            operator: 'isAnyOf',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['todo', 'doing'],
          }),
        },
      ]);
    });

    it('should isNoneOf value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.SingleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }, { id: sourceTable.records[3].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['done'],
            operator: 'isNoneOf',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(4);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: expect.not.arrayContaining(['done']),
            }),
          }),
        ])
      );
    });

    it('should hasAnyOf value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.MultipleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [
              { id: sourceTable.records[0].id },
              { id: sourceTable.records[1].id },
              { id: sourceTable.records[2].id },
            ],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[3].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['rap'],
            operator: 'hasAnyOf',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: expect.arrayContaining(['rap']),
            }),
          }),
        ])
      );
    });

    it('should hasAllOf value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.MultipleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[1].id }, { id: sourceTable.records[2].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[3].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['rap', 'hiphop'],
            operator: 'hasAllOf',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: expect.arrayContaining(['rap', 'hiphop']),
            }),
          }),
        ])
      );
    });

    it('should hasNoneOf value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.MultipleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[3].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['rap'],
            operator: 'hasNoneOf',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(4);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: expect.not.arrayContaining(['rap']),
            }),
          }),
        ])
      );
    });

    it('should isExactly value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.MultipleSelect).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[3].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: ['rap'],
            operator: 'isExactly',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['rap'],
          }),
        },
      ]);
    });

    it('should isWithIn value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.Date).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }, { id: sourceTable.records[3].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[4].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: {
              mode: 'nextNumberOfDays',
              numberOfDays: 10,
              timeZone: 'Asia/Singapore',
            },
            operator: 'isWithIn',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
    });

    it('should isBefore value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.Date).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: {
              mode: 'exactDate',
              exactDate: '2023-11-07T00:00:00.000Z',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isBefore',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(2);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: ['2023-11-05T16:00:00.000Z'],
            }),
          }),
        ])
      );
    });

    it('should isAfter value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.Date).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[3].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: {
              mode: 'exactDate',
              exactDate: '2023-11-01T00:00:00.000Z',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isAfter',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject([
        {
          fields: expect.objectContaining({
            [queryLookupFieldId]: ['2023-11-05T16:00:00.000Z'],
          }),
        },
      ]);
    });

    it('should isOnOrBefore value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.Date).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: {
              mode: 'exactDate',
              exactDate: '2023-11-05T00:00:00.000Z',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isOnOrBefore',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(1);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: ['2022-11-07T16:00:00.000Z', '2023-11-06T16:00:00.000Z'],
            }),
          }),
        ])
      );
    });

    it('should isOnOrAfter value', async () => {
      const linkFieldId = lookupTable.fields[1].id;
      const queryLookupFieldId = getFieldByType(lookupTable.fields, FieldType.Date).id;
      await createRecords(request, lookupTable.id, [
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[0].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[1].id }],
          },
        },
        {
          fields: {
            [linkFieldId]: [{ id: sourceTable.records[2].id }],
          },
        },
      ]);

      const { records } = await getFilterRecord(lookupTable.id, lookupTable.views[0].id, {
        filterSet: [
          {
            fieldId: queryLookupFieldId,
            value: {
              mode: 'exactDate',
              exactDate: '2022-11-07T00:00:00.000Z',
              timeZone: 'Asia/Singapore',
            },
            operator: 'isOnOrAfter',
          },
        ],
        conjunction: 'and',
      });

      expect(records.length).toStrictEqual(3);
      expect(records).toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            fields: expect.objectContaining({
              [queryLookupFieldId]: ['2022-11-07T16:00:00.000Z'],
            }),
          }),
        ])
      );
    });
  });

  describe('link field record filter query', () => {
    let linkTable: ITableFullVo;
    let sourceTable: ITableFullVo;

    beforeEach(async () => {
      const createTable1Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table1',
          fields: defaultFields,
          records: [
            {
              fields: {
                [FieldType.SingleLineText]: 'a1',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a2',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a3',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a4',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'a5',
              },
            },
            {
              fields: {
                [FieldType.SingleLineText]: 'other',
              },
            },
          ],
        })
        .expect(201);
      sourceTable = createTable1Result.body;

      const linkFieldRo1: IFieldRo = {
        name: 'link field(ManyOne)',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: sourceTable.id,
        },
      };

      const linkFieldRo2: IFieldRo = {
        name: 'link field(OneMany)',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: sourceTable.id,
        },
      };

      const createTable2Result = await request
        .post(`/api/base/${baseId}/table`)
        .send({
          name: 'table2',
          fields: [defaultFields[0], linkFieldRo1, linkFieldRo2],
        })
        .expect(201);
      linkTable = createTable2Result.body;
    });

    afterEach(async () => {
      await request.delete(`/api/base/${baseId}/table/arbitrary/${sourceTable.id}`);
      await request.delete(`/api/base/${baseId}/table/arbitrary/${linkTable.id}`);
    });

    describe('link(ManyOne)', () => {
      it('should is value', async () => {
        const fieldId = linkTable.fields[0].id;
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [fieldId]: 'b1',
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [fieldId]: 'b2',
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: sourceTable.records[0].id,
              operator: 'is',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(1);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({
                title: 'a1',
              }),
            }),
          },
        ]);
      });

      it('should isNot value', async () => {
        const fieldId = linkTable.fields[0].id;
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [fieldId]: 'b1',
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [fieldId]: 'b2',
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: sourceTable.records[0].id,
              operator: 'isNot',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(4);
        expect(records).not.toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({
                id: sourceTable.records[0].id,
              }),
            }),
          },
        ]);
      });

      it('should contains value', async () => {
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[5].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: 'a',
              operator: 'contains',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(2);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({ title: 'a1' }),
            }),
          },
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({ title: 'a2' }),
            }),
          },
        ]);
      });

      it('should doesNotContain value', async () => {
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[5].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: 'a',
              operator: 'doesNotContain',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(4);
        expect(records).toMatchObject(
          expect.arrayContaining([
            expect.objectContaining({
              fields: expect.objectContaining({
                [linkFieldId]: expect.objectContaining({ title: expect.not.stringMatching('a') }),
              }),
            }),
          ])
        );
      });

      it('should isAnyOf value', async () => {
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[5].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[0].id, sourceTable.records[1].id],
              operator: 'isAnyOf',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(2);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({ title: 'a1' }),
            }),
          },
          {
            fields: expect.objectContaining({
              [linkFieldId]: expect.objectContaining({ title: 'a2' }),
            }),
          },
        ]);
      });

      it('should isNoneOf value', async () => {
        const linkFieldId = linkTable.fields[1].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[0].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[1].id },
            },
          },
          {
            fields: {
              [linkFieldId]: { id: sourceTable.records[5].id },
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[0].id, sourceTable.records[1].id],
              operator: 'isNoneOf',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(4);
        expect(records).not.toMatchObject(
          expect.arrayContaining([
            expect.objectContaining({
              fields: expect.objectContaining({
                [linkFieldId]: expect.objectContaining({ id: sourceTable.records[0].id }),
              }),
            }),
            expect.objectContaining({
              fields: expect.objectContaining({
                [linkFieldId]: expect.objectContaining({ id: sourceTable.records[1].id }),
              }),
            }),
          ])
        );
      });
    });

    describe('link(OneMany)', () => {
      it('should hasAnyOf value', async () => {
        const linkFieldId = linkTable.fields[2].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
            },
          },
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[5].id }],
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[0].id, sourceTable.records[1].id],
              operator: 'hasAnyOf',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(1);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: [
                expect.objectContaining({ title: 'a1' }),
                expect.objectContaining({ title: 'a2' }),
              ],
            }),
          },
        ]);
      });

      it('should hasNoneOf value', async () => {
        const linkFieldId = linkTable.fields[2].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
            },
          },
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[5].id }],
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[0].id, sourceTable.records[1].id],
              operator: 'hasNoneOf',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(4);
        expect(records).not.toMatchObject(
          expect.arrayContaining([
            {
              fields: expect.objectContaining({
                [linkFieldId]: expect.objectContaining({
                  id: sourceTable.records[0].id,
                }),
              }),
            },
            {
              fields: expect.objectContaining({
                [linkFieldId]: expect.objectContaining({
                  id: sourceTable.records[1].id,
                }),
              }),
            },
          ])
        );
      });

      it('should hasAllOf value', async () => {
        const linkFieldId = linkTable.fields[2].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
            },
          },
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[5].id }],
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[0].id, sourceTable.records[1].id],
              operator: 'hasAllOf',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(1);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: [
                expect.objectContaining({ id: sourceTable.records[0].id }),
                expect.objectContaining({ id: sourceTable.records[1].id }),
              ],
            }),
          },
        ]);
      });

      it('should isExactly value', async () => {
        const linkFieldId = linkTable.fields[2].id;
        await createRecords(request, linkTable.id, [
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[0].id }, { id: sourceTable.records[1].id }],
            },
          },
          {
            fields: {
              [linkFieldId]: [{ id: sourceTable.records[5].id }],
            },
          },
        ]);

        const { records } = await getFilterRecord(linkTable.id, linkTable.views[0].id, {
          filterSet: [
            {
              fieldId: linkFieldId,
              value: [sourceTable.records[5].id],
              operator: 'isExactly',
            },
          ],
          conjunction: 'and',
        });

        expect(records.length).toStrictEqual(1);
        expect(records).toMatchObject([
          {
            fields: expect.objectContaining({
              [linkFieldId]: [expect.objectContaining({ id: sourceTable.records[5].id })],
            }),
          },
        ]);
      });
    });
  });
});
