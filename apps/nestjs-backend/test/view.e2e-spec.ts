/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import type { IColumn, IFieldRo, IFieldVo, IViewRo } from '@teable/core';
import { FieldKeyType, FieldType, Relationship, ViewType } from '@teable/core';
import type { ICreateTableRo, ITableFullVo } from '@teable/openapi';
import {
  updateViewDescription,
  updateViewName,
  getViewFilterLinkRecords,
  updateViewShareMeta,
  enableShareView,
  updateViewColumnMeta,
  updateRecord,
  getRecords,
} from '@teable/openapi';
import { VIEW_DEFAULT_SHARE_META } from './data-helpers/caces/view-default-share-meta';
import {
  createField,
  getFields,
  initApp,
  createView,
  permanentDeleteTable,
  createTable,
  getViews,
  getView,
  getTable,
} from './utils/init-app';

const defaultViews = [
  {
    name: 'Grid view',
    type: ViewType.Grid,
  },
];

describe('OpenAPI ViewController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    const result = await permanentDeleteTable(baseId, table.id);
    console.log('clear table: ', result);
  });

  it('/api/table/{tableId}/view (GET)', async () => {
    const viewsResult = await getViews(table.id);
    expect(viewsResult).toMatchObject(defaultViews);
  });

  it('/api/table/{tableId}/view (POST)', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    await createView(table.id, viewRo);

    const result = await getViews(table.id);
    expect(result).toMatchObject([
      ...defaultViews,
      {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
      },
    ]);
  });

  it('/api/table/{tableId}/view (POST) with gallery view', async () => {
    const viewRo: IViewRo = {
      name: 'New gallery view',
      description: 'the new gallery view',
      type: ViewType.Gallery,
    };

    const fieldVo = await createField(table.id, {
      name: 'Attachment',
      type: FieldType.Attachment,
    });
    await createView(table.id, viewRo);

    const result = await getViews(table.id);
    expect(result).toMatchObject([
      ...defaultViews,
      {
        name: 'New gallery view',
        description: 'the new gallery view',
        type: ViewType.Gallery,
        options: {
          coverFieldId: fieldVo.id,
        },
      },
    ]);
  });

  it('should update view simple properties', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const view = await createView(table.id, viewRo);

    await updateViewName(table.id, view.id, { name: 'New view 2' });
    await updateViewDescription(table.id, view.id, { description: 'description2' });
    const viewNew = await getView(table.id, view.id);

    expect(viewNew.name).toEqual('New view 2');
    expect(viewNew.description).toEqual('description2');
  });

  it('should create view with field order', async () => {
    // get fields
    const fields = await getFields(table.id);
    const testFieldId = fields?.[0].id;
    const assertOrder = 10;
    const columnMeta = fields.reduce<Record<string, IColumn>>(
      (pre, cur, index) => {
        pre[cur.id] = {} as IColumn;
        pre[cur.id].order = index === 0 ? assertOrder : index;
        return pre;
      },
      {} as Record<string, IColumn>
    );

    const viewResponse = await createView(table.id, {
      name: 'view',
      columnMeta,
      type: ViewType.Grid,
    });

    const { columnMeta: columnMetaResponse } = viewResponse;
    const order = columnMetaResponse?.[testFieldId]?.order;
    expect(order).toEqual(assertOrder);
    expect(fields.length).toEqual(Object.keys(columnMetaResponse).length);
  });

  it('fields in new view should sort by created time and primary field is always first', async () => {
    const viewRo: IViewRo = {
      name: 'New view',
      description: 'the new view',
      type: ViewType.Grid,
    };

    const oldFields: IFieldVo[] = [];
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));
    oldFields.push(await createField(table.id, { type: FieldType.SingleLineText }));

    const newView = await createView(table.id, viewRo);
    const newFields = await getFields(table.id, newView.id);

    expect(newFields.slice(3)).toMatchObject(oldFields);
  });

  describe('/api/table/{tableId}/view/:viewId/filter-link-records (GET)', () => {
    let table: ITableFullVo;
    let linkTable1: ITableFullVo;
    let linkTable2: ITableFullVo;

    const linkTable1FieldRo: IFieldRo[] = [
      {
        name: 'single_line_text_field',
        type: FieldType.SingleLineText,
      },
    ];

    const linkTable2FieldRo: IFieldRo[] = [
      {
        name: 'single_line_text_field',
        type: FieldType.SingleLineText,
      },
    ];

    const linkTable1RecordRo: ICreateTableRo['records'] = [
      {
        fields: {
          single_line_text_field: 'link_table1_record1',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table1_record2',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table1_record3',
        },
      },
    ];
    const linkTable2RecordRo: ICreateTableRo['records'] = [
      {
        fields: {
          single_line_text_field: 'link_table2_record1',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table2_record2',
        },
      },
      {
        fields: {
          single_line_text_field: 'link_table2_record3',
        },
      },
    ];

    beforeAll(async () => {
      const fullTable = await createTable(baseId, {
        name: 'filter_link_records',
        fields: [
          {
            name: 'link_field1',
            type: FieldType.SingleLineText,
          },
        ],
        records: [],
      });

      linkTable1 = await createTable(baseId, {
        name: 'link_table1',
        fields: [
          ...linkTable1FieldRo,
          {
            type: FieldType.Link,
            options: {
              foreignTableId: fullTable.id,
              relationship: Relationship.OneMany,
            },
          },
        ],
        records: linkTable1RecordRo,
      });

      linkTable2 = await createTable(baseId, {
        name: 'link_table2',
        fields: [
          ...linkTable2FieldRo,
          {
            type: FieldType.Link,
            options: {
              foreignTableId: fullTable.id,
              relationship: Relationship.OneMany,
            },
          },
        ],
        records: linkTable2RecordRo,
      });

      table = (await getTable(baseId, fullTable.id, { includeContent: true })) as ITableFullVo;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, linkTable1.id);
      await permanentDeleteTable(baseId, linkTable2.id);
    });

    it('should return filter link records', async () => {
      const viewRo: IViewRo = {
        name: 'New view',
        description: 'the new view',
        type: ViewType.Grid,
        filter: {
          filterSet: [
            {
              fieldId: table.fields![1].id,
              value: linkTable1.records[0].id,
              operator: 'is',
            },
            {
              filterSet: [
                {
                  fieldId: table.fields![1].id,
                  value: [linkTable1.records[1].id, linkTable1.records[2].id],
                  operator: 'isAnyOf',
                },
              ],
              conjunction: 'and',
            },
            {
              fieldId: table.fields![2].id,
              value: linkTable2.records[0].id,
              operator: 'is',
            },
            {
              filterSet: [
                {
                  fieldId: table.fields![2].id,
                  value: [linkTable2.records[2].id],
                  operator: 'isAnyOf',
                },
              ],
              conjunction: 'and',
            },
          ],
          conjunction: 'and',
        },
      };

      const view = await createView(table.id, viewRo);

      const { data: records } = await getViewFilterLinkRecords(table.id, view.id);

      expect(records).toMatchObject([
        {
          tableId: linkTable1.id,
          records: linkTable1.records.map(({ id, name }) => ({ id, title: name })),
        },
        {
          tableId: linkTable2.id,
          records: [
            { id: linkTable2.records[0].id, title: linkTable2.records[0].name },
            {
              id: linkTable2.records[2].id,
              title: linkTable2.records[2].name,
            },
          ],
        },
      ]);
    });
  });

  describe('/api/table/{tableId}/view/:viewId/column-meta (PUT)', () => {
    let tableId: string;
    let gridViewId: string;
    let formViewId: string;
    beforeAll(async () => {
      const table = await createTable(baseId, { name: 'table' });
      tableId = table.id;
      const gridView = await createView(table.id, {
        name: 'Grid view',
        type: ViewType.Grid,
      });
      gridViewId = gridView.id;
      const formView = await createView(table.id, {
        name: 'Form view',
        type: ViewType.Form,
      });
      formViewId = formView.id;
      await enableShareView({ tableId, viewId: formViewId });
      await enableShareView({ tableId, viewId: gridViewId });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, tableId);
    });

    it('update allowCopy success', async () => {
      await updateViewShareMeta(tableId, gridViewId, { allowCopy: true });
      const view = await getView(tableId, gridViewId);
      expect(view.shareMeta?.allowCopy).toBe(true);
    });

    it.each(VIEW_DEFAULT_SHARE_META)(
      'viewType($viewType) with enabled share with default shareMeta',
      async (viewShareDefault) => {
        const view = await createView(tableId, {
          name: `${viewShareDefault.viewType} view`,
          type: viewShareDefault.viewType,
        });
        await enableShareView({ tableId, viewId: view.id });
        const { shareMeta } = await getView(tableId, view.id);
        expect(shareMeta).toEqual(viewShareDefault.defaultShareMeta);
      }
    );
  });

  describe('filter by view ', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table1' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should get records with a field filtered view', async () => {
      const res = await createView(table.id, {
        name: 'view1',
        type: ViewType.Grid,
      });

      await updateViewColumnMeta(table.id, res.id, [
        {
          fieldId: table.fields[1].id,
          columnMeta: {
            hidden: true,
          },
        },
      ]);

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table.fields[0].id]: 'text',
            [table.fields[1].id]: 1,
          },
        },
      });

      const recordResult = await getRecords(table.id, {
        fieldKeyType: FieldKeyType.Id,
        viewId: res.id,
      });
      const fieldResult = await getFields(table.id, res.id);

      expect(recordResult.data.records[0].fields[table.fields[0].id]).toEqual('text');
      expect(recordResult.data.records[0].fields[table.fields[1].id]).toBeUndefined();

      expect(fieldResult.length).toEqual(table.fields.length - 1);
      expect(fieldResult.find((field) => field.id === table.fields[1].id)).toBeUndefined();
    });
  });
});
