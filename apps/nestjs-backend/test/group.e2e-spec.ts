import { faker } from '@faker-js/faker';
import type { INestApplication } from '@nestjs/common';
import {
  CellValueType,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  SortFunc,
  TimeFormatting,
} from '@teable-group/core';
import type { ITableFullVo, IFieldRo, IGetRecordsRo, IGroupItem } from '@teable-group/core';
import { setViewGroup, setViewSort } from '@teable-group/openapi';
import { orderBy, isEmpty } from 'lodash';
import {
  createRecords,
  createTable,
  deleteTable,
  getRecords,
  getView,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

let app: INestApplication;

const baseId = globalThis.testConfig.baseId;

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

const fillTable = async (tableId: string, fieldName: string, length: number) => {
  if (!length) {
    return [];
  }

  const records = Array.from({ length: length }).map((_, i) => ({
    fields: {
      [fieldName]: `String_${i}`,
    },
  }));

  const res = await createRecords(tableId, { fieldKeyType: FieldKeyType.Name, records });
  return res.records || [];
};

const createTableWithExtraRec = async (tableName: string, recordsLength = 10) => {
  const { id, fields, defaultViewId, records } = await createTable(baseId, {
    name: tableName,
    fields: defaultFields.map((f) => ({ ...f, name: f.name })),
  });

  const newRecords = await fillTable(id, fields[0].name, recordsLength);

  return {
    id,
    fields,
    defaultViewId: defaultViewId!,
    records: records.concat(newRecords),
  };
};

const getRecordsByOrder = (
  records: ITableFullVo['records'],
  conditions: IGroupItem[],
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
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI ViewController view group (e2e)', () => {
  let tableId: string;
  let viewId: string;
  let fields: IFieldRo[];
  beforeEach(async () => {
    const result = await createTable(baseId, { name: 'Table' });
    tableId = result.id;
    viewId = result.defaultViewId!;
    fields = result.fields!;
  });
  afterEach(async () => {
    await deleteTable(baseId, tableId);
  });

  test('/api/table/{tableId}/view/{viewId}/viewGroup view group (PUT)', async () => {
    const assertGroup = {
      group: [
        {
          fieldId: fields[0].id as string,
          order: SortFunc.Asc,
        },
      ],
    };
    await setViewGroup(tableId, viewId, assertGroup);
    const updatedView = await getView(tableId, viewId);
    const viewGroup = updatedView.group;
    expect(viewGroup).toEqual(assertGroup.group);
  });
});

describe('OpenAPI ViewController raw group (e2e) base cellValueType', () => {
  let subTable: Pick<ITableFullVo, 'id' | 'records' | 'fields'> & { defaultViewId: string };

  beforeEach(async () => {
    subTable = await createTableWithExtraRec('subTable', 10);
  });

  afterEach(async () => {
    const { id: subTableId } = subTable;
    await deleteTable(baseId, subTableId);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/viewGroup view group (POST) Test CellValueType: $type`,
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
        await updateRecordByApi(subTableId, subTable.records[i].id, fieldId, valueGenerateFn());
      }

      const ascGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Asc }];
      await setViewGroup(subTableId, subTableDefaultViewId, { group: ascGroups });
      const ascOriginRecords = (await getRecords(subTableId, { groupBy: ascGroups })).records;
      const descGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Desc }];
      await setViewGroup(subTableId, subTableDefaultViewId, { group: descGroups });
      const descOriginRecords = (await getRecords(subTableId, { groupBy: descGroups })).records;

      const resultAscRecords = getRecordsByOrder(ascOriginRecords, ascGroups, fields2);
      const resultDescRecords = getRecordsByOrder(descOriginRecords, descGroups, fields2);

      expect(ascOriginRecords).toEqual(resultAscRecords);
      expect(descOriginRecords).toEqual(resultDescRecords);
    }
  );

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/viewGroup view group with order (POST) Test CellValueType: $type`,
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
        await updateRecordByApi(subTableId, subTable.records[i].id, fieldId, valueGenerateFn());
      }

      const ascGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Asc }];
      const descGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Desc }];

      await setViewGroup(subTableId, subTableDefaultViewId, { group: ascGroups });
      await setViewSort(subTableId, subTableDefaultViewId, { sort: { sortObjs: descGroups } });
      const ascOriginRecords = (await getRecords(subTableId, { groupBy: ascGroups })).records;

      await setViewGroup(subTableId, subTableDefaultViewId, { group: descGroups });
      await setViewSort(subTableId, subTableDefaultViewId, { sort: { sortObjs: ascGroups } });
      const descOriginRecords = (await getRecords(subTableId, { groupBy: descGroups })).records;

      const resultAscRecords = getRecordsByOrder(ascOriginRecords, ascGroups, fields2);
      const resultDescRecords = getRecordsByOrder(descOriginRecords, descGroups, fields2);

      expect(ascOriginRecords).toEqual(resultAscRecords);
      expect(descOriginRecords).toEqual(resultDescRecords);
    }
  );
});
