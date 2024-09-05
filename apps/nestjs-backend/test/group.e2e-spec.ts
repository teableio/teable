import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IGroupItem } from '@teable/core';
import { CellValueType, SortFunc } from '@teable/core';
import type { ITableFullVo, IGetRecordsRo } from '@teable/openapi';
import { updateViewGroup, updateViewSort } from '@teable/openapi';
import { isEmpty, orderBy } from 'lodash';
import { x_20 } from './data-helpers/20x';
import { createTable, permanentDeleteTable, getRecords, getView, initApp } from './utils/init-app';

let app: INestApplication;

const baseId = globalThis.testConfig.baseId;

const typeTests = [
  {
    type: CellValueType.String,
  },
  {
    type: CellValueType.Number,
  },
  {
    type: CellValueType.DateTime,
  },
  {
    type: CellValueType.Boolean,
  },
];

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
    await permanentDeleteTable(baseId, tableId);
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
    await updateViewGroup(tableId, viewId, assertGroup);
    const updatedView = await getView(tableId, viewId);
    const viewGroup = updatedView.group;
    expect(viewGroup).toEqual(assertGroup.group);
  });
});

describe('OpenAPI ViewController raw group (e2e) base cellValueType', () => {
  let table: ITableFullVo;

  beforeAll(async () => {
    table = await createTable(baseId, {
      name: 'group_x_20',
      fields: x_20.fields,
      records: x_20.records,
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/viewGroup view group (POST) Test CellValueType: $type`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2, defaultViewId: subTableDefaultViewId } = table;
      const field = fields2.find(
        (field) => field.cellValueType === type
      ) as ITableFullVo['fields'][number];
      const { id: fieldId } = field;

      const ascGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Asc }];
      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: ascGroups });
      const ascOriginRecords = (await getRecords(subTableId, { groupBy: ascGroups })).records;
      const descGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Desc }];
      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: descGroups });
      const descOriginRecords = (await getRecords(subTableId, { groupBy: descGroups })).records;

      const resultAscRecords = getRecordsByOrder(ascOriginRecords, ascGroups, fields2);
      const resultDescRecords = getRecordsByOrder(descOriginRecords, descGroups, fields2);

      expect(ascOriginRecords).toEqual(resultAscRecords);
      expect(descOriginRecords).toEqual(resultDescRecords);
    }
  );

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/viewGroup view group with order (POST) Test CellValueType: $type`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2, defaultViewId: subTableDefaultViewId } = table;
      const field = fields2.find(
        (field) => field.cellValueType === type
      ) as ITableFullVo['fields'][number];
      const { id: fieldId } = field;

      const ascGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Asc }];
      const descGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Desc }];

      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: ascGroups });
      await updateViewSort(subTableId, subTableDefaultViewId!, { sort: { sortObjs: descGroups } });
      const ascOriginRecords = (await getRecords(subTableId, { groupBy: ascGroups })).records;

      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: descGroups });
      await updateViewSort(subTableId, subTableDefaultViewId!, { sort: { sortObjs: ascGroups } });
      const descOriginRecords = (await getRecords(subTableId, { groupBy: descGroups })).records;

      const resultAscRecords = getRecordsByOrder(ascOriginRecords, ascGroups, fields2);
      const resultDescRecords = getRecordsByOrder(descOriginRecords, descGroups, fields2);

      expect(ascOriginRecords).toEqual(resultAscRecords);
      expect(descOriginRecords).toEqual(resultDescRecords);
    }
  );
});
