/* eslint-disable sonarjs/no-duplicate-string */
import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';

import type { ITableFullVo, IFieldRo, ISortItem } from '@teable-group/core';
import { FieldType, CellValueType, TimeFormatting, NumberFormattingType } from '@teable-group/core';
import { orderBy, isEmpty } from 'lodash';
import qs from 'qs';
import type * as supertest from 'supertest';
import { initApp, updateRecordByApi } from './utils/init-app';

let app: INestApplication;
let request: supertest.SuperAgentTest;
const baseId = globalThis.testConfig.baseId;

// cellValueType which need to test
const typeTests = [
  {
    type: CellValueType.String,
    valueGenerateFn: () => faker.string.numeric(5),
  },
  {
    type: CellValueType.Number,
    valueGenerateFn: () => faker.number.int(),
  },
  {
    type: CellValueType.DateTime,
    valueGenerateFn: () => faker.date.anytime(),
  },
  {
    type: CellValueType.Boolean,
    valueGenerateFn: () => faker.datatype.boolean() || null,
  },
];

// some fieldType need
const defaultFields: IFieldRo[] = [
  {
    name: CellValueType.String,
    type: FieldType.SingleLineText,
    options: {},
  },
  {
    name: CellValueType.Number,
    type: FieldType.Number,
    options: {
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
    },
  },
  {
    name: CellValueType.Boolean,
    type: FieldType.Checkbox,
    options: {},
  },
  {
    name: CellValueType.DateTime,
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

// api aggregation
const fillTable = async (tableId: string, fieldName: string, length: number) => {
  if (!length) {
    return [];
  }

  const records = Array.from({ length: length }).map((_, i) => ({
    fields: {
      [fieldName]: `String_${i}`,
    },
  }));

  const res = await request
    .post(`/api/table/${tableId}/record`)
    .send({
      records,
    })
    .expect(201);

  return res?.body?.records || [];
};

const createTableWithExtraRec = async (tableName: string, recordsLength = 10) => {
  const result = await request
    .post(`/api/base/${baseId}/table`)
    .send({
      name: tableName,
      fields: defaultFields.map((f) => ({ ...f, name: f.name })),
    })
    .expect(201);

  const { id, fields, defaultViewId, records } = result.body;
  const newRecords = await fillTable(id, fields[0].name, recordsLength);

  return {
    id,
    fields,
    defaultViewId,
    records: records.concat(newRecords),
  };
};

const createLink = async (mainTableId: string, subTableId: string) => {
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
};

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
    .put(`/api/table/${tableId}/view/${viewId}/sort`)
    .send({
      sortObjs: orderBy,
    })
    .expect(200);
};

const getRecordsByOrder = (
  records: ITableFullVo['records'],
  conditions: ISortItem[],
  fields: ITableFullVo['fields']
) => {
  if (Array.isArray(records) && !records.length) return [];
  const fns = conditions.map((condition) => {
    const { fieldId } = condition;
    const field = fields.find((field) => field.id === fieldId) as ITableFullVo['fields'][number];
    const { name, isMultipleCellValue } = field;
    return (record: ITableFullVo['records'][number]) => {
      if (isEmpty(record?.fields?.[name])) {
        return -Infinity;
      }
      if (isMultipleCellValue) {
        return JSON.stringify(record?.fields?.[name]);
      }
    };
  });
  const orders = conditions.map((condition) => condition.order || 'asc');
  return orderBy([...records], fns, orders);
};

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
  request = appCtx.request;
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI RecordController sort (e2e) base cellValueType', () => {
  let subTable: Pick<ITableFullVo, 'id' | 'records' | 'fields' | 'defaultViewId'>;

  beforeAll(async () => {
    subTable = await createTableWithExtraRec('subTable', 10);
  });

  afterAll(async () => {
    const { id: subTableId } = subTable;
    const result2 = await request.delete(`/api/base/${baseId}/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/record sort (GET) Test CellValueType: $type`,
    async ({ type, valueGenerateFn }) => {
      const { id: subTableId, fields: fields2, records: subRecords } = subTable;
      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId } = field!;
      // write content
      for (let i = 0; i < subRecords.length; i++) {
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

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});

describe('OpenAPI RecordController sort (e2e) Multiple CellValueType', () => {
  let mainTable: Pick<ITableFullVo, 'id' | 'records' | 'fields' | 'defaultViewId'>;
  let subTable: Pick<ITableFullVo, 'id' | 'records' | 'fields' | 'defaultViewId'>;

  beforeAll(async () => {
    mainTable = await createTableWithExtraRec('mainTable', 10);
    subTable = await createTableWithExtraRec('subTable', 10);

    const { id: mainTableId } = mainTable;
    const { id: subTableId } = subTable;

    await createLink(mainTableId, subTableId);

    const fieldsResult1 = await request.get(`/api/table/${mainTableId}/field`).expect(200);
    mainTable.fields = fieldsResult1.body;
  });

  afterAll(async () => {
    const { id: mainTableId } = mainTable;
    const { id: subTableId } = subTable;

    const result1 = await request.delete(`/api/base/${baseId}/table/arbitrary/${mainTableId}`);
    console.log('clear mainTable: ', result1.body);

    const result2 = await request.delete(`/api/base/${baseId}/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/record sort (GET) Test CellValueType: $type - Multiple`,
    async ({ type, valueGenerateFn }) => {
      const { id: mainTableId, fields: fields1 } = mainTable;
      const { id: subTableId, fields: fields2, records: subRecords } = subTable;

      const field = fields2.find((field) => field.cellValueType === type);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { id: fieldId } = field!;

      // write content
      for (let i = 0; i < subRecords.length; i++) {
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
      fields1.push(lookupRes.body);
      const lookupFieldId = lookupRes.body?.id;

      // link records
      for (let i = 0; i < subRecords.length; i++) {
        await updateRecordByApi(request, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      const ascOriginRecords = await getSortRecords(mainTableId, ascOrders);
      const descOriginRecords = await getSortRecords(mainTableId, descOrders);

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields1);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields1);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});

describe('OpenAPI ViewController raw order sort (e2e) base cellValueType', () => {
  let subTable: Pick<ITableFullVo, 'id' | 'records' | 'fields'> & { defaultViewId: string };

  beforeEach(async () => {
    subTable = await createTableWithExtraRec('subTable', 10);
  });

  afterEach(async () => {
    const { id: subTableId } = subTable;
    const result2 = await request.delete(`/api/base/${baseId}/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: $type`,
    async ({ type, valueGenerateFn }) => {
      const {
        id: subTableId,
        fields: fields2,
        records: subRecords,
        defaultViewId: subTableDefaultViewId,
      } = subTable;
      const field = fields2.find(
        (field) => field.cellValueType === type
      ) as ITableFullVo['fields'][number];
      const { id: fieldId } = field;

      for (let i = 0; i < subRecords.length; i++) {
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

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});

describe('OpenAPI ViewController raw order sort (e2e) Multiple CellValueType', () => {
  let mainTable: Pick<ITableFullVo, 'id' | 'records' | 'fields' | 'defaultViewId'>;
  let subTable: Pick<ITableFullVo, 'id' | 'records' | 'fields' | 'defaultViewId'>;

  beforeEach(async () => {
    mainTable = await createTableWithExtraRec('mainTable', 10);
    subTable = await createTableWithExtraRec('subTable', 10);

    const { id: mainTableId } = mainTable;
    const { id: subTableId } = subTable;

    await createLink(mainTableId, subTableId);

    const fieldsResult1 = await request.get(`/api/table/${mainTableId}/field`).expect(200);
    mainTable.fields = fieldsResult1.body;
  });

  afterEach(async () => {
    const { id: mainTableId } = mainTable;
    const { id: subTableId } = subTable;

    const result1 = await request.delete(`/api/base/${baseId}/table/arbitrary/${mainTableId}`);
    console.log('clear mainTable: ', result1.body);

    const result2 = await request.delete(`/api/base/${baseId}/table/arbitrary/${subTableId}`);
    console.log('clear subTable: ', result2.body);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: $type - Multiple`,
    async ({ type, valueGenerateFn }) => {
      const { id: mainTableId, fields: fields1, defaultViewId: mainDefaultViewId } = mainTable;
      const { id: subTableId, fields: fields2, records: subRecords } = subTable;
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
      fields1.push(lookupRes.body);
      const lookupFieldId = lookupRes.body?.id;

      // link records
      for (let i = 0; i < subRecords.length; i++) {
        await updateRecordByApi(request, mainTableId, mainTable?.records[i]?.id, linkField.id, [
          { id: subTable?.records?.[i]?.id },
        ]);
      }

      const ascOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'asc' }];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await setRecordsOrder(mainTableId, mainDefaultViewId!, ascOrders);
      const ascOriginRecords = await getSortRecords(mainTableId);
      const descOrders: ISortItem[] = [{ fieldId: lookupFieldId, order: 'desc' }];
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await setRecordsOrder(mainTableId, mainDefaultViewId!, descOrders);
      const descOriginRecords = await getSortRecords(mainTableId);

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields1);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields1);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});
