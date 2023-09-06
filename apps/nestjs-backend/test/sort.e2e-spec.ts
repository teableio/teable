/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IFieldVo, ITableFullVo, IFieldRo, ISortItem } from '@teable-group/core';
import { FieldType, CellValueType, TimeFormatting } from '@teable-group/core';
import { orderBy } from 'lodash';
import qs from 'qs';
import type * as supertest from 'supertest';
import { initApp, updateRecordByApi } from './utils/init-app';

const randomGenerator = () => {
  return Math.round(Math.random() * 1000);
};

// cellValueType which need to test
const typeTests = [
  {
    type: CellValueType.String,
    valueGenerateFn: () => `String_${randomGenerator()}`,
  },
  {
    type: CellValueType.Number,
    valueGenerateFn: () => randomGenerator(),
  },
  {
    type: CellValueType.DateTime,
    valueGenerateFn: () => +new Date() + 60 * 60 * 24 * 1000 * randomGenerator(),
  },
  {
    type: CellValueType.Boolean,
    valueGenerateFn: () => (randomGenerator() % 2 ? false : true),
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

const getSortRecords = async (tableId: string, orderBy: ISortItem[] = []) => {
  const result = await request
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

  return result.body.records;
};

const setRecordsOrder = async (tableId: string, viewId: string, orderBy: ISortItem[]) => {
  await request
    .post(`/api/table/${tableId}/view/${viewId}/sort`)
    .send({
      sortObjs: orderBy,
    })
    .expect(201);
};

let app: INestApplication;
let request: supertest.SuperAgentTest;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
  request = appCtx.request;
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI RecordController sort (e2e) base cellValueType', () => {
  let subTable: ITableFullVo;
  let subTableId = '';
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    const result2 = await request
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body;
    subTableId = result2.body?.id;

    const fieldsResult2 = await request.get(`/api/table/${subTableId}/field`).expect(200);
    fields2 = fieldsResult2.body;
  });

  afterEach(async () => {
    const result2 = await request.delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
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
          request,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn()
        );
      }

      const ascOrders: ISortItem[] = [{ fieldId, order: 'asc' }];
      const descOrders: ISortItem[] = [{ fieldId, order: 'desc' }];
      const ascOriginRecords = await getSortRecords(subTableId, ascOrders);
      const descOriginRecords = await getSortRecords(subTableId, descOrders);

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
  let mainTable: ITableFullVo;
  let subTable: ITableFullVo;
  let mainTableId = '';
  let subTableId = '';
  let fields1: IFieldVo[] = [];
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    // create two table
    const result1 = await request
      .post('/api/table')
      .send({
        name: 'mainTable',
      })
      .expect(201);
    mainTable = result1.body;
    mainTableId = result1.body?.id;

    const result2 = await request
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body;
    subTableId = result2.body?.id;

    const fieldsResult2 = await request.get(`/api/table/${subTableId}/field`).expect(200);
    fields2 = fieldsResult2.body;

    // create link
    await request
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

    const fieldsResult1 = await request.get(`/api/table/${mainTableId}/field`).expect(200);
    fields1 = fieldsResult1.body;
  });

  afterEach(async () => {
    const result1 = await request.delete(`/api/table/arbitrary/${mainTableId}`);
    console.log('clear mainTable: ', result1.body);

    const result2 = await request.delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
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
          request,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn()
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const linkField = fields1.find((field) => field.type === 'link')!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lookupField = fields2.find((field) => field.cellValueType === type)!;
      const lookupRes = await request
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
      const lookupFieldId = lookupRes.body?.id;
      const lookupFieldIdName = lookupRes.body.name;

      // link records
      for (let i = 0; i < 3; i++) {
        await updateRecordByApi(request, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      const ascOriginRecords = await getSortRecords(mainTableId, ascOrders);
      const descOriginRecords = await getSortRecords(mainTableId, descOrders);

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

describe('OpenAPI ViewController raw order sort (e2e) base cellValueType', () => {
  let subTable: ITableFullVo;
  let subTableId = '';
  let subTableDefaultViewId = '';
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    const result2 = await request
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body;
    subTableId = result2.body?.id;
    subTableDefaultViewId = result2.body?.defaultViewId;

    const fieldsResult2 = await request.get(`/api/table/${subTableId}/field`).expect(200);
    fields2 = fieldsResult2.body;
  });

  afterEach(async () => {
    const result2 = await request.delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  for (let i = 0; i < typeTests.length; i++) {
    const currentTestInfo = typeTests[i];
    const { valueGenerateFn, type } = currentTestInfo;
    // cellValueType tests
    it(`/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: ${type}`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId, name } = field!;
      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          request,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn()
        );
      }

      const ascOrders: ISortItem[] = [{ fieldId, order: 'asc' }];
      await setRecordsOrder(subTableId, subTableDefaultViewId, ascOrders);
      const ascOriginRecords = await getSortRecords(subTableId);
      const descOrders: ISortItem[] = [{ fieldId, order: 'desc' }];
      await setRecordsOrder(subTableId, subTableDefaultViewId, descOrders);
      const descOriginRecords = await getSortRecords(subTableId);

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

describe('OpenAPI ViewController raw order sort (e2e) Multiple CellValueType', () => {
  let mainTable: ITableFullVo;
  let subTable: ITableFullVo;
  let mainTableId = '';
  let mainDefaultViewId = '';
  let subTableId = '';
  let fields1: IFieldVo[] = [];
  let fields2: IFieldVo[] = [];

  beforeEach(async () => {
    // create two table
    const result1 = await request
      .post('/api/table')
      .send({
        name: 'mainTable',
      })
      .expect(201);
    mainTable = result1.body;
    mainTableId = result1.body?.id;
    mainDefaultViewId = result1.body?.defaultViewId;

    const result2 = await request
      .post('/api/table')
      .send({
        name: 'subTable',
        fields: defaultFields.map((f) => ({ ...f, name: f.name })),
      })
      .expect(201);
    subTable = result2.body;
    subTableId = result2.body?.id;

    const fieldsResult2 = await request.get(`/api/table/${subTableId}/field`).expect(200);
    fields2 = fieldsResult2.body;

    // create link
    await request
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

    const fieldsResult1 = await request.get(`/api/table/${mainTableId}/field`).expect(200);
    fields1 = fieldsResult1.body;
  });

  afterEach(async () => {
    const result1 = await request.delete(`/api/table/arbitrary/${mainTableId}`);
    console.log('clear mainTable: ', result1.body);

    const result2 = await request.delete(`/api/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  for (let i = 0; i < typeTests.length; i++) {
    const currentTestInfo = typeTests[i];
    const { valueGenerateFn, type } = currentTestInfo;
    // multiple cellValueType tests
    it(`/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: ${type}:Multiple`, async () => {
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId } = field!;

      // write content
      for (let i = 0; i < subTable.records.length; i++) {
        await updateRecordByApi(
          request,
          subTableId,
          subTable.records[i].id,
          fieldId,
          valueGenerateFn()
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const linkField = fields1.find((field) => field.type === 'link')!;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const lookupField = fields2.find((field) => field.cellValueType === type)!;
      const lookupRes = await request
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
      const lookupFieldId = lookupRes.body?.id;
      const lookupFieldIdName = lookupRes.body.name;

      // link records
      for (let i = 0; i < 3; i++) {
        await updateRecordByApi(request, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      await setRecordsOrder(mainTableId, mainDefaultViewId, ascOrders);
      const ascOriginRecords = await getSortRecords(mainTableId);
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      await setRecordsOrder(mainTableId, mainDefaultViewId, descOrders);
      const descOriginRecords = await getSortRecords(mainTableId);

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
