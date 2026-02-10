/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
import type { INestApplication } from '@nestjs/common';
import {
  Colors,
  FieldKeyType,
  FieldType,
  MultiNumberDisplayType,
  Relationship,
  Role,
  SortFunc,
  defaultNumberFormatting,
} from '@teable/core';
import type { IFieldRo, IUserCellValue } from '@teable/core';
import type { ITableFullVo, IUserMeVo } from '@teable/openapi';
import {
  RangeType,
  IdReturnType,
  getIdsFromRanges as apiGetIdsFromRanges,
  copy as apiCopy,
  paste as apiPaste,
  getFields,
  deleteSelection,
  clear,
  updateViewFilter,
  updateViewSort,
  USER_ME,
  UPDATE_USER_NAME,
  createSpace,
  createBase,
  emailSpaceInvitation,
  getRecords,
} from '@teable/openapi';
import { createNewUserAxios } from './utils/axios-instance/new-user';
import {
  permanentDeleteBase,
  createField,
  getRecord,
  initApp,
  createTable,
  permanentDeleteTable,
  permanentDeleteSpace,
  updateRecordByApi,
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
    await permanentDeleteTable(baseId, table.id);
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
    let table3: ITableFullVo;
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

      table3 = await createTable(baseId, {
        name: 'table3',
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table3' } },
          { fields: { 'text field': 'table3' } },
          { fields: { 'text field': 'table3' } },
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

    it('should paste 2 oneMany link field with same value in same time', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table3.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);
      const linkField2 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: [[{ id: table3.records[0].id }, { id: table3.records[1].id }]],
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [linkField1, linkField2],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table3.records[0].id,
          title: 'table3',
        },
      ]);
      expect(record.fields[linkField2.id]).toEqual([
        {
          id: table3.records[1].id,
          title: 'table3',
        },
      ]);
    });

    it('paste link field with same value', async () => {
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, table1LinkFieldRo);

      await apiPaste(table1.id, {
        viewId: table1.views[0].id,
        content: [['table2_1']],
        ranges: [
          [1, 0],
          [1, 0],
        ],
        header: [table1.fields[0]],
      });

      const record = await getRecord(table1.id, table1.records[0].id);

      expect(record.fields[linkField1.id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
    });
  });

  describe('api/table/:tableId/selection/clear (PATCH)', () => {
    it('should clear a standalone column without touching other fields', async () => {
      const clearTable = await createTable(baseId, {
        name: 'clear-basic',
        fields: [
          {
            name: 'Status',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Notes',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { Status: 'todo', Notes: 'keep-1' } },
          { fields: { Status: 'doing', Notes: 'keep-2' } },
        ],
      });

      try {
        const viewId = clearTable.views[0].id;
        const statusFieldId = clearTable.fields.find((f) => f.name === 'Status')!.id;
        const notesFieldId = clearTable.fields.find((f) => f.name === 'Notes')!.id;

        await clear(clearTable.id, {
          viewId,
          type: RangeType.Columns,
          ranges: [[0, 0]],
        });

        const { data } = await getRecords(clearTable.id, {
          viewId,
          fieldKeyType: FieldKeyType.Id,
        });

        expect(data.records.map((record) => record.fields[statusFieldId] ?? null)).toEqual([
          null,
          null,
        ]);
        expect(data.records.map((record) => record.fields[notesFieldId])).toEqual([
          'keep-1',
          'keep-2',
        ]);
      } finally {
        await permanentDeleteTable(baseId, clearTable.id);
      }
    });

    it('should refresh formula and lookup dependents after clearing a column', async () => {
      const companyTable = await createTable(baseId, {
        name: 'companies-clear',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'City', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'Alpha', City: 'Paris' } },
          { fields: { Name: 'Beta', City: 'Berlin' } },
        ],
      });
      const nameFieldId = companyTable.fields.find((f) => f.name === 'Name')!.id;
      const cityFieldId = companyTable.fields.find((f) => f.name === 'City')!.id;

      const nameFormulaField = await createField(companyTable.id, {
        name: 'Name Tag',
        type: FieldType.Formula,
        options: {
          expression: `IF({${nameFieldId}}, {${nameFieldId}}, "empty")`,
        },
      });
      companyTable.fields.push(nameFormulaField);

      const contactTable = await createTable(baseId, {
        name: 'contacts-clear',
        fields: [{ name: 'Person', type: FieldType.SingleLineText }],
        records: [{ fields: { Person: 'Alice' } }, { fields: { Person: 'Bob' } }],
      });
      const personFieldId = contactTable.fields.find((f) => f.name === 'Person')!.id;

      try {
        const linkField = await createField(contactTable.id, {
          name: 'Company',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: companyTable.id,
          },
        });
        contactTable.fields.push(linkField);

        const companyLookupField = await createField(contactTable.id, {
          name: 'Company Name',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: companyTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: nameFieldId,
          },
        });
        contactTable.fields.push(companyLookupField);

        await updateRecordByApi(contactTable.id, contactTable.records[0].id, linkField.id, {
          id: companyTable.records[0].id,
        });
        await updateRecordByApi(contactTable.id, contactTable.records[1].id, linkField.id, {
          id: companyTable.records[1].id,
        });

        const companyViewId = companyTable.views[0].id;
        await clear(companyTable.id, {
          viewId: companyViewId,
          type: RangeType.Columns,
          ranges: [[0, 0]],
        });

        const companyRecords = await getRecords(companyTable.id, {
          viewId: companyViewId,
          fieldKeyType: FieldKeyType.Id,
        });
        expect(
          companyRecords.data.records.map((record) => record.fields[nameFieldId] ?? null)
        ).toEqual([null, null]);
        expect(
          companyRecords.data.records.map((record) => record.fields[nameFormulaField.id])
        ).toEqual(['empty', 'empty']);
        expect(companyRecords.data.records.map((record) => record.fields[cityFieldId])).toEqual([
          'Paris',
          'Berlin',
        ]);

        const contactViewId = contactTable.views[0].id;
        const contactRecords = await getRecords(contactTable.id, {
          viewId: contactViewId,
          fieldKeyType: FieldKeyType.Id,
        });
        const lookupValues = contactRecords.data.records.map(
          (record) => record.fields[companyLookupField.id] ?? null
        );
        expect(lookupValues).toEqual([null, null]);
        expect(contactRecords.data.records.map((record) => record.fields[personFieldId])).toEqual([
          'Alice',
          'Bob',
        ]);
      } finally {
        await permanentDeleteTable(baseId, contactTable.id);
        await permanentDeleteTable(baseId, companyTable.id);
      }
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

    it('should delete rows matched by hide-not-match search even when matches are beyond base range', async () => {
      const searchTable = await createTable(baseId, {
        name: 'search table',
        fields: [
          {
            name: 'name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { name: 'alpha' } },
          { fields: { name: 'beta' } },
          { fields: { name: 'gamma' } },
          { fields: { name: 'target one' } },
          { fields: { name: 'target two' } },
        ],
      });
      try {
        const viewId = searchTable.views[0].id;
        const result = await deleteSelection(searchTable.id, {
          viewId,
          type: RangeType.Rows,
          ranges: [[0, 1]],
          search: ['target', searchTable.fields[0].id, true],
        });

        expect(result.data.ids).toEqual([searchTable.records[3].id, searchTable.records[4].id]);
      } finally {
        await permanentDeleteTable(baseId, searchTable.id);
      }
    });

    it('should delete selection when filter compares text field to lookup-backed formula', async () => {
      await permanentDeleteTable(baseId, table.id);
      table = await createTable(baseId, {
        name: 'orders',
        fields: [
          {
            name: 'Order Number',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { 'Order Number': 'ORD-001' } },
          { fields: { 'Order Number': 'ORD-002' } },
        ],
      });

      const detailTable = await createTable(baseId, {
        name: 'order details',
        fields: [
          {
            name: 'External Number',
            type: FieldType.SingleLineText,
          },
        ],
        records: [
          { fields: { 'External Number': 'ORD-001' } },
          { fields: { 'External Number': 'ORD-002' } },
        ],
      });

      try {
        const orderNumberField = table.fields.find((f) => f.name === 'Order Number')!;
        const externalNumberField = detailTable.fields.find((f) => f.name === 'External Number')!;

        const linkField = await createField(table.id, {
          name: 'Detail Link',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: detailTable.id,
          },
        });

        const lookupField = await createField(table.id, {
          name: 'External Number Lookup',
          type: FieldType.SingleLineText,
          isLookup: true,
          lookupOptions: {
            foreignTableId: detailTable.id,
            linkFieldId: linkField.id,
            lookupFieldId: externalNumberField.id,
          },
        });

        const formulaField = await createField(table.id, {
          name: 'Match Flag',
          type: FieldType.Formula,
          options: {
            expression: `IF({${orderNumberField.id}} = {${lookupField.id}}, "match", "not-match")`,
          },
        });

        await updateRecordByApi(table.id, table.records[0].id, linkField.id, {
          id: detailTable.records[0].id,
        });

        const record = await getRecord(table.id, table.records[0].id);
        expect(record.fields[formulaField.id]).toBe('match');

        const viewId = table.views[0].id;
        const result = await deleteSelection(table.id, {
          viewId,
          ranges: [
            [0, 0],
            [0, 0],
          ],
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: formulaField.id,
                value: 'match',
                operator: 'is',
              },
            ],
          },
        });

        expect(result.status).toBe(200);
        expect(Array.isArray(result.data.ids)).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, detailTable.id);
      }
    });
  });

  describe('paste user', () => {
    let spaceId: string;
    let baseId: string;
    let tableData: ITableFullVo;
    let user1Info: IUserMeVo;
    let user2Info: IUserMeVo;
    beforeAll(async () => {
      spaceId = await createSpace({
        name: 'paste-same-name-user',
      }).then((res) => res.data.id);
      baseId = await createBase({
        name: 'paste-same-name-user',
        spaceId,
      }).then((res) => res.data.id);

      const user1 = await createNewUserAxios({
        email: 'paste-same-name-user@test.com',
        password: '12345678',
      });
      user1Info = await user1.get<IUserMeVo>(USER_ME).then((res) => res.data);
      const user2 = await createNewUserAxios({
        email: 'paste-same-name-user2@test.com',
        password: '12345678',
      });
      await user2.patch(UPDATE_USER_NAME, {
        name: 'paste-same-name-user',
      });
      user2Info = await user2.get<IUserMeVo>(USER_ME).then((res) => res.data);

      await emailSpaceInvitation({
        spaceId,
        emailSpaceInvitationRo: {
          emails: [user1Info.email, user2Info.email],
          role: Role.Editor,
        },
      });
    });

    beforeEach(async () => {
      tableData = await createTable(baseId, {
        name: 'table3',
        fields: [
          { name: 'name', type: FieldType.SingleLineText },
          { name: 'number', type: FieldType.Number },
          { name: 'user', type: FieldType.User },
        ],
        records: [
          {
            fields: {
              name: '1',
              number: 1,
              user: { id: user1Info.id, title: user1Info.name, email: user1Info.email },
            },
          },
          {
            fields: {
              name: '2',
              number: 2,
              user: { id: user2Info.id, title: user2Info.name, email: user2Info.email },
            },
          },
          {
            fields: {
              name: '3',
              number: 1,
            },
          },
          {
            fields: {
              name: '4',
              number: 2,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, tableData.id);
    });

    afterAll(async () => {
      await permanentDeleteBase(baseId);
      await permanentDeleteSpace(spaceId);
    });

    it('api/table/:tableId/selection/paste (POST) - exist same name user', async () => {
      await apiPaste(tableData.id, {
        viewId: tableData.defaultViewId!,
        content: 'paste-same-name-user',
        ranges: [
          [2, 2],
          [2, 2],
        ],
        header: [tableData.fields[0]],
      });
      const record = await getRecord(tableData.id, tableData.records[2].id);
      expect((record.fields[tableData.fields[2].id] as IUserCellValue)?.title).toBe(
        'paste-same-name-user'
      );
    });

    it('api/table/:tableId/selection/paste (POST) - exist same name user with cell value', async () => {
      await apiPaste(tableData.id, {
        viewId: tableData.defaultViewId!,
        content: [
          [
            {
              id: user2Info.id,
              title: user2Info.name,
              email: user2Info.email,
            },
          ],
          [
            {
              id: user1Info.id,
              title: user1Info.name,
              email: user1Info.email,
            },
          ],
        ],
        ranges: [
          [2, 2],
          [2, 2],
        ],
      });
      const recordsData = await getRecords(tableData.id, {
        viewId: tableData.defaultViewId!,
        skip: 2,
        take: 2,
      }).then((res) => res.data);
      expect(
        recordsData.records.map((r) => (r.fields[tableData.fields[2].name] as IUserCellValue)?.id)
      ).toEqual([user2Info.id, user1Info.id]);
    });
  });

  it('paste content end with newline', async () => {
    await apiPaste(table.id, {
      viewId: table.defaultViewId!,
      content: 'test\ntest2',
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });
    await apiPaste(table.id, {
      viewId: table.defaultViewId!,
      content: 'test3\n',
      ranges: [
        [0, 0],
        [0, 0],
      ],
    });
    const records = await getRecords(table.id, {
      viewId: table.defaultViewId!,
    });
    expect(records.data.records.map((r) => r.fields[table.fields[0].name])).toEqual([
      'test3',
      'test2',
      undefined,
    ]);
  });

  describe('paste with projection', () => {
    let projectionTable: ITableFullVo;

    beforeEach(async () => {
      // Create a table with 4 fields: A, B, C, D
      projectionTable = await createTable(baseId, {
        name: 'projection-table',
        fields: [
          { name: 'Field A', type: FieldType.SingleLineText },
          { name: 'Field B', type: FieldType.SingleLineText },
          { name: 'Field C', type: FieldType.SingleLineText },
          { name: 'Field D', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { 'Field A': 'A1', 'Field B': 'B1', 'Field C': 'C1', 'Field D': 'D1' } },
          { fields: { 'Field A': 'A2', 'Field B': 'B2', 'Field C': 'C2', 'Field D': 'D2' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, projectionTable.id);
    });

    it('should paste correctly when projection order is shuffled', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection order is shuffled: D, B, A (skip C)
      // Original order in table: A, B, C, D
      const projection = [fieldD.id, fieldB.id, fieldA.id];

      // Paste 3 columns of data: should map to D, B, A respectively
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'NewD1\tNewB1\tNewA1',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const firstRecord = recordsData.data.records[0];

      // Verify: should update according to projection order
      expect(firstRecord.fields[fieldA.id]).toBe('NewA1'); // projection column 3
      expect(firstRecord.fields[fieldB.id]).toBe('NewB1'); // projection column 2
      expect(firstRecord.fields[fieldC.id]).toBe('C1'); // not in projection, should remain unchanged
      expect(firstRecord.fields[fieldD.id]).toBe('NewD1'); // projection column 1
    });

    it('should paste correctly when projection order is reversed', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection completely reversed: D, C, B, A
      const projection = [fieldD.id, fieldC.id, fieldB.id, fieldA.id];

      // Paste 2x2 data
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'NewD1\tNewC1\nNewD2\tNewC2',
        ranges: [
          [0, 0],
          [1, 1],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      // Verify first row: column 0 (index 0) maps to D, column 1 (index 1) maps to C
      const firstRecord = recordsData.data.records[0];
      expect(firstRecord.fields[fieldA.id]).toBe('A1'); // not in paste range, should remain unchanged
      expect(firstRecord.fields[fieldB.id]).toBe('B1'); // not in paste range, should remain unchanged
      expect(firstRecord.fields[fieldC.id]).toBe('NewC1');
      expect(firstRecord.fields[fieldD.id]).toBe('NewD1');

      // Verify second row
      const secondRecord = recordsData.data.records[1];
      expect(secondRecord.fields[fieldA.id]).toBe('A2');
      expect(secondRecord.fields[fieldB.id]).toBe('B2');
      expect(secondRecord.fields[fieldC.id]).toBe('NewC2');
      expect(secondRecord.fields[fieldD.id]).toBe('NewD2');
    });

    it('should paste to correct field when using shuffled projection with column offset', async () => {
      const fieldA = projectionTable.fields.find((f) => f.name === 'Field A')!;
      const fieldB = projectionTable.fields.find((f) => f.name === 'Field B')!;
      const fieldC = projectionTable.fields.find((f) => f.name === 'Field C')!;
      const fieldD = projectionTable.fields.find((f) => f.name === 'Field D')!;

      // Projection shuffled order: C, A, D
      const projection = [fieldC.id, fieldA.id, fieldD.id];

      // Paste to column index 1 (maps to Field A in projection)
      await apiPaste(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        content: 'UpdatedA1',
        ranges: [
          [1, 0],
          [1, 0],
        ],
        projection,
      });

      const recordsData = await getRecords(projectionTable.id, {
        viewId: projectionTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const firstRecord = recordsData.data.records[0];

      // Field A should be updated (projection index 1)
      expect(firstRecord.fields[fieldA.id]).toBe('UpdatedA1');
      // Other fields should remain unchanged
      expect(firstRecord.fields[fieldB.id]).toBe('B1');
      expect(firstRecord.fields[fieldC.id]).toBe('C1');
      expect(firstRecord.fields[fieldD.id]).toBe('D1');
    });
  });

  describe('paste with orderBy (view row order)', () => {
    /**
     * Critical test for ensuring paste operations target the correct rows
     * when a view has custom sort order.
     *
     * Without the orderBy parameter, paste would use the default __auto_number order,
     * causing updates to go to the wrong records.
     */
    let sortTable: ITableFullVo;

    beforeEach(async () => {
      // Create a table for sort tests with explicit records
      // Creation order: A(100), B(200), C(300), D(400), E(500)
      // Default order (by auto_number): A, B, C, D, E
      // Descending by Value: E(500), D(400), C(300), B(200), A(100)
      sortTable = await createTable(baseId, {
        name: 'sort-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Value', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'RecordA', Value: 100 } },
          { fields: { Name: 'RecordB', Value: 200 } },
          { fields: { Name: 'RecordC', Value: 300 } },
          { fields: { Name: 'RecordD', Value: 400 } },
          { fields: { Name: 'RecordE', Value: 500 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, sortTable.id);
    });

    it('should paste to correct rows when orderBy is specified (descending)', async () => {
      /**
       * Test scenario:
       * - Records in creation order: A(100), B(200), C(300), D(400), E(500)
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste "Updated" to row 0 with orderBy=[{fieldId: valueFieldId, order: 'desc'}]
       * - Should update E (first in DESC order), NOT A (first in creation order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'SortTestUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Desc }],
      });

      // Verify E was updated (not A)
      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      expect(recordE?.fields[nameField.id]).toBe('SortTestUpdated');
      expect(recordA?.fields[nameField.id]).toBe('RecordA'); // Should remain unchanged
    });

    it('should paste multiple rows in correct sort order', async () => {
      /**
       * Test scenario:
       * - View sorted by Value DESC: E(500), D(400), C(300), B(200), A(100)
       * - Paste to rows 1-3 with orderBy DESC
       * - Should update D, C, B (rows 1-3 in DESC order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'SortRow1\nSortRow2\nSortRow3',
        ranges: [
          [0, 1],
          [0, 3],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Desc }],
      });

      // Verify D, C, B were updated in order
      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordD = records.data.records.find((r) => r.fields[valueField.id] === 400);
      const recordC = records.data.records.find((r) => r.fields[valueField.id] === 300);
      const recordB = records.data.records.find((r) => r.fields[valueField.id] === 200);
      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      expect(recordD?.fields[nameField.id]).toBe('SortRow1'); // First in paste range (row 1 in DESC)
      expect(recordC?.fields[nameField.id]).toBe('SortRow2'); // Second in paste range (row 2 in DESC)
      expect(recordB?.fields[nameField.id]).toBe('SortRow3'); // Third in paste range (row 3 in DESC)
      expect(recordE?.fields[nameField.id]).toBe('RecordE'); // Row 0, not in paste range
      expect(recordA?.fields[nameField.id]).toBe('RecordA'); // Row 4, not in paste range
    });

    it('should paste to correct rows with ascending sort', async () => {
      /**
       * Test scenario:
       * - View sorted by Value ASC: A(100), B(200), C(300), D(400), E(500)
       * - This matches creation order, so row 0 should be A
       * - Paste to row 0 with orderBy ASC
       * - Should update A (first in ASC order)
       */
      const nameField = sortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = sortTable.fields.find((f) => f.name === 'Value')!;

      await apiPaste(sortTable.id, {
        viewId: sortTable.views[0].id,
        content: 'AscTestUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        orderBy: [{ fieldId: valueField.id, order: SortFunc.Asc }],
      });

      const records = await getRecords(sortTable.id, {
        viewId: sortTable.views[0].id,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);
      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);

      expect(recordA?.fields[nameField.id]).toBe('AscTestUpdated');
      expect(recordE?.fields[nameField.id]).toBe('RecordE'); // Should remain unchanged
    });
  });

  describe('paste with view-level sort and filter (no client orderBy)', () => {
    /**
     * Regression test: when the view has a saved sort/filter but the client
     * does NOT send orderBy/filter in the paste request, the paste should
     * still target the correct rows using the view's saved configuration.
     *
     * This tests the v1-to-v2 adapter path where the adapter passes
     * sort:undefined to v2 core, which should then fall back to view defaults.
     */
    let viewSortTable: ITableFullVo;

    beforeEach(async () => {
      viewSortTable = await createTable(baseId, {
        name: 'view-sort-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Value', type: FieldType.Number },
        ],
        records: [
          { fields: { Name: 'RecordA', Value: 100 } },
          { fields: { Name: 'RecordB', Value: 200 } },
          { fields: { Name: 'RecordC', Value: 300 } },
          { fields: { Name: 'RecordD', Value: 400 } },
          { fields: { Name: 'RecordE', Value: 500 } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, viewSortTable.id);
    });

    it('should paste to correct row when view has sort+filter and client omits orderBy', async () => {
      const nameField = viewSortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = viewSortTable.fields.find((f) => f.name === 'Value')!;
      const viewId = viewSortTable.views[0].id;

      // Set view-level sort: Value DESC
      await updateViewSort(viewSortTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: valueField.id, order: SortFunc.Desc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Value >= 200 (filters out RecordA=100)
      await updateViewFilter(viewSortTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: valueField.id,
              value: 200,
              operator: 'isGreaterEqual',
            },
          ],
        },
      });

      // Paste at row 0 WITHOUT orderBy — rely on view defaults
      // Filtered DESC order: E(500), D(400), C(300), B(200)
      // Row 0 should be E(500)
      await apiPaste(viewSortTable.id, {
        viewId,
        content: 'ViewSortUpdated',
        ranges: [
          [0, 0],
          [0, 0],
        ],
        // No orderBy or filter — the view's saved sort/filter should be used
      });

      // Query WITHOUT viewId to see all records (including those filtered out by view)
      const records = await getRecords(viewSortTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      const recordE = records.data.records.find((r) => r.fields[valueField.id] === 500);
      const recordA = records.data.records.find((r) => r.fields[valueField.id] === 100);

      // E should be updated (first in DESC among filtered)
      expect(recordE?.fields[nameField.id]).toBe('ViewSortUpdated');
      // A should remain unchanged (filtered out by the view)
      expect(recordA?.fields[nameField.id]).toBe('RecordA');
    });

    it('should paste to correct middle row when view has sort and client omits orderBy', async () => {
      const nameField = viewSortTable.fields.find((f) => f.name === 'Name')!;
      const valueField = viewSortTable.fields.find((f) => f.name === 'Value')!;
      const viewId = viewSortTable.views[0].id;

      // Set view-level sort: Value DESC (no filter this time)
      await updateViewSort(viewSortTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: valueField.id, order: SortFunc.Desc }],
          manualSort: false,
        },
      });

      // Paste at row 2 WITHOUT orderBy — rely on view sort
      // DESC order: E(500), D(400), C(300), B(200), A(100)
      // Row 2 should be C(300)
      await apiPaste(viewSortTable.id, {
        viewId,
        content: 'ViewSortMiddle',
        ranges: [
          [0, 2],
          [0, 2],
        ],
        // No orderBy — the view's saved sort should be used
      });

      const records = await getRecords(viewSortTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      const recordC = records.data.records.find((r) => r.fields[valueField.id] === 300);

      // C should be updated (row 2 in DESC order)
      expect(recordC?.fields[nameField.id]).toBe('ViewSortMiddle');
    });
  });

  describe('paste with isNoneOf filter and NULL values (production regression)', () => {
    /**
     * Regression test for the production bug where paste targets the wrong record.
     *
     * Production scenario:
     * - A SingleSelect "Status" field with choices ["Open", "InProgress", "Closed"]
     * - Some records have Status = NULL (not set)
     * - View filter: Status isNoneOf ["Closed"]
     * - View sort: Name ASC
     *
     * v1 behavior: `COALESCE(Status, '') NOT IN ('Closed')` — NULL records are INCLUDED
     * v2 bug:      `Status NOT IN ('Closed')` — NULL records are EXCLUDED
     *               (because NULL NOT IN (...) returns NULL which is falsy)
     *
     * The different filtered sets cause row offsets to shift, making paste hit the wrong record.
     */
    let filterTable: ITableFullVo;

    beforeEach(async () => {
      filterTable = await createTable(baseId, {
        name: 'isNoneOf-filter-paste-table',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          {
            name: 'Status',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Open', color: Colors.Blue },
                { name: 'InProgress', color: Colors.Yellow },
                { name: 'Closed', color: Colors.Red },
              ],
            },
          },
        ],
        records: [
          { fields: { Name: 'Alpha', Status: 'Open' } },
          { fields: { Name: 'Bravo', Status: null } }, // NULL status — must be included by isNoneOf
          { fields: { Name: 'Charlie', Status: 'InProgress' } },
          { fields: { Name: 'Delta', Status: null } }, // NULL status — must be included by isNoneOf
          { fields: { Name: 'Echo', Status: 'Closed' } }, // This should be excluded by filter
          { fields: { Name: 'Foxtrot', Status: 'Open' } },
        ],
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, filterTable.id);
    });

    it('should include NULL records in isNoneOf filter and paste to correct row', async () => {
      const nameField = filterTable.fields.find((f) => f.name === 'Name')!;
      const statusField = filterTable.fields.find((f) => f.name === 'Status')!;
      const viewId = filterTable.views[0].id;

      // Set view-level sort: Name ASC
      await updateViewSort(filterTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: nameField.id, order: SortFunc.Asc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Status isNoneOf ["Closed"]
      await updateViewFilter(filterTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusField.id,
              value: ['Closed'],
              operator: 'isNoneOf',
            },
          ],
        },
      });

      // Verify the filtered+sorted order first
      const beforeRecords = await getRecords(filterTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      // Expected ASC order after filtering out "Closed" (Echo):
      // Row 0: Alpha (Open)
      // Row 1: Bravo (NULL) — v1 includes NULL in isNoneOf
      // Row 2: Charlie (InProgress)
      // Row 3: Delta (NULL) — v1 includes NULL in isNoneOf
      // Row 4: Foxtrot (Open)
      expect(beforeRecords.data.records).toHaveLength(5); // 6 - 1 (Closed)
      expect(beforeRecords.data.records[0].fields[nameField.id]).toBe('Alpha');
      expect(beforeRecords.data.records[1].fields[nameField.id]).toBe('Bravo');
      expect(beforeRecords.data.records[2].fields[nameField.id]).toBe('Charlie');
      expect(beforeRecords.data.records[3].fields[nameField.id]).toBe('Delta');
      expect(beforeRecords.data.records[4].fields[nameField.id]).toBe('Foxtrot');

      // Paste at row 3 (Delta, a NULL-status record) WITHOUT client orderBy
      // This is the critical test: if isNoneOf excludes NULLs, the row indices shift
      // and we would incorrectly target a different record
      await apiPaste(filterTable.id, {
        viewId,
        content: 'PastedToDelta',
        ranges: [
          [0, 3],
          [0, 3],
        ],
        // No orderBy or filter — rely on view defaults
      });

      // Re-fetch records without viewId to see all records including filtered ones
      const afterRecords = await getRecords(filterTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });

      // Find all records to check which one was actually updated
      const updatedRecord = afterRecords.data.records.find(
        (r) => r.fields[nameField.id] === 'PastedToDelta'
      );

      // Verify Delta was the one updated (not some other record)
      expect(updatedRecord).toBeDefined();
      // The updated record should have NULL status (was Delta)
      expect(updatedRecord?.fields[statusField.id]).toBeUndefined();

      // Echo (Closed) should remain unchanged — it was filtered out
      const echo = afterRecords.data.records.find((r) => r.fields[statusField.id] === 'Closed');
      expect(echo?.fields[nameField.id]).toBe('Echo');

      // Alpha should remain unchanged
      const alpha = afterRecords.data.records.find(
        (r) => r.fields[statusField.id] === 'Open' && r.fields[nameField.id] !== 'PastedToDelta'
      );
      expect(alpha).toBeDefined();
    });

    it('should paste to first NULL row correctly with isNoneOf filter', async () => {
      const nameField = filterTable.fields.find((f) => f.name === 'Name')!;
      const statusField = filterTable.fields.find((f) => f.name === 'Status')!;
      const viewId = filterTable.views[0].id;

      // Set view-level sort: Name ASC
      await updateViewSort(filterTable.id, viewId, {
        sort: {
          sortObjs: [{ fieldId: nameField.id, order: SortFunc.Asc }],
          manualSort: false,
        },
      });

      // Set view-level filter: Status isNoneOf ["Closed"]
      await updateViewFilter(filterTable.id, viewId, {
        filter: {
          conjunction: 'and',
          filterSet: [
            {
              fieldId: statusField.id,
              value: ['Closed'],
              operator: 'isNoneOf',
            },
          ],
        },
      });

      // Paste at row 1 (Bravo, first NULL-status record)
      await apiPaste(filterTable.id, {
        viewId,
        content: 'PastedToBravo',
        ranges: [
          [0, 1],
          [0, 1],
        ],
      });

      const afterRecords = await getRecords(filterTable.id, {
        viewId,
        fieldKeyType: FieldKeyType.Id,
      });

      // Row 1 in the filtered ASC order should be Bravo (NULL status)
      // After paste, Bravo's Name should be updated
      // Note: since the Name changed, re-sort may change order
      // But we can verify by checking what was at row 1 got updated
      const updatedRecord = afterRecords.data.records.find(
        (r) => r.fields[nameField.id] === 'PastedToBravo'
      );
      expect(updatedRecord).toBeDefined();
      // The updated record should have NULL status (was Bravo)
      expect(updatedRecord?.fields[statusField.id]).toBeUndefined();
    });
  });
});
