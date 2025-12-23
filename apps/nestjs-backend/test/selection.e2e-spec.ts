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
});
