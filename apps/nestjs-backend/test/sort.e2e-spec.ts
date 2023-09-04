/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ITableFullVo, IFieldRo } from '@teable-group/core';
import { FieldType, CellValueType, TimeFormatting } from '@teable-group/core';
import { orderBy } from 'lodash';
import qs from 'qs';
import request from 'supertest';
import { initApp, updateRecordByApi } from './utils/init-app';

const typeTests = [
  {
    type: CellValueType.String,
    valueFormula: (i: number) => `String_${i}`,
  },
  {
    type: CellValueType.Number,
    valueFormula: (i: number) => i,
  },
  {
    type: CellValueType.DateTime,
    valueFormula: (i: number) => +new Date() + i * 60 * 60 * 24 * 1000,
  },
  {
    type: CellValueType.Boolean,
    valueFormula: (i: number) => (i % 2 ? false : true),
  },
];

// some fieldType need
const defaultFields: IFieldRo[] = [
  {
    name: FieldType.SingleLineText,
    type: FieldType.SingleLineText,
    options: {},
  },
  {
    name: FieldType.Number,
    type: FieldType.Number,
    options: {
      formatting: {
        precision: 2,
      },
    },
  },
  {
    name: FieldType.Checkbox,
    type: FieldType.Checkbox,
    options: {},
  },
  {
    name: FieldType.Date,
    type: FieldType.Date,
    options: {
      formatting: {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'America/New_York',
      },
      defaultValue: 'now',
    },
  },
];

describe('OpenAPI RecordController sort (e2e)', () => {
  let app: INestApplication;
  let mainTable: ITableFullVo;
  let subTable: ITableFullVo;
  let mainTableId = '';
  let subTableId = '';
  let fields1: IFieldVo[] = [];
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    app = await initApp();

    // create two table
    const result1 = await request(app.getHttpServer())
      .post('/api/table')
      .send({
        name: 'mainTable',
      })
      .expect(201);
    mainTable = result1.body.data;
    mainTableId = result1.body.data?.id;

    const result2 = await request(app.getHttpServer())
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body.data;
    subTableId = result2.body.data?.id;

    const fieldsResult2 = await request(app.getHttpServer())
      .get(`/api/table/${subTableId}/field`)
      .expect(200);
    fields2 = fieldsResult2.body.data;

    // create link
    await request(app.getHttpServer())
      .post(`/api/table/${mainTableId}/field`)
      .send({
        name: 'link',
        options: {
          foreignTableId: subTableId,
          relationship: 'oneMany',
        },
        type: 'link',
      })
      .expect(201);

    const fieldsResult1 = await request(app.getHttpServer())
      .get(`/api/table/${mainTableId}/field`)
      .expect(200);
    fields1 = fieldsResult1.body.data;
  });

  afterEach(async () => {
    const result1 = await request(app.getHttpServer()).delete(
      `/api/table/arbitrary/${mainTableId}`
    );
    console.log('clear mainTable: ', result1.body);

    const result2 = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);

    await app.close();
  });

  for (let i = 0; i < typeTests.length; i++) {
    const currentTestInfo = typeTests[i];
    const { valueFormula, type } = currentTestInfo;

    // cellValueType tests
    it(`/api/table/{tableId}/record sort (GET) Test CellValueType: ${type}`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      const { id: fieldId, name } = field!;
      // write string content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(app, subTableId, subTable.records[i].id, fieldId, valueFormula(i));
      }
      const ascResult = await request(app.getHttpServer())
        .get(`/api/table/${subTableId}/record`)
        .query(
          qs.stringify(
            {
              orderBy: [{ fieldId, order: 'asc' }],
            },
            { arrayFormat: 'brackets' }
          )
        )
        .expect(200);
      const descResult = await request(app.getHttpServer())
        .get(`/api/table/${subTableId}/record`)
        .query(
          qs.stringify(
            {
              orderBy: [{ fieldId, order: 'desc' }],
            },
            { arrayFormat: 'brackets' }
          )
        )
        .expect(200);
      const ascOriginRecords = [...ascResult.body.data.records];
      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[name] === undefined) return -1;
          return item?.fields?.[name];
        },
        'asc'
      );

      const descOriginRecords = [...descResult.body.data.records];
      const descManualSortRecords = orderBy(
        [...descOriginRecords],
        (item) => {
          if (item?.fields?.[name] === undefined) return -1;
          return item?.fields?.[name];
        },
        'desc'
      );
      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    });

    // multiple cellValueType tests
    it(`/api/table/{tableId}/record sort (GET) Test CellValueType: ${type}:Multiple`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      const { id: fieldId } = field!;

      // write string content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(app, subTableId, subTable.records[i].id, fieldId, valueFormula(i));
      }
      const linkField = fields1.find((field) => field.type === 'link')!;
      const lookupField = fields2.find((field) => field.cellValueType === type)!;
      const lookupRes = await request(app.getHttpServer())
        .post(`/api/table/${mainTableId}/field`)
        .send({
          isLookup: true,
          name: `lookup_${type}`,
          lookupOptions: {
            foreignTableId: subTableId,
            linkFieldId: linkField.id,
            lookupFieldId: lookupField.id,
          },
          type: lookupField.type,
        })
        .expect(201);
      const lookupFieldId = lookupRes.body.data?.id;
      const lookipFieldIdName = lookupRes.body.data.name;

      // link records
      for (let i = 0; i < 3; i++) {
        await updateRecordByApi(app, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascResult = await request(app.getHttpServer())
        .get(`/api/table/${mainTableId}/record`)
        .query(
          qs.stringify(
            {
              orderBy: [{ fieldId: lookupFieldId, order: 'asc' }],
            },
            { arrayFormat: 'brackets' }
          )
        )
        .expect(200);

      const descResult = await request(app.getHttpServer())
        .get(`/api/table/${mainTableId}/record`)
        .query(
          qs.stringify(
            {
              orderBy: [{ fieldId: lookupFieldId, order: 'desc' }],
            },
            { arrayFormat: 'brackets' }
          )
        )
        .expect(200);

      // compare the result asc
      const ascOriginRecords = [...ascResult.body.data.records];
      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[lookipFieldIdName] === undefined) return -1;
          return item?.fields?.[lookipFieldIdName];
        },
        'asc'
      );

      // compare the result desc
      const descOriginRecords = [...descResult.body.data.records];
      const descManualSortRecords = orderBy(
        [...descOriginRecords],
        (item) => {
          if (item?.fields?.[lookipFieldIdName] === undefined) return -1;
          return item?.fields?.[lookipFieldIdName];
        },
        'desc'
      );

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    });
  }
});
