/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ITableFullVo, IFieldRo, ISortItem } from '@teable-group/core';
import { FieldType, CellValueType, TimeFormatting } from '@teable-group/core';
import { orderBy } from 'lodash';
import qs from 'qs';
import request from 'supertest';
import { initApp, updateRecordByApi } from './utils/init-app';

// cellValueType which need to test
const typeTests = [
  {
    type: CellValueType.String,
    valueGenerateFn: (i: number) => `String_${i}`,
  },
  {
    type: CellValueType.Number,
    valueGenerateFn: (i: number) => i,
  },
  {
    type: CellValueType.DateTime,
    valueGenerateFn: (i: number) => +new Date() + i * 60 * 60 * 24 * 1000,
  },
  {
    type: CellValueType.Boolean,
    valueGenerateFn: (i: number) => (i % 2 ? false : true),
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

const getSortRecords = async (
  app: INestApplication,
  tableId: string,
  orderBy: ISortItem[] = []
) => {
  const result = await request(app.getHttpServer())
    .get(`/api/table/${tableId}/record`)
    .query(
      qs.stringify(
        {
          orderBy: orderBy,
        },
        { arrayFormat: 'brackets' }
      )
    )
    .expect(200);

  return result.body.data.records;
};

const setRecordsOrder = async (
  app: INestApplication,
  tableId: string,
  viewId: string,
  orderBy: ISortItem[]
) => {
  await request(app.getHttpServer())
    .post(`/api/table/${tableId}/view/${viewId}/sort`)
    .send({
      sortObjs: orderBy,
    })
    .expect(201);
};

describe('OpenAPI RecordController sort (e2e) base cellValueType', () => {
  let app: INestApplication;
  let subTable: ITableFullVo;
  let subTableId = '';
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    app = await initApp();

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
  });

  afterEach(async () => {
    const result2 = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);

    await app.close();
  });

  for (let i = 0; i < typeTests.length; i++) {
    const currentTestInfo = typeTests[i];
    const { valueGenerateFn, type } = currentTestInfo;
    // cellValueType tests
    it(`/api/table/{tableId}/record sort (GET) Test CellValueType: ${type}`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId, name } = field!;
      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          app,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn(i)
        );
      }

      const ascOrders: ISortItem[] = [{ fieldId, order: 'asc' }];
      const descOrders: ISortItem[] = [{ fieldId, order: 'desc' }];
      const ascOriginRecords = await getSortRecords(app, subTableId, ascOrders);
      const descOriginRecords = await getSortRecords(app, subTableId, descOrders);

      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[name] === undefined) return -1;
          return item?.fields?.[name];
        },
        'asc'
      );
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
  }
});

describe('OpenAPI RecordController sort (e2e) Multiple CellValueType', () => {
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
    const { valueGenerateFn, type } = currentTestInfo;
    // multiple cellValueType tests
    it(`/api/table/{tableId}/record sort (GET) Test CellValueType: ${type}:Multiple`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId } = field!;

      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          app,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn(i)
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const linkField = fields1.find((field) => field.type === 'link')!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
      const lookupFieldIdName = lookupRes.body.data.name;

      // link records
      for (let i = 0; i < 3; i++) {
        await updateRecordByApi(app, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      const ascOriginRecords = await getSortRecords(app, mainTableId, ascOrders);
      const descOriginRecords = await getSortRecords(app, mainTableId, descOrders);

      // compare the result asc
      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[lookupFieldIdName] === undefined) return -1;
          return item?.fields?.[lookupFieldIdName];
        },
        'asc'
      );

      // compare the result desc
      const descManualSortRecords = orderBy(
        [...descOriginRecords],
        (item) => {
          if (item?.fields?.[lookupFieldIdName] === undefined) return -1;
          return item?.fields?.[lookupFieldIdName];
        },
        'desc'
      );

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    });
  }
});

describe('OpenAPI ViewController hardSort (e2e) base cellValueType', () => {
  let app: INestApplication;
  let subTable: ITableFullVo;
  let subTableId = '';
  let subTableDefaultViewId = '';
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    app = await initApp();

    const result2 = await request(app.getHttpServer())
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body.data;
    subTableId = result2.body.data?.id;
    subTableDefaultViewId = result2.body.data?.defaultViewId;

    const fieldsResult2 = await request(app.getHttpServer())
      .get(`/api/table/${subTableId}/field`)
      .expect(200);
    fields2 = fieldsResult2.body.data;
  });

  afterEach(async () => {
    const result2 = await request(app.getHttpServer()).delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);

    await app.close();
  });

  for (let i = 0; i < typeTests.length; i++) {
    const currentTestInfo = typeTests[i];
    const { valueGenerateFn, type } = currentTestInfo;
    // cellValueType tests
    it(`/api/table/{tableId}/record hardSort (Post) Test CellValueType: ${type}`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId, name } = field!;
      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          app,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn(i)
        );
      }

      const ascOrders: ISortItem[] = [{ fieldId, order: 'asc' }];
      await setRecordsOrder(app, subTableId, subTableDefaultViewId, ascOrders);
      const ascOriginRecords = await getSortRecords(app, subTableId);
      const descOrders: ISortItem[] = [{ fieldId, order: 'desc' }];
      await setRecordsOrder(app, subTableId, subTableDefaultViewId, descOrders);
      const descOriginRecords = await getSortRecords(app, subTableId);

      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[name] === undefined) return -1;
          return item?.fields?.[name];
        },
        'asc'
      );
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
  }
});

describe('OpenAPI ViewController hardSort (e2e) Multiple CellValueType', () => {
  let app: INestApplication;
  let mainTable: ITableFullVo;
  let subTable: ITableFullVo;
  let mainTableId = '';
  let mainDefaultViewId = '';
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
    mainDefaultViewId = result1.body.data?.defaultViewId;

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
    const { valueGenerateFn, type } = currentTestInfo;
    // multiple cellValueType tests
    it(`/api/table/{tableId}/record sort (GET) Test CellValueType: ${type}:Multiple`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId } = field!;

      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          app,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn(i)
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const linkField = fields1.find((field) => field.type === 'link')!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
      const lookupFieldIdName = lookupRes.body.data.name;

      // link records
      for (let i = 0; i < 3; i++) {
        await updateRecordByApi(app, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      await setRecordsOrder(app, mainTableId, mainDefaultViewId, ascOrders);
      const ascOriginRecords = await getSortRecords(app, mainTableId);
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      await setRecordsOrder(app, mainTableId, mainDefaultViewId, descOrders);
      const descOriginRecords = await getSortRecords(app, mainTableId);

      const ascManualSortRecords = orderBy(
        [...ascOriginRecords],
        (item) => {
          if (item?.fields?.[lookupFieldIdName] === undefined) return -1;
          return item?.fields?.[lookupFieldIdName];
        },
        'asc'
      );

      const descManualSortRecords = orderBy(
        [...descOriginRecords],
        (item) => {
          if (item?.fields?.[lookupFieldIdName] === undefined) return -1;
          return item?.fields?.[lookupFieldIdName];
        },
        'desc'
      );

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    });
  }
});
