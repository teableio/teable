/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import { FieldType, Relationship } from '@teable-group/core';
import type { IFieldRo, ITableFullVo } from '@teable-group/core';
import {
  RangeType,
  IdReturnType,
  getIdsFromRanges as apiGetIdsFromRanges,
  paste as apiPaste,
} from '@teable-group/openapi';
import { createField, getRecord, initApp, createTable, deleteTable } from './utils/init-app';

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
    const result = await deleteTable(baseId, table.id);
    console.log('clear table: ', result);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('getIdsFromRanges', () => {
    it('should return all ids for cell range ', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([
            [0, 0],
            [0, 0],
          ]),
          returnType: IdReturnType.All,
        })
      ).data;

      expect(data.recordIds).toHaveLength(1);
      expect(data.fieldIds).toHaveLength(1);
    });

    it('should return all ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 1]]),
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
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 1]]),
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
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([
            [0, 0],
            [0, 1],
          ]),
          returnType: IdReturnType.RecordId,
        })
      ).data;

      expect(data.recordIds).toHaveLength(2);
      expect(data.fieldIds).toBeUndefined();
    });

    it('should return record ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 1]]),
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
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 0]]),
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
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([
            [0, 0],
            [0, 1],
          ]),
          returnType: IdReturnType.FieldId,
        })
      ).data;

      expect(data.fieldIds).toHaveLength(1);
      expect(data.recordIds).toBeUndefined();
    });

    it('should return field ids for row range', async () => {
      const viewId = table.views[0].id;

      const data = (
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 1]]),
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
        await apiGetIdsFromRanges(table.id, viewId, {
          ranges: JSON.stringify([[0, 0]]),
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
      await deleteTable(baseId, table1.id);
      await deleteTable(baseId, table2.id);
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

      await apiPaste(table1.id, table1.views[0].id, {
        content: 'table2_1\ttable2_2',
        range: [
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

      await apiPaste(table1.id, table1.views[0].id, {
        content: 'table2_1\ttable2_2',
        range: [
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
});
