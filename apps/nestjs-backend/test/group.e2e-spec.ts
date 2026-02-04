/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, IGroup, IGroupItem, IViewGroupRo } from '@teable/core';
import {
  CellValueType,
  Colors,
  FieldKeyType,
  FieldType,
  Relationship,
  SortFunc,
} from '@teable/core';
import type { IGetRecordsRo, IGroupHeaderPoint, IGroupPoint, ITableFullVo } from '@teable/openapi';
import { GroupPointType, updateViewGroup, updateViewSort } from '@teable/openapi';
import { isEmpty, orderBy } from 'lodash';
import { x_20 } from './data-helpers/20x';
import {
  createTable,
  permanentDeleteTable,
  getRecords,
  getView,
  initApp,
  createField,
  getFields,
  updateRecordByApi,
} from './utils/init-app';

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
    const { id, isMultipleCellValue } = field;
    return (record: ITableFullVo['records'][number]) => {
      if (isEmpty(record?.fields?.[id])) {
        return -Infinity;
      }
      if (isMultipleCellValue) {
        return JSON.stringify(record?.fields?.[id]);
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

  it('should not allow to modify group for button field', async () => {
    const buttonField = await createField(tableId, {
      type: FieldType.Button,
    });

    const assertGroup: IViewGroupRo = {
      group: [
        {
          fieldId: buttonField.id,
          order: SortFunc.Asc,
        },
      ],
    };

    await expect(updateViewGroup(tableId, viewId, assertGroup)).rejects.toThrow();
  });
});

describe('Single select grouping respects choice order', () => {
  const choiceOrder = ['Out of stock', 'In stock', 'Backordered'] as const;
  const choiceDefinitions = choiceOrder.map((name, index) => ({
    id: `choice-${index}`,
    name,
    color: index === 0 ? Colors.Red : index === 1 ? Colors.Green : Colors.Blue,
  }));
  const statusFieldName = 'Stock Status';
  const quantityFieldName = 'Item';
  const recordDefinitions: Record<(typeof choiceOrder)[number], string[]> = {
    'Out of stock': ['record-out-1', 'record-out-2'],
    'In stock': ['record-in-1'],
    Backordered: ['record-back-1'],
  };

  let table: ITableFullVo;
  let statusField: IFieldRo;

  beforeAll(async () => {
    table = await createTable(baseId, {
      name: 'group_single_select_order',
      fields: [
        {
          name: quantityFieldName,
          type: FieldType.SingleLineText,
        },
        {
          name: statusFieldName,
          type: FieldType.SingleSelect,
          options: {
            choices: choiceDefinitions,
          },
        },
      ],
      records: choiceOrder.flatMap((status) =>
        recordDefinitions[status].map((recordName) => ({
          fields: {
            [quantityFieldName]: recordName,
            [statusFieldName]: status,
          },
        }))
      ),
    });
    statusField = table.fields!.find(
      ({ name, type }) => name === statusFieldName && type === FieldType.SingleSelect
    ) as IFieldRo;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, table.id);
  });

  const assertGroupingOrder = async (
    order: SortFunc,
    expectedGroupOrder: (typeof choiceOrder)[number][]
  ) => {
    const query: IGetRecordsRo = {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: statusField.id!, order }],
    };
    const { records, extra } = await getRecords(table.id, query);
    const headerValues =
      extra?.groupPoints
        ?.filter((point): point is IGroupHeaderPoint => point.type === GroupPointType.Header)
        .map((point) => point.value as string) ?? [];
    expect(headerValues).toEqual(expectedGroupOrder);

    const statusSequence = records.map((record) => record.fields?.[statusField.id!] as string);
    const expectedStatusSequence = expectedGroupOrder.flatMap((status) =>
      recordDefinitions[status].map(() => status)
    );
    expect(statusSequence).toEqual(expectedStatusSequence);
  };

  it('orders groups by choice order when ascending', async () => {
    await assertGroupingOrder(SortFunc.Asc, [...choiceOrder]);
  });

  it('orders groups by choice order when descending', async () => {
    await assertGroupingOrder(SortFunc.Desc, [...choiceOrder].reverse());
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
      const ascOriginRecords = (
        await getRecords(subTableId, { fieldKeyType: FieldKeyType.Id, groupBy: ascGroups })
      ).records;
      const descGroups: IGetRecordsRo['groupBy'] = [{ fieldId, order: SortFunc.Desc }];
      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: descGroups });
      const descOriginRecords = (
        await getRecords(subTableId, { fieldKeyType: FieldKeyType.Id, groupBy: descGroups })
      ).records;

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
      const ascOriginRecords = (
        await getRecords(subTableId, { fieldKeyType: FieldKeyType.Id, groupBy: ascGroups })
      ).records;

      await updateViewGroup(subTableId, subTableDefaultViewId!, { group: descGroups });
      await updateViewSort(subTableId, subTableDefaultViewId!, { sort: { sortObjs: ascGroups } });
      const descOriginRecords = (
        await getRecords(subTableId, { fieldKeyType: FieldKeyType.Id, groupBy: descGroups })
      ).records;

      const resultAscRecords = getRecordsByOrder(ascOriginRecords, ascGroups, fields2);
      const resultDescRecords = getRecordsByOrder(descOriginRecords, descGroups, fields2);

      expect(ascOriginRecords).toEqual(resultAscRecords);
      expect(descOriginRecords).toEqual(resultDescRecords);
    }
  );
});

describe('Lookup grouping keeps headers aligned', () => {
  const categoryChoices = ['Teaching Contest', 'Faculty Contest', 'World Skills', 'Other'] as const;

  const projectDefinitions = [
    {
      name: 'Ethics Deck',
      category: categoryChoices[0],
      subject: 'Ethics & Law',
    },
    {
      name: 'Culinary Basics',
      category: categoryChoices[1],
      subject: 'Chinese Cuisine',
    },
    {
      name: 'Vision Health',
      category: categoryChoices[2],
      subject: 'Optometry',
    },
    {
      name: 'VR Deck A',
      category: categoryChoices[3],
      subject: 'VR Banking English',
    },
    {
      name: 'VR Deck B',
      category: categoryChoices[3],
      subject: 'VR Banking English - Final',
    },
  ];

  let projectTable: ITableFullVo;
  let taskTable: ITableFullVo;
  let categoryLookupFieldId: string;
  let subjectLookupFieldId: string;

  const simplifyValue = (value: unknown) => {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value as string | number | null;
  };

  const extractGroupPaths = (points: IGroupPoint[]) => {
    const paths: { path: (string | number | null)[]; count: number }[] = [];
    const current: (string | number | null)[] = [];

    points.forEach((point) => {
      if (point.type === GroupPointType.Header) {
        current[point.depth] = simplifyValue(point.value);
        current.length = point.depth + 1;
      }

      if (point.type === GroupPointType.Row) {
        paths.push({ path: [...current], count: point.count });
      }
    });

    return paths;
  };

  beforeAll(async () => {
    projectTable = await createTable(baseId, {
      name: 'group_lookup_projects',
      fields: [
        {
          name: 'Project Name',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Category',
          type: FieldType.SingleSelect,
          options: {
            choices: categoryChoices.map((name, index) => ({
              id: `choice-${index}`,
              name,
              color: Colors.Blue,
            })),
          },
        },
        {
          name: 'Subject',
          type: FieldType.SingleLineText,
        },
      ],
      records: projectDefinitions.map((definition) => ({
        fields: {
          'Project Name': definition.name,
          Category: definition.category,
          Subject: definition.subject,
        },
      })),
    });

    taskTable = await createTable(baseId, {
      name: 'group_lookup_tasks',
      fields: [
        {
          name: 'Task Name',
          type: FieldType.SingleLineText,
        },
      ],
      records: projectDefinitions.map((definition, index) => ({
        fields: {
          'Task Name': `Task-${index + 1}-${definition.name}`,
        },
      })),
    });

    const linkField = (await createField(taskTable.id, {
      name: 'Linked Project',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: projectTable.id,
      },
    })) as IFieldVo;

    await Promise.all(
      taskTable.records.map((record, index) =>
        updateRecordByApi(taskTable.id, record.id, linkField.id, [
          { id: projectTable.records[index].id },
        ])
      )
    );

    const [projectFields] = await Promise.all([
      getFields(projectTable.id),
      getFields(taskTable.id),
    ]);

    const categoryField = projectFields.find(({ name }) => name === 'Category') as IFieldVo;
    const subjectField = projectFields.find(({ name }) => name === 'Subject') as IFieldVo;

    await createField(taskTable.id, {
      name: 'Category',
      type: categoryField.type,
      isLookup: true,
      lookupOptions: {
        foreignTableId: projectTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: categoryField.id,
      },
    });

    await createField(taskTable.id, {
      name: 'Subject',
      type: subjectField.type,
      isLookup: true,
      lookupOptions: {
        foreignTableId: projectTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: subjectField.id,
      },
    });

    const refreshedTaskFields = await getFields(taskTable.id);

    categoryLookupFieldId = refreshedTaskFields.find(
      ({ name, isLookup }) => name === 'Category' && isLookup
    )?.id as string;

    subjectLookupFieldId = refreshedTaskFields.find(
      ({ name, isLookup }) => name === 'Subject' && isLookup
    )?.id as string;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, taskTable.id);
    await permanentDeleteTable(baseId, projectTable.id);
  });

  it('groups by lookup single select then lookup text in expected order', async () => {
    const groupBy: IGroup = [
      { fieldId: categoryLookupFieldId, order: SortFunc.Asc },
      { fieldId: subjectLookupFieldId, order: SortFunc.Asc },
    ];

    const { records, extra } = await getRecords(taskTable.id, {
      fieldKeyType: FieldKeyType.Id,
      groupBy,
    });

    const groupPoints = extra?.groupPoints as IGroupPoint[] | undefined;
    expect(groupPoints).toBeDefined();

    const paths = extractGroupPaths(groupPoints ?? []);
    const expectedPaths = projectDefinitions.map(({ category, subject }) => [category, subject]);
    expect(paths.map(({ path }) => path)).toEqual(expectedPaths);
    expect(paths.reduce((sum, { count }) => sum + count, 0)).toEqual(records.length);
  });
});

describe('Lookup single select respects choice order when sorting groups', () => {
  // Deliberately set choice order opposite to alphabetical to catch regressions
  const choiceOrder = ['Z-Type', 'A-Type'] as const;

  let sourceTable: ITableFullVo;
  let targetTable: ITableFullVo;
  let categoryLookupFieldId: string;

  const normalize = (value: unknown) => (Array.isArray(value) ? value[0] : value) as string;

  beforeAll(async () => {
    sourceTable = await createTable(baseId, {
      name: 'group_lookup_choice_source',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Category',
          type: FieldType.SingleSelect,
          options: {
            choices: choiceOrder.map((name, index) => ({
              id: `choice-${index}`,
              name,
              color: Colors.Blue,
            })),
          },
        },
      ],
      records: [
        { fields: { Name: 'Item-A', Category: choiceOrder[0] } },
        { fields: { Name: 'Item-B', Category: choiceOrder[1] } },
      ],
    });

    targetTable = await createTable(baseId, {
      name: 'group_lookup_choice_target',
      fields: [{ name: 'Task', type: FieldType.SingleLineText }],
      records: [{ fields: { Task: 'Task-B-Second' } }, { fields: { Task: 'Task-A-First' } }],
    });

    const linkField = (await createField(targetTable.id, {
      name: 'Link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: sourceTable.id,
      },
    })) as IFieldVo;

    // Deliberately link in reverse order to test sorting by choice order
    await updateRecordByApi(targetTable.id, targetTable.records[0].id, linkField.id, [
      { id: sourceTable.records[1].id },
    ]);
    await updateRecordByApi(targetTable.id, targetTable.records[1].id, linkField.id, [
      { id: sourceTable.records[0].id },
    ]);

    const sourceFields = await getFields(sourceTable.id);
    const categoryField = sourceFields.find(({ name }) => name === 'Category') as IFieldVo;

    await createField(targetTable.id, {
      name: 'Category',
      type: categoryField.type,
      isLookup: true,
      lookupOptions: {
        foreignTableId: sourceTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: categoryField.id,
      },
    });

    const refreshedTargetFields = await getFields(targetTable.id);
    categoryLookupFieldId = refreshedTargetFields.find(
      ({ name, isLookup }) => name === 'Category' && isLookup
    )?.id as string;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, targetTable.id);
    await permanentDeleteTable(baseId, sourceTable.id);
  });

  it('sorts group headers and records by the lookup choice order', async () => {
    const { records, extra } = await getRecords(targetTable.id, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: categoryLookupFieldId, order: SortFunc.Asc }],
    });

    const headerValues =
      extra?.groupPoints
        ?.filter((point): point is IGroupHeaderPoint => point.type === GroupPointType.Header)
        .map((point) => normalize(point.value)) ?? [];
    expect(headerValues).toEqual(choiceOrder);

    const recordCategories = records.map((record) =>
      normalize(record.fields?.[categoryLookupFieldId])
    );
    expect(recordCategories).toEqual([choiceOrder[0], choiceOrder[1]]);
  });
});

describe('Lookup multiple select respects choice order when sorting groups', () => {
  const choiceOrder = ['Option-One', 'Option-Two', 'Option-Three'] as const;

  let sourceTable: ITableFullVo;
  let targetTable: ITableFullVo;
  let multiLookupFieldId: string;

  const normalize = (value: unknown) => {
    if (Array.isArray(value)) return value[0];
    try {
      const parsed = JSON.parse(String(value));
      if (Array.isArray(parsed)) return parsed[0];
    } catch {
      /* ignore */
    }
    return value as string;
  };

  /**
   * Build a lookup multi-select scenario where some records have multiple choices
   * and ordering should use the smallest choice index present.
   */
  beforeAll(async () => {
    sourceTable = await createTable(baseId, {
      name: 'group_lookup_multi_src',
      fields: [
        { name: 'Name', type: FieldType.SingleLineText },
        {
          name: 'Tags',
          type: FieldType.MultipleSelect,
          options: {
            choices: choiceOrder.map((name, index) => ({
              id: `choice-${index}`,
              name,
              color: Colors.Blue,
            })),
          },
        },
      ],
      records: [
        { fields: { Name: 'SRC-1', Tags: [choiceOrder[1], choiceOrder[0]] } }, // first Option-Two
        { fields: { Name: 'SRC-2', Tags: [choiceOrder[0], choiceOrder[2]] } }, // first Option-One
        { fields: { Name: 'SRC-3', Tags: [choiceOrder[2]] } }, // first Option-Three
      ],
    });

    targetTable = await createTable(baseId, {
      name: 'group_lookup_multi_dst',
      fields: [{ name: 'Task', type: FieldType.SingleLineText }],
      records: [
        { fields: { Task: 'Task-TwoAndOne' } }, // first Option-Two
        { fields: { Task: 'Task-OneAndThree' } }, // first Option-One
        { fields: { Task: 'Task-ThreeSolo' } }, // first Option-Three
      ],
    });

    const linkField = (await createField(targetTable.id, {
      name: 'Link',
      type: FieldType.Link,
      options: {
        relationship: Relationship.ManyMany,
        foreignTableId: sourceTable.id,
      },
    })) as IFieldVo;

    // Reverse link order to rely solely on choice order, not insertion
    await updateRecordByApi(targetTable.id, targetTable.records[0].id, linkField.id, [
      { id: sourceTable.records[0].id },
    ]);
    await updateRecordByApi(targetTable.id, targetTable.records[1].id, linkField.id, [
      { id: sourceTable.records[1].id },
    ]);
    await updateRecordByApi(targetTable.id, targetTable.records[2].id, linkField.id, [
      { id: sourceTable.records[2].id },
    ]);

    const sourceFields = await getFields(sourceTable.id);
    const multiField = sourceFields.find(({ name }) => name === 'Tags') as IFieldVo;

    await createField(targetTable.id, {
      name: 'Tags',
      type: multiField.type,
      isLookup: true,
      lookupOptions: {
        foreignTableId: sourceTable.id,
        linkFieldId: linkField.id,
        lookupFieldId: multiField.id,
      },
    });

    const refreshedTargetFields = await getFields(targetTable.id);
    multiLookupFieldId = refreshedTargetFields.find(
      ({ name, isLookup }) => name === 'Tags' && isLookup
    )?.id as string;
  });

  afterAll(async () => {
    await permanentDeleteTable(baseId, targetTable.id);
    await permanentDeleteTable(baseId, sourceTable.id);
  });

  it('sorts lookup multiple select groups by choice order (using first choice)', async () => {
    const { records, extra } = await getRecords(targetTable.id, {
      fieldKeyType: FieldKeyType.Id,
      groupBy: [{ fieldId: multiLookupFieldId, order: SortFunc.Asc }],
    });

    const headerValues =
      extra?.groupPoints
        ?.filter((point): point is IGroupHeaderPoint => point.type === GroupPointType.Header)
        .map((point) => normalize(point.value)) ?? [];

    // Order should follow choiceOrder based on smallest choice index in the selection
    expect(headerValues).toEqual([choiceOrder[0], choiceOrder[1], choiceOrder[2]]);

    const recordCategories = records.map((record) =>
      normalize(record.fields?.[multiLookupFieldId])
    );
    expect(recordCategories).toEqual([choiceOrder[0], choiceOrder[1], choiceOrder[2]]);
  });
});
