/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type {
  IButtonFieldCellValue,
  IButtonFieldOptions,
  IFieldVo,
  IFilterRo,
  ILinkFieldOptions,
  IViewGroupRo,
  IViewVo,
} from '@teable/core';
import {
  FieldType,
  ViewType,
  RowHeightLevel,
  SortFunc,
  FieldKeyType,
  Colors,
  generateWorkflowId,
} from '@teable/core';
import type { IDuplicateTableVo, ITableFullVo } from '@teable/openapi';
import {
  createField,
  getFields,
  duplicateTable,
  installViewPlugin,
  updateViewColumnMeta,
  updateViewSort,
  updateViewGroup,
  updateViewOptions,
  updateRecord,
  getRecords,
  buttonClick,
} from '@teable/openapi';
import { omit } from 'lodash';
import { x_20 } from './data-helpers/20x';
import { x_20_link, x_20_link_from_lookups } from './data-helpers/20x-link';

import {
  createTable,
  permanentDeleteTable,
  initApp,
  getViews,
  deleteField,
  createView,
  updateViewFilter,
  convertField,
} from './utils/init-app';

describe('OpenAPI TableController for duplicate (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('duplicate table with all kind field', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        // over 63 characters
        name: 'record_query_long_long_long_long_long_long_long_long_long_long_long_long',
        fields: x_20.fields,
        records: x_20.records,
      });

      const singleTextField = table.fields.find((f) => f.name === 'text field')!;

      await updateRecord(table.id, table.records[22].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [singleTextField.id]: 'Text Field 21',
          },
        },
      });

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [singleTextField.id]: 'Text Field -1',
          },
        },
      });

      // convert field to notNull and unique, need to test constraint field duplicate
      await convertField(table.id, singleTextField.id, {
        dbFieldName: singleTextField.dbFieldName,
        name: singleTextField.name,
        options: singleTextField.options,
        type: FieldType.SingleLineText,
        notNull: true,
        unique: true,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const subTableLinkField = subTable.fields.find((f) => f.type === FieldType.Link)!;

      const linkField = (
        await createField(table.id, {
          name: 'link field',
          type: FieldType.Link,
          options: {
            foreignTableId: subTable.id,
            relationship: 'manyMany',
          },
        })
      ).data;

      // test changed link field
      await convertField(table.id, linkField.id, {
        dbFieldName: `${linkField.dbFieldName}_converted`,
        name: linkField.name,
        options: linkField.options,
        type: FieldType.Link,
      });

      await createField(table.id, {
        isLookup: true,
        lookupOptions: {
          foreignTableId: subTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: subTableLinkField.id,
        },
        name: 'lookup link field',
        type: FieldType.Link,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      table.views = await getViews(table.id);
      subTable.fields = (await getFields(subTable.id)).data;
      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: false,
        })
      ).data;
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('should duplicate all fields and views', () => {
      const { fields: sourceFields, views: sourceViews } = table;
      const { fields: targetFields, views: targetViews, viewMap, fieldMap } = duplicateTableData;

      expect(targetFields.length).toBe(sourceFields.length);
      expect(sourceViews.length).toBe(targetViews.length);

      let sourceViewsString = JSON.stringify(sourceViews);
      let sourceFieldsString = JSON.stringify(sourceFields);
      for (const [key, value] of Object.entries(viewMap)) {
        sourceViewsString = sourceViewsString.replaceAll(key, value);
        sourceFieldsString = sourceFieldsString.replaceAll(key, value);
      }

      for (const [key, value] of Object.entries(fieldMap)) {
        sourceViewsString = sourceViewsString.replaceAll(key, value);
        sourceFieldsString = sourceFieldsString.replaceAll(key, value);
      }

      const assertField = JSON.parse(sourceFieldsString) as IFieldVo[];
      const assertViews = JSON.parse(sourceViewsString) as IViewVo[];

      const assertLinkField = assertField
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .map((f) => ({
          ...f,
          options: omit(
            {
              ...f.options,
              // all be one way link
              isOneWay: false,
            },
            ['fkHostTableName', 'selfKeyName', 'symmetricFieldId']
          ),
        }));
      const duplicatedLinkField = targetFields
        .filter(({ type, isLookup }) => type === FieldType.Link && !isLookup)
        .map((f) => ({
          ...f,
          options: omit(
            {
              ...f.options,
              // all be one way link
              isOneWay: false,
            },
            ['fkHostTableName', 'selfKeyName', 'symmetricFieldId']
          ),
        }));

      const otherFieldsWithOutLink = assertField
        .filter(({ type, isLookup }) => type !== FieldType.Link && !isLookup)
        .map((f) => omit(f, ['createdBy', 'createdTime', 'lastModifiedTime', 'lastModifiedBy']));
      const otherAssertFieldsWithOutLink = targetFields
        .filter(({ type, isLookup }) => type !== FieldType.Link && !isLookup)
        .map((f) => omit(f, ['createdBy', 'createdTime', 'lastModifiedTime', 'lastModifiedBy']));

      const duplicatedViews = targetViews.map((v) =>
        omit(v, ['createdBy', 'createdTime', 'lastModifiedTime', 'lastModifiedBy', 'shareId'])
      );

      const assertPureViews = assertViews.map((v) =>
        omit(v, ['createdBy', 'createdTime', 'lastModifiedTime', 'lastModifiedBy', 'shareId'])
      );

      const sortById = (a: any, b: any) => a.id.localeCompare(b.id);

      expect(assertPureViews).toEqual(duplicatedViews);
      expect(assertLinkField).toEqual(duplicatedLinkField);
      expect(otherFieldsWithOutLink.sort(sortById)).toEqual(
        otherAssertFieldsWithOutLink.sort(sortById)
      );
    });
    // it.skip('should create a link field in linked table when link field is two-way-link', async () => {
    //   const fields = (await getFields(subTable.id)).data;
    //   const { fields: targetFields } = duplicateTableData;
    //   const assertField = targetFields.find(({ type }) => type === FieldType.Link)!;
    //   const duplicatedLinkField = fields.find(
    //     (f) =>
    //       f.type === FieldType.Link &&
    //       (f.options as ILinkFieldOptions).symmetricFieldId === assertField.id!
    //   );
    //   expect(duplicatedLinkField).toBeDefined();
    // });
  });

  describe('duplicate table with error field(formula or lookup field)', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    let lookupField: IFieldVo;
    let formulaField: IFieldVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      table.views = await getViews(table.id);
      subTable.fields = (await getFields(subTable.id)).data;

      const primaryField = table.fields.find((f) => f.isPrimary)!;
      const numberField = table.fields.find((f) => f.type === FieldType.Number)!;
      const linkField = table.fields.find((f) => f.type === FieldType.Link)!;
      const lookupedField = subTable.fields.find((f) => f.type === FieldType.Number)!;

      // create a formula field and a lookup field both in degree same field, then delete the field, causing field hasError
      formulaField = (
        await createField(table.id, {
          name: 'error_formulaField',
          type: FieldType.Formula,
          options: {
            expression: `{${primaryField.id}}+{${numberField.id}}`,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        })
      ).data;
      lookupField = (
        await createField(table.id, {
          name: 'error_lookupField',
          type: lookupedField.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: subTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: lookupedField.id,
          },
        })
      ).data;

      await deleteField(table.id, numberField.id);
      await deleteField(subTable.id, lookupedField.id);

      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: false,
        })
      ).data;
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('duplicated formula and lookup field should has error', async () => {
      const sourceFields = (await getFields(table.id)).data;

      const { fields: targetFields, fieldMap } = duplicateTableData;
      const sourceErrorFormulaField = sourceFields.find((f) => f.id === formulaField.id);
      const sourceErrorLookupField = sourceFields.find((f) => f.id === lookupField.id);
      expect(sourceErrorFormulaField?.hasError).toBe(true);
      expect(sourceErrorLookupField?.hasError).toBe(true);

      const targetErrorFormulaField = targetFields.find((f) => f.id === fieldMap[formulaField.id]);
      const targetErrorLookupField = targetFields.find((f) => f.id === fieldMap[lookupField.id]);
      expect(targetErrorFormulaField?.hasError).toBe(true);
      expect(targetErrorLookupField?.hasError).toBe(true);

      let assertErrorFormulaFieldString = JSON.stringify(sourceErrorFormulaField);
      // let assertErrorLookupFieldString = JSON.stringify(sourceErrorLookupField);
      for (const [key, value] of Object.entries(fieldMap)) {
        assertErrorFormulaFieldString = assertErrorFormulaFieldString.replaceAll(key, value);
        // assertErrorLookupFieldString = assertErrorLookupFieldString.replaceAll(key, value);
      }

      const assertErrorFormulaField = JSON.parse(assertErrorFormulaFieldString);
      // const assertErrorLookupField = JSON.parse(assertErrorLookupFieldString);
      expect(assertErrorFormulaField).toEqual(targetErrorFormulaField);
      expect(targetErrorLookupField?.hasError).toBe(true);
    });
  });

  describe('duplicate table with self link', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      table.views = await getViews(table.id);
      subTable.fields = (await getFields(subTable.id)).data;

      await createField(table.id, {
        name: 'self_link',
        type: FieldType.Link,
        options: {
          visibleFieldIds: null,
          foreignTableId: table.id,
          relationship: 'manyMany',
          filter: null,
          filterByViewId: null,
        },
      });

      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: false,
        })
      ).data;
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('should duplicate self link fields', async () => {
      const { fields, id } = duplicateTableData;

      const selfLinkFields = fields.filter(
        (f) => f.type === FieldType.Link && (f.options as ILinkFieldOptions)?.foreignTableId === id
      );

      expect(selfLinkFields.length).toBe(2);
      expect((selfLinkFields[0].options as ILinkFieldOptions).fkHostTableName).toBe(
        (selfLinkFields[1].options as ILinkFieldOptions).fkHostTableName
      );
    });
  });

  describe('duplicate table with all type view', () => {
    let table: ITableFullVo;
    let subTable: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'record_query_x_20',
        fields: x_20.fields,
        records: x_20.records,
      });

      const x20Link = x_20_link(table);
      subTable = await createTable(baseId, {
        name: 'lookup_filter_x_20',
        fields: x20Link.fields,
        records: x20Link.records,
      });

      const x20LinkFromLookups = x_20_link_from_lookups(table, subTable.fields[2].id);
      for (const field of x20LinkFromLookups.fields) {
        await createField(subTable.id, field);
      }

      table.fields = (await getFields(table.id)).data;
      table.views = await getViews(table.id);
      subTable.fields = (await getFields(subTable.id)).data;

      await createField(table.id, {
        name: 'self_link',
        type: FieldType.Link,
        options: {
          visibleFieldIds: null,
          foreignTableId: table.id,
          relationship: 'manyMany',
          filter: null,
          filterByViewId: null,
        },
      });
    });
    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, subTable.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('should duplicate all kind of views', async () => {
      const gridView = (await getViews(table.id))[0];

      const filterRo: IFilterRo = {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.fields.find((f) => f.isPrimary)!.id,
              operator: 'contains',
              value: 'text field',
            },
            {
              conjunction: 'and',
              filterSet: [
                {
                  fieldId: table.fields.find((f) => f.type === FieldType.Number)!.id,
                  operator: 'isGreater',
                  value: 1,
                },
              ],
            },
            {
              fieldId: table.fields.find((f) => f.type === FieldType.SingleSelect)!.id,
              operator: 'is',
              value: 'x',
            },
            {
              fieldId: table.fields.find((f) => f.type === FieldType.Checkbox)!.id,
              operator: 'is',
              value: null,
            },
          ],
        },
      };

      const groupRo: IViewGroupRo = {
        group: [
          {
            fieldId: table.fields.find((f) => f.isPrimary)!.id,
            order: SortFunc.Asc,
          },
        ],
      };

      const sortRo = {
        sort: {
          sortObjs: [
            {
              fieldId: table.fields.find((f) => f.type === FieldType.MultipleSelect)!.id,
              order: SortFunc.Asc,
            },
            {
              fieldId: table.fields.find((f) => f.type === FieldType.Formula)!.id,
              order: SortFunc.Desc,
            },
          ],
        },
      };

      await createView(table.id, {
        name: 'gallery',
        type: ViewType.Gallery,
        filter: filterRo.filter,
        group: groupRo.group,
        sort: sortRo.sort,
        enableShare: true,
      });

      await createView(table.id, {
        name: 'kanban',
        type: ViewType.Kanban,
        group: groupRo.group,
        sort: sortRo.sort,
        options: {
          stackFieldId: table.fields.find((f) => f.isPrimary)!.id,
        },
      });

      await createView(table.id, {
        name: 'calendar',
        type: ViewType.Calendar,
        filter: filterRo.filter,
      });

      await createView(table.id, {
        name: 'table',
        type: ViewType.Form,
        columnMeta: {
          [table.fields.find((f) => f.isPrimary)!.id]: {
            visible: true,
            order: 1,
          },
          [table.fields.find((f) => f.type === FieldType.Number)!.id]: {
            visible: true,
            order: 2,
          },
          [table.fields.find((f) => f.type === FieldType.SingleSelect)!.id]: {
            visible: true,
            order: 3,
          },
        },
      });

      await installViewPlugin(table.id, {
        name: 'sheet',
        pluginId: 'plgsheetform',
      });

      await updateViewFilter(table.id, gridView.id, filterRo);

      await updateViewColumnMeta(table.id, gridView.id, [
        {
          fieldId: table.fields.find((f) => f.type === FieldType.User)!.id,
          columnMeta: { hidden: true },
        },
      ]);

      await updateViewSort(table.id, gridView.id, sortRo);

      await updateViewGroup(table.id, gridView.id, groupRo);

      await updateViewOptions(table.id, gridView.id, {
        options: {
          rowHeight: RowHeightLevel.Tall,
        },
      });

      const sourceViews = await getViews(table.id);

      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: false,
        })
      ).data;

      const targetViews = await getViews(duplicateTableData.id);

      const { fieldMap } = duplicateTableData;
      expect(sourceViews.length).toBe(targetViews.length);
      let assertViewsString = JSON.stringify(
        sourceViews
          .filter((f) => f.type !== ViewType.Plugin)
          .map((v) => ({
            ...omit(v, [
              'createdBy',
              'createdTime',
              'lastModifiedBy',
              'lastModifiedTime',
              'shareId',
              'id',
            ]),
            options: omit(v.options, ['pluginId', 'pluginInstallId']),
          }))
      );

      for (const [key, value] of Object.entries(fieldMap)) {
        assertViewsString = assertViewsString.replaceAll(key, value);
      }

      const assertViews = JSON.parse(assertViewsString);

      expect(assertViews).toEqual(
        targetViews
          .filter((f) => f.type !== ViewType.Plugin)
          .map((v) => ({
            ...omit(v, [
              'createdBy',
              'createdTime',
              'lastModifiedBy',
              'lastModifiedTime',
              'shareId',
              'id',
            ]),
            options: omit(v.options, ['pluginId', 'pluginInstallId']),
          }))
      );
    });
  });

  describe('duplicate formula field relative', () => {
    let table: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'mainTable',
      });

      const numberField = table.fields.find((f) => f.type === FieldType.Number)!;

      await createField(table.id, {
        name: 'formulaField',
        type: FieldType.Formula,
        options: {
          expression: `{${numberField.id}}`,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      });

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [numberField.id]: 1,
          },
        },
      });

      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: true,
        })
      ).data;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('should duplicate formula field calculate normally', async () => {
      const { id, fields } = duplicateTableData;
      const records = (await getRecords(id)).data.records;

      const numberField = fields.find((f) => f.type === FieldType.Number)!;
      const formulaField = fields.find((f) => f.type === FieldType.Formula)!;
      expect(records[0].fields[formulaField.name]).toBe(1);
      await updateRecord(id, records[2].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [numberField.id]: 3,
          },
        },
      });

      const newRecords = (await getRecords(id)).data.records;
      expect(newRecords[0].fields[formulaField.name]).toBe(1);
      expect(newRecords[2].fields[formulaField.name]).toBe(3);
    });
  });

  describe('duplicate table with button field', () => {
    let table: ITableFullVo;
    let duplicateTableData: IDuplicateTableVo;
    beforeAll(async () => {
      table = await createTable(baseId, {
        name: 'mainTable',
      });

      const field = (
        await createField(table.id, {
          type: FieldType.Button,
          options: {
            label: 'click me',
            color: Colors.Teal,
            workflow: {
              id: generateWorkflowId(),
              name: 'test',
              isActive: true,
            },
          },
        })
      ).data;

      const res = await buttonClick(table.id, table.records[0].id, field.id);
      const value = res.data.record.fields[field.id] as IButtonFieldCellValue;
      expect(value.count).toEqual(1);

      duplicateTableData = (
        await duplicateTable(baseId, table.id, {
          name: 'duplicated_table',
          includeRecords: true,
        })
      ).data;
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table.id);
      await permanentDeleteTable(baseId, duplicateTableData.id);
    });

    it('should duplicate button field without workflow and clear click count', async () => {
      const { id, fields } = duplicateTableData;

      const buttonField = fields.find((f) => f.type === FieldType.Button)!;
      expect((buttonField.options as IButtonFieldOptions).workflow).toBeUndefined();

      const records = (
        await getRecords(id, {
          fieldKeyType: FieldKeyType.Id,
        })
      ).data.records;
      expect(records[0].fields[buttonField.id]).toBeUndefined();
    });
  });
});
