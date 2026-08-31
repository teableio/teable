import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldKeyType,
  FieldType,
  getValidFilterOperators,
  hasAnyOf,
  isAnyOf,
  isEmpty,
  isNoneOf,
  isNotEmpty,
  Relationship,
  SortFunc,
  type IFieldVo,
  type IFilterRo,
} from '@teable/core';
import {
  createRecords,
  getRecords as apiGetRecords,
  updateViewFilter as apiSetViewFilter,
  updateViewGroup,
  updateViewSort,
} from '@teable/openapi';
import {
  X_TEABLE_V2_FEATURE_HEADER,
  X_TEABLE_V2_HEADER,
  X_TEABLE_V2_REASON_HEADER,
} from '../src/features/canary/interceptors/v2-indicator.interceptor';
import {
  initApp,
  getView,
  createTable,
  permanentDeleteTable,
  createField,
  getFields,
} from './utils/init-app';

let app: INestApplication;
const baseId = globalThis.testConfig.baseId;

beforeAll(async () => {
  const appCtx = await initApp();
  app = appCtx.app;
});

afterAll(async () => {
  await app.close();
});

const withForceV2All = async <T>(callback: () => Promise<T>) => {
  const previousForceV2All = process.env.FORCE_V2_ALL;
  process.env.FORCE_V2_ALL = 'true';
  try {
    return await callback();
  } finally {
    if (previousForceV2All == null) {
      delete process.env.FORCE_V2_ALL;
    } else {
      process.env.FORCE_V2_ALL = previousForceV2All;
    }
  }
};

async function updateViewFilter(tableId: string, viewId: string, filterRo: IFilterRo) {
  try {
    const result = await apiSetViewFilter(tableId, viewId, filterRo);
    return result.data;
  } catch (e) {
    console.log(e);
  }
}

describe('OpenAPI ViewController (e2e) option (PUT)', () => {
  let tableId: string;
  let viewId: string;
  let fields: IFieldVo[];
  beforeAll(async () => {
    const result = await createTable(baseId, {
      name: 'Table',
    });
    tableId = result.id;
    viewId = result.defaultViewId!;
    fields = result.fields;
  });
  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  test(`/table/{tableId}/view/{viewId}/filter (PUT) update filter`, async () => {
    const assertFilter: IFilterRo = {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: fields[0].id,
            operator: 'is',
            value: '2',
          },
        ],
      },
    };
    await updateViewFilter(tableId, viewId, assertFilter);
    const updatedView = await getView(tableId, viewId);
    const viewFilter = updatedView.filter;
    expect(viewFilter).toEqual(assertFilter.filter);
  });

  it('should not allow to modify filter for button field', async () => {
    const buttonField = await createField(tableId, {
      type: FieldType.Button,
    });
    const assertFilter: IFilterRo = {
      filter: {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: buttonField.id,
            operator: isEmpty.value,
            value: null,
          },
        ],
      },
    };
    await expect(apiSetViewFilter(tableId, viewId, assertFilter)).rejects.toThrow();
  });
});

// V1 does not normalize is/isNot+null through the domain FieldConditionSpecBuilder,
// so this test must force the V2 path explicitly inside the single integration run.
describe('View filter with is/isNot null value (e2e)', () => {
  let tableId: string;
  let viewId: string;

  afterAll(async () => {
    await permanentDeleteTable(baseId, tableId);
  });

  it('should apply checkbox is+null and ignore incomplete non-checkbox isNot+null filters', async () => {
    await withForceV2All(async () => {
      // Create table with checkbox and text fields
      const table = await createTable(baseId, {
        name: 'View Filter Null Test',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Done', type: FieldType.Checkbox },
          { name: 'Code', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'row1', Done: true, Code: 'A001' } },
          { fields: { Name: 'row2', Done: false, Code: 'A002' } },
          { fields: { Name: 'row3', Code: 'A003' } },
          { fields: { Name: 'row4', Done: true } },
          { fields: { Name: 'row5' } },
        ],
      });
      tableId = table.id;
      viewId = table.defaultViewId!;

      const doneField = table.fields.find((f) => f.name === 'Done')!;
      const codeField = table.fields.find((f) => f.name === 'Code')!;

      // Set V1-style view filter: Done is [unchecked] AND an incomplete Code condition.
      // V1 stores checkbox "is unchecked" as {operator: "is", value: null}
      // but drops non-checkbox is/isNot+null because the filter input is incomplete.
      const filterRo: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            { fieldId: doneField.id, operator: 'is', value: null },
            { fieldId: codeField.id, operator: 'isNot', value: null },
          ],
        },
      };
      await updateViewFilter(tableId, viewId, filterRo);

      // Query records using viewId - should apply the view filter
      const result = await apiGetRecords(tableId, {
        viewId,
        fieldKeyType: FieldKeyType.Name,
      });

      // Only rows where Done is unchecked/false should match; Code isNot+null is ignored.
      // row2: Done=false, Code='A002' ✓
      // row3: Done=undefined, Code='A003' ✓
      // row1: Done=true → excluded
      // row4: Done=true → excluded
      // row5: Done=undefined, Code=undefined ✓
      const records = result.data.records;
      expect(records.length).toBe(3);
      const names = records.map((r) => r.fields.Name).sort();
      expect(names).toEqual(['row2', 'row3', 'row5']);
    });
  });
});

describe('Sanitized customer-shaped scalar lookup view filter (e2e)', () => {
  it('loads a grouped saved view with isNotEmpty and isNoneOf on a scalar lookup', async () => {
    await withForceV2All(async () => {
      // Sanitized, structure-equivalent fixture for T6571:
      // reference single-select -> many-one link -> scalar lookup stored as TEXT -> saved view filter.
      const referenceTable = await createTable(baseId, {
        name: 'Reference Catalog',
        fields: [
          { name: 'Reference', type: FieldType.SingleLineText },
          {
            name: 'Category',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: 'category-allowed', name: 'Allowed', color: Colors.Green },
                { id: 'category-excluded-a', name: 'Excluded A', color: Colors.Red },
                { id: 'category-excluded-b', name: 'Excluded B', color: Colors.Yellow },
              ],
            },
          },
        ],
        records: [
          { fields: { Reference: 'Reference A', Category: 'Allowed' } },
          { fields: { Reference: 'Reference B', Category: 'Excluded A' } },
          { fields: { Reference: 'Reference C', Category: 'Excluded B' } },
        ],
      });
      const taskTable = await createTable(baseId, {
        name: 'Work Items',
        fields: [
          { name: 'Task', type: FieldType.SingleLineText },
          {
            name: 'Stage',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { id: 'stage-active', name: 'Active', color: Colors.Blue },
                { id: 'stage-planned', name: 'Planned', color: Colors.Gray },
              ],
            },
          },
        ],
        records: [],
      });

      try {
        const linkField = await createField(taskTable.id, {
          name: 'Reference',
          type: FieldType.Link,
          options: {
            foreignTableId: referenceTable.id,
            relationship: Relationship.ManyOne,
          },
        });
        const categoryField = referenceTable.fields.find((field) => field.name === 'Category')!;
        const lookupField = await createField(taskTable.id, {
          name: 'Reference Category',
          type: FieldType.SingleSelect,
          isLookup: true,
          lookupOptions: {
            foreignTableId: referenceTable.id,
            lookupFieldId: categoryField.id,
            linkFieldId: linkField.id,
          },
        });

        await createRecords(taskTable.id, {
          fieldKeyType: FieldKeyType.Name,
          records: [
            {
              fields: {
                Task: 'Allowed task',
                Stage: 'Active',
                Reference: { id: referenceTable.records[0].id },
              },
            },
            {
              fields: {
                Task: 'Excluded task A',
                Stage: 'Active',
                Reference: { id: referenceTable.records[1].id },
              },
            },
            {
              fields: {
                Task: 'Excluded task B',
                Stage: 'Planned',
                Reference: { id: referenceTable.records[2].id },
              },
            },
            { fields: { Task: 'Unlinked task', Stage: 'Planned' } },
          ],
        });

        const viewId = taskTable.defaultViewId!;
        const taskField = taskTable.fields.find((field) => field.name === 'Task')!;
        const stageField = taskTable.fields.find((field) => field.name === 'Stage')!;
        await apiSetViewFilter(taskTable.id, viewId, {
          filter: {
            conjunction: 'and',
            filterSet: [
              { fieldId: lookupField.id, operator: isNotEmpty.value, value: null },
              {
                fieldId: lookupField.id,
                operator: isNoneOf.value,
                value: ['Excluded A', 'Excluded B'],
              },
            ],
          },
        });
        await updateViewSort(taskTable.id, viewId, {
          sort: {
            sortObjs: [
              { fieldId: lookupField.id, order: SortFunc.Asc },
              { fieldId: taskField.id, order: SortFunc.Asc },
            ],
            manualSort: false,
          },
        });
        await updateViewGroup(taskTable.id, viewId, {
          group: [
            { fieldId: lookupField.id, order: SortFunc.Asc },
            { fieldId: stageField.id, order: SortFunc.Asc },
          ],
        });

        const response = await apiGetRecords(taskTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Name,
        });

        expect(response.headers[X_TEABLE_V2_HEADER]).toBe('true');
        expect(response.headers[X_TEABLE_V2_FEATURE_HEADER]).toBe('getRecords');
        expect(response.headers[X_TEABLE_V2_REASON_HEADER]).toBe('env_force_v2_all');
        expect(response.data.records.map((record) => record.fields.Task)).toEqual(['Allowed task']);
      } finally {
        await permanentDeleteTable(baseId, taskTable.id);
        await permanentDeleteTable(baseId, referenceTable.id);
      }
    });
  });
});

describe('Sanitized oneMany lookup of single-value user view filter (e2e)', () => {
  it('emits isMultipleCellValue and accepts hasAnyOf on a oneMany user lookup', async () => {
    await withForceV2All(async () => {
      // Sanitized, structure-equivalent fixture for T6943:
      // table B single-value user -> table A oneMany link + lookup of that user.
      const ownerTable = await createTable(baseId, {
        name: 'Owner Catalog',
        fields: [
          { name: 'Owner Name', type: FieldType.SingleLineText },
          {
            name: 'Owner',
            type: FieldType.User,
            options: { isMultiple: false, shouldNotify: false },
          },
        ],
        records: [],
      });
      const workTable = await createTable(baseId, {
        name: 'Work Items',
        fields: [{ name: 'Task', type: FieldType.SingleLineText }],
        records: [],
      });

      try {
        const ownerField = ownerTable.fields.find((field) => field.name === 'Owner')!;
        const linkField = await createField(workTable.id, {
          name: 'Owners',
          type: FieldType.Link,
          options: {
            foreignTableId: ownerTable.id,
            relationship: Relationship.OneMany,
          },
        });
        const lookupField = await createField(workTable.id, {
          name: 'Owner Lookup',
          type: FieldType.User,
          isLookup: true,
          lookupOptions: {
            foreignTableId: ownerTable.id,
            lookupFieldId: ownerField.id,
            linkFieldId: linkField.id,
          },
        });

        const fields = await getFields(workTable.id);
        const lookupVo = fields.find((field) => field.id === lookupField.id);
        expect(lookupVo?.isMultipleCellValue).toBe(true);

        const operators = getValidFilterOperators(lookupVo!);
        expect(operators).toContain(hasAnyOf.value);
        expect(operators).not.toContain(isAnyOf.value);

        await apiSetViewFilter(workTable.id, workTable.defaultViewId!, {
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: lookupField.id,
                operator: hasAnyOf.value,
                value: [globalThis.testConfig.userId],
              },
            ],
          },
        });

        const updatedView = await getView(workTable.id, workTable.defaultViewId!);
        expect(updatedView.filter).toEqual({
          conjunction: 'and',
          filterSet: [
            {
              fieldId: lookupField.id,
              operator: hasAnyOf.value,
              value: [globalThis.testConfig.userId],
            },
          ],
        });
      } finally {
        await permanentDeleteTable(baseId, workTable.id);
        await permanentDeleteTable(baseId, ownerTable.id);
      }
    });
  });
});
