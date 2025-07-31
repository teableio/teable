/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  IDateFieldOptions,
  IFieldRo,
  IFieldVo,
  INumberFieldOptions,
  ISelectFieldOptions,
  ISortItem,
} from '@teable/core';
import {
  CellValueType,
  SortFunc,
  FieldType,
  formatNumberToString,
  formatDateToString,
  DateFormattingPreset,
  TimeFormatting,
  FieldKeyType,
} from '@teable/core';
import type { IGetRecordsRo, ITableFullVo, IViewSortRo } from '@teable/openapi';
import {
  updateViewSort as apiSetViewSort,
  convertField,
  createRecords,
  updateRecords,
  updateViewGroup,
} from '@teable/openapi';
import { isEmpty, orderBy } from 'lodash';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';
import {
  createField,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecords,
  getView,
  initApp,
} from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// cellValueType which need to test
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

const getSortRecords = async (
  tableId: string,
  query?: Pick<IGetRecordsRo, 'viewId' | 'orderBy'>
) => {
  const result = await getRecords(tableId, {
    fieldKeyType: FieldKeyType.Id,
    viewId: query?.viewId,
    orderBy: query?.orderBy,
  });
  return result.records;
};

const setRecordsOrder = async (tableId: string, viewId: string, orderBy: ISortItem[]) => {
  await apiSetViewSort(tableId, viewId, {
    sort: { sortObjs: orderBy },
  });
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
    const { name, type, options, isMultipleCellValue } = field;
    return (record: ITableFullVo['records'][number]) => {
      const cellValue = record?.fields?.[name];
      if (isEmpty(cellValue)) {
        return -Infinity;
      }
      if (type === FieldType.SingleSelect && !isMultipleCellValue) {
        const { choices } = options as ISelectFieldOptions;
        return choices.map(({ name }) => name).indexOf(cellValue as string);
      }
      if (type === FieldType.Number) {
        if (isMultipleCellValue && Array.isArray(cellValue)) {
          return cellValue
            .map((v) => formatNumberToString(v, (options as INumberFieldOptions).formatting))
            .join(', ');
        }
        return formatNumberToString(
          cellValue as number,
          (options as INumberFieldOptions).formatting
        );
      }
      if (type === FieldType.Date) {
        if (isMultipleCellValue && Array.isArray(cellValue)) {
          return cellValue
            .map((v) => formatDateToString(v, (options as IDateFieldOptions).formatting))
            .join(', ');
        }
        return formatDateToString(cellValue as string, (options as IDateFieldOptions).formatting);
      }
      if (isMultipleCellValue) {
        // return JSON.stringify(record?.fields?.[name]);
        return (cellValue as any)[0];
      }
    };
  });
  const orders = conditions.map((condition) => condition.order || SortFunc.Asc);
  return orderBy([...records], fns, orders);
};

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI ViewController view order sort (e2e)', () => {
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

  it('/api/table/{tableId}/view/{viewId}/sort sort view order (PUT)', async () => {
    const assertSort = {
      sort: {
        sortObjs: [
          {
            fieldId: fields[0].id as string,
            order: SortFunc.Asc,
          },
        ],
        manualSort: false,
      },
    };
    await apiSetViewSort(tableId, viewId, assertSort);
    const updatedView = await getView(tableId, viewId);
    const viewSort = updatedView.sort;
    expect(viewSort).toEqual(assertSort.sort);
  });

  it('sort date should always use a second precision when formatting time is not none', async () => {
    await createRecords(tableId, {
      records: [
        {
          fields: {},
        },
      ],
    });

    await delay(1000);

    await createRecords(tableId, {
      records: [
        {
          fields: {},
        },
      ],
    });

    const createdTimeField = await createField(tableId, {
      name: 'createdTime',
      type: FieldType.CreatedTime,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.Hour24,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    });

    // asc
    const ascOrders: IGetRecordsRo['orderBy'] = [
      { fieldId: createdTimeField.id, order: SortFunc.Asc },
    ];

    const originRecords = await getSortRecords(tableId, {
      viewId,
      orderBy: ascOrders,
    });

    const assertSort = orderBy(
      originRecords,
      ['createdTime', 'autoNumber'],
      [SortFunc.Asc, SortFunc.Asc]
    );

    const originId = originRecords.map((record) => record.id);

    const assertId = assertSort.map((record) => record.id);

    expect(originId).toEqual(assertId);

    // desc
    const descOrders: IGetRecordsRo['orderBy'] = [
      { fieldId: createdTimeField.id, order: SortFunc.Desc },
    ];

    const descOriginRecords = await getSortRecords(tableId, {
      viewId,
      orderBy: descOrders,
    });

    const assertDescSort = orderBy(
      descOriginRecords,
      ['createdTime', 'autoNumber'],
      [SortFunc.Desc, SortFunc.Asc]
    );

    const originDescId = descOriginRecords.map((record) => record.id);

    const assertDescId = assertDescSort.map((record) => record.id);

    expect(originDescId).toEqual(assertDescId);
  });

  it('sort date should precision should be day when formatting time is none', async () => {
    await createRecords(tableId, {
      records: [
        {
          fields: {},
        },
      ],
    });

    await delay(1000);

    await createRecords(tableId, {
      records: [
        {
          fields: {},
        },
      ],
    });

    const createdTimeField = await createField(tableId, {
      name: 'createdTime',
      type: FieldType.CreatedTime,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    });

    // asc
    const ascOrders: IGetRecordsRo['orderBy'] = [
      { fieldId: createdTimeField.id, order: SortFunc.Asc },
    ];

    const originRecords = await getSortRecords(tableId, {
      viewId,
      orderBy: ascOrders,
    });

    const assertSort = orderBy(
      originRecords,
      ['createdTime', 'autoNumber'],
      [SortFunc.Asc, SortFunc.Asc]
    );

    const originId = originRecords.map((record) => record.id);

    const assertId = assertSort.map((record) => record.id);

    expect(originId).toEqual(assertId);

    // desc
    const descOrders: IGetRecordsRo['orderBy'] = [
      { fieldId: createdTimeField.id, order: SortFunc.Desc },
    ];

    const descOriginRecords = await getSortRecords(tableId, {
      viewId,
      orderBy: descOrders,
    });

    const ascOriginRecords = await getSortRecords(tableId, {
      viewId,
      orderBy: ascOrders,
    });

    const descRecordsDescId = descOriginRecords.map((record) => record.id);

    const ascRecordsDescId = ascOriginRecords.map((record) => record.id);

    // if time is none, the sort precision should be day, meaning that the sort by day instead of second
    expect(descRecordsDescId).toEqual(ascRecordsDescId);

    // then group by createdTime, and sort by single select field
    const fields = await getFields(tableId);
    const singleSelectField = fields.find((field) => field.type === FieldType.SingleSelect)!;
    await convertField(tableId, singleSelectField.id, {
      dbFieldName: singleSelectField.dbFieldName,
      type: singleSelectField.type as FieldType,
      options: {
        choices: [
          { name: '1', color: 'cyanLight2' },
          { name: '2', color: 'yellowDark1' },
          { name: '3', color: 'yellowLight1' },
          { name: '4', color: 'orangeBright' },
          { name: '5', color: 'yellowLight2' },
        ],
      },
    });
    await updateRecords(tableId, {
      fieldKeyType: FieldKeyType.Id,
      typecast: true,
      records: ascRecordsDescId.reverse().map((id, index) => ({
        id,
        fields: {
          [singleSelectField.id!]: index + 1,
        },
      })),
    });
    const createTimeField = await createField(tableId, {
      name: 'createdTime',
      type: FieldType.CreatedTime,
      options: {
        formatting: {
          date: DateFormattingPreset.ISO,
          time: TimeFormatting.None,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    });

    await apiSetViewSort(tableId, viewId, {
      sort: {
        sortObjs: [{ fieldId: singleSelectField.id, order: SortFunc.Asc }],
      },
    });

    await updateViewGroup(tableId, viewId, {
      group: [{ fieldId: createTimeField.id, order: SortFunc.Asc }],
    });

    const records = await getRecords(tableId, {
      viewId,
    });

    const assertRecordIds = orderBy(records.records, [`fields.${singleSelectField.name}`], ['asc']);

    expect(records.records.map((r) => r.id)).toEqual(assertRecordIds.map((r) => r.id));
  });

  it('should not allow to modify sort for button field', async () => {
    const buttonField = await createField(tableId, {
      type: FieldType.Button,
    });
    const assertSort: IViewSortRo = {
      sort: {
        sortObjs: [{ fieldId: buttonField.id, order: SortFunc.Asc }],
      },
    };

    await expect(apiSetViewSort(tableId, viewId, assertSort)).rejects.toThrow();
  });
});

describe('OpenAPI Sort (e2e) Base CellValueType', () => {
  let table: ITableFullVo;

  beforeAll(async () => {
    table = await createTable(baseId, {
      name: 'sort_x_20',
      fields: x_20.fields,
      records: x_20.records,
    });
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/record sort (GET) Test CellValueType: $type`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2 } = table;
      const field = fields2.find((field) => field.cellValueType === type);
      const { id: fieldId } = field!;

      const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Asc }];
      const descOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Desc }];
      const ascOriginRecords = await getSortRecords(subTableId, { orderBy: ascOrders });
      const descOriginRecords = await getSortRecords(subTableId, { orderBy: descOrders });

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: $type`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2, defaultViewId } = table;
      const field = fields2.find(
        (field) => field.cellValueType === type
      ) as ITableFullVo['fields'][number];
      const { id: fieldId } = field;

      const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Asc }];
      await setRecordsOrder(subTableId, defaultViewId!, ascOrders);
      const ascOriginRecords = await getSortRecords(subTableId, { viewId: defaultViewId });
      const descOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Desc }];
      await setRecordsOrder(subTableId, defaultViewId!, descOrders);
      const descOriginRecords = await getSortRecords(subTableId, { viewId: defaultViewId });

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );

  test('SingleSelect field sorting should be sorted based on option value', async () => {
    const { id: subTableId, fields: fields2 } = table;
    const singleSelectField = fields2.find((field) => field.type === FieldType.SingleSelect);
    const { id: fieldId } = singleSelectField!;

    const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Asc }];
    const descOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Desc }];
    const ascOriginRecords = await getSortRecords(subTableId, { orderBy: ascOrders });
    const descOriginRecords = await getSortRecords(subTableId, { orderBy: descOrders });

    const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
    const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

    expect(ascOriginRecords).toEqual(ascManualSortRecords);
    expect(descOriginRecords).toEqual(descManualSortRecords);
  });

  test('view sort property should be merged after by interface parameter orderBy', async () => {
    const { id: subTableId, fields: fields2, defaultViewId } = table;
    const field = fields2.find(
      (field) => field.type === FieldType.Number
    ) as ITableFullVo['fields'][number];
    const { id: fieldId } = field;

    const booleanField = fields2.find((field) => field.type === FieldType.Checkbox);
    const { id: booleanFieldId } = booleanField!;

    const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId, order: SortFunc.Asc }];
    const descOrders: IGetRecordsRo['orderBy'] = [
      { fieldId: booleanFieldId, order: SortFunc.Desc },
    ];
    await setRecordsOrder(subTableId, defaultViewId!, ascOrders);
    const originRecords = await getSortRecords(subTableId, {
      viewId: defaultViewId,
      orderBy: descOrders,
    });
    const manualSortRecords = getRecordsByOrder(
      originRecords,
      [...descOrders, ...ascOrders],
      fields2
    );
    expect(originRecords).toEqual(manualSortRecords);
  });
});

describe('OpenAPI Sort (e2e) Multiple CellValueType', () => {
  let mainTable: ITableFullVo;
  let subTable: ITableFullVo;

  beforeAll(async () => {
    mainTable = await createTable(baseId, {
      name: 'sort_x_20',
      fields: x_20.fields,
      records: x_20.records,
    });

    const x20Link = x_20_link(mainTable);
    subTable = await createTable(baseId, {
      name: 'sort_x_20',
      fields: x20Link.fields,
      records: x20Link.records,
    });

    const x20LinkFromLookups = x_20_link_from_lookups(mainTable, subTable.fields[2].id);
    for (const field of x20LinkFromLookups.fields) {
      await createField(subTable.id, field);
    }

    subTable.fields = await getFields(subTable.id);
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, mainTable.id);
    await permanentDeleteTable(baseId, subTable.id);
  });

  test.each(typeTests)(
    `/api/table/{tableId}/record sort (GET) Test CellValueType: $type - Multiple`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2 } = subTable;

      const field = fields2.find((field) => field.cellValueType === type && field.isLookup);
      const { id: lookupFieldId } = field!;

      const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId: lookupFieldId, order: SortFunc.Asc }];
      const descOrders: IGetRecordsRo['orderBy'] = [
        { fieldId: lookupFieldId, order: SortFunc.Desc },
      ];
      const ascOriginRecords = await getSortRecords(subTableId, { orderBy: ascOrders });
      const descOriginRecords = await getSortRecords(subTableId, { orderBy: descOrders });

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );

  test.each(typeTests)(
    `/api/table/{tableId}/view/{viewId}/sort sort view raw order (POST) Test CellValueType: $type - Multiple`,
    async ({ type }) => {
      const { id: subTableId, fields: fields2, defaultViewId: subDefaultViewId } = subTable;

      const field = fields2.find((field) => field.cellValueType === type && field.isLookup);
      const { id: lookupFieldId } = field!;

      const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId: lookupFieldId, order: SortFunc.Asc }];
      await setRecordsOrder(subTableId, subDefaultViewId!, ascOrders);
      const ascOriginRecords = await getSortRecords(subTableId, { viewId: subDefaultViewId });
      const descOrders: IGetRecordsRo['orderBy'] = [
        { fieldId: lookupFieldId, order: SortFunc.Desc },
      ];
      await setRecordsOrder(subTableId, subDefaultViewId!, descOrders);
      const descOriginRecords = await getSortRecords(subTableId, { viewId: subDefaultViewId });

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields2);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields2);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});

describe('OpenAPI Sort (e2e) Date Formatting', () => {
  let tableId: string;
  let viewId: string;
  let fields: IFieldVo[];

  const generateDateField = (name: string, date: DateFormattingPreset) => {
    return {
      name,
      type: FieldType.Date,
      options: {
        formatting: {
          date,
          time: TimeFormatting.None,
          timeZone: 'Asia/Singapore',
        },
      },
    };
  };

  const originFields = [
    generateDateField('Year', DateFormattingPreset.Y),
    generateDateField('Month', DateFormattingPreset.YM),
    generateDateField('Day', DateFormattingPreset.ISO),
  ];

  const generateFieldValues = (dateString: string) => {
    return {
      fields: {
        [originFields[0].name!]: new Date(dateString).toISOString(),
        [originFields[1].name!]: new Date(dateString).toISOString(),
        [originFields[2].name!]: new Date(dateString).toISOString(),
      },
    };
  };

  beforeEach(async () => {
    const result = await createTable(baseId, {
      name: 'sort_by_date',
      fields: originFields,
      records: [
        generateFieldValues('2024-01-10 10:00:00'),
        generateFieldValues('2024-01-10 08:00:00'),
        generateFieldValues('2023-05-01 09:00:00'),
        generateFieldValues('2022-08-01 06:00:00'),
        generateFieldValues('2022-05-01 10:00:00'),
        generateFieldValues('2024-01-01 10:00:00'),
      ],
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    fields = result.fields!;
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test.each([
    { index: 0, fieldName: originFields[0].name as string },
    { index: 1, fieldName: originFields[1].name as string },
    { index: 2, fieldName: originFields[2].name as string },
  ])(
    '/api/table/{tableId}/view/{viewId}/sort sort by date with different formatting: $fieldName',
    async ({ index }) => {
      const sortByFieldId = fields[index].id as string;
      const ascOrders: IGetRecordsRo['orderBy'] = [{ fieldId: sortByFieldId, order: SortFunc.Asc }];
      const descOrders: IGetRecordsRo['orderBy'] = [
        { fieldId: sortByFieldId, order: SortFunc.Desc },
      ];

      await setRecordsOrder(tableId, viewId, ascOrders);

      const ascOriginRecords = await getSortRecords(tableId, { orderBy: ascOrders });
      const descOriginRecords = await getSortRecords(tableId, { orderBy: descOrders });

      const ascManualSortRecords = getRecordsByOrder(ascOriginRecords, ascOrders, fields);
      const descManualSortRecords = getRecordsByOrder(descOriginRecords, descOrders, fields);

      expect(ascOriginRecords).toEqual(ascManualSortRecords);
      expect(descOriginRecords).toEqual(descManualSortRecords);
    }
  );
});
