/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldType,
  MultiNumberDisplayType,
  Relationship,
  SortFunc,
  defaultNumberFormatting,
} from '@teable/core';
import type { IFieldRo } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  RangeType,
  IdReturnType,
  getIdsFromRanges as apiGetIdsFromRanges,
  copy as apiCopy,
  paste as apiPaste,
  getFields,
  deleteSelection,
  updateViewFilter,
} from '@teable/openapi';
import {
  createField,
  getRecord,
  initApp,
  createTable,
  permanentDeleteTable,
} from './utils/init-app';

describe('OpenAPI SelectionController (e2e)', () => {
  let app: INestApplication;
  let table: ITableFullVo;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  beforeEach(async () => {
    table = await createTable(baseId, { name: 'table1' });
  });

  afterEach(async () => {
    const result = await permanentDeleteTable(baseId, table.id);
    console.log('clear table: ', result);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('getIdsFromRanges', () => {
    it('should return all ids for cell range ', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(1);
      expect(data.fieldIds).toHaveLength(1);
    });

    it('should return all ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toHaveLength(table.fields.length);
    });

    it('should return all ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Columns,
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toHaveLength(2);
    });

    it('should return record ids for cell range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 1],
          ],
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 0]],
          type: RangeType.Columns,
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(table.records.length);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return field ids for cell range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 1],
          ],
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return field ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 1]],
          type: RangeType.Rows,
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(table.fields.length);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return record ids for column range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, {
          viewId,
          ranges: [[0, 0]],
          type: RangeType.Columns,
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });
  });

  describe('past link records', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should paste 2 manyOne link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: 'table2_1\ttable2_2',
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [linkField1, linkField2],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual({
        id: table2.records[0].id,
        title: 'table2_1',
      });
      expect(record.fields[linkField2.id]).toEqual({
        id: table2.records[1].id,
        title: 'table2_2',
      });
    });

    it('should paste 2 oneMany link field in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: 'table2_1\ttable2_2',
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [linkField1, linkField2],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
      expect(record.fields[linkField2.id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'table2_2',
        },
      ]);
    });
  });

  describe('past expand col formula', () => {
    let table1: ITableFullVo;
    const numberField = {
      name: 'count',
      type: FieldType.Number,
      options: {
        formatting: defaultNumberFormatting,
        showAs: {
          type: MultiNumberDisplayType.Bar,
          color: Colors.Blue,
          showValue: true,
          maxValue: 100,
        },
      },
    };
    beforeEach(async () => {
      // create tables
      const fields: IFieldRo[] = [
        {
          name: 'name',
          type: FieldType.SingleLineText,
        },
        numberField,
      ];

      table1 = await createTable(baseId, {
        name: 'table1',
        fields: fields,
        records: [{ fields: { count: 1 } }, { fields: { count: 2 } }, { fields: { count: 3 } }],
      });

      const numberFieldId = table1.fields.find((f) => f.name === 'count')!.id;
      const formulaField: IFieldRo = {
        type: FieldType.Formula,
        name: 'formula',
        options: {
          expression: `{${numberFieldId}}`,
          formatting: numberField.options.formatting,
          showAs: numberField.options.showAs,
        },
      };
      await createField(table1.id, formulaField);
      await createField(table1.id, {
        type: FieldType.SingleLineText,
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
    });

    it('should paste expand col formula', async () => {
      const { content, header } = (
        await apiCopy(table1.id, {
          viewId: table1.views[0].id,
          ranges: [
            [1, 0],
            [2, 3],
          ],
        })
      ).data;
      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content,
        header,
        ranges: [
          [3, 0],
          [3, 0],
        ],
      });
      const fields = (await getFields(table1.id, { viewId: table1.views[0].id })).data;
      expect(fields[4].type).toEqual(numberField.type);
      expect(fields[4].options).toEqual(numberField.options);
    });
  });

  describe('api/table/:tableId/selection/delete (DELETE)', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'table2',
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'number',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { name: 'test', number: 1 } },
          { fields: { name: 'test2', number: 2 } },
          { fields: { name: 'test', number: 1 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should delete selected data', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        type: RangeType.Rows,
        ranges: [
          [0, 0],
          [2, 2],
        ],
      });
      console.log('result.data.ids', result.data.ids, table.records[0].id, table.records[2].id);
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });

    it('should delete selected data with filter', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'test',
              operator: 'is',
            },
          ],
        },
      });
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });

    it('should delete selected data with orderBy', async () => {
      const viewId = table.views[0].id;
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
        orderBy: [
          {
            fieldId: table.fields[0].id,
            order: SortFunc.Desc,
          },
        ],
      });
      expect(result.data.ids).toEqual([table.records[1].id, table.records[0].id]);
    });

    it('should delete selected data with view filter', async () => {
      const viewId = table.views[0].id;
      await updateViewFilter(table.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: table.fields[0].id,
              value: 'test',
              operator: 'is',
            },
          ],
        },
      });
      const result = await deleteSelection(table.id, {
        viewId,
        ranges: [
          [0, 0],
          [1, 1],
        ],
      });
      expect(result.data.ids).toEqual([table.records[0].id, table.records[2].id]);
    });
  });
});
