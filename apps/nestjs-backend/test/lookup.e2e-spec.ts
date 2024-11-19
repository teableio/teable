/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ILinkFieldOptions,
  ILookupOptionsRo,
  INumberFieldOptions,
  LinkFieldCore,
} from '@teable/core';
import {
  Colors,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords, updateRecords } from '@teable/openapi';
import {
  createField,
  deleteField,
  createTable,
  permanentDeleteTable,
  getFields,
  getRecord,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

// All kind of field type (except link)
const defaultFields: IFieldRo[] = [
  {
    name: FieldType.SingleLineText,
    type: FieldType.SingleLineText,
    options: {},
  },
  {
    name: FieldType.Number,
    type: FieldType.Number,
    options: {
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
    },
  },
  {
    name: FieldType.SingleSelect,
    type: FieldType.SingleSelect,
    options: {
      choices: [
        { name: 'todo', color: Colors.Yellow },
        { name: 'doing', color: Colors.Orange },
        { name: 'done', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.MultipleSelect,
    type: FieldType.MultipleSelect,
    options: {
      choices: [
        { name: 'rap', color: Colors.Yellow },
        { name: 'rock', color: Colors.Orange },
        { name: 'hiphop', color: Colors.Green },
      ],
    },
  },
  {
    name: FieldType.Date,
    type: FieldType.Date,
    options: {
      formatting: {
        date: 'YYYY-MM-DD',
        time: TimeFormatting.Hour24,
        timeZone: 'America/New_York',
      },
      defaultValue: 'now',
    },
  },
  {
    name: FieldType.Attachment,
    type: FieldType.Attachment,
    options: {},
  },
  {
    name: FieldType.Formula,
    type: FieldType.Formula,
    options: {
      expression: '1 + 1',
      formatting: {
        type: NumberFormattingType.Decimal,
        precision: 2,
      },
    },
  },
];

describe('OpenAPI Lookup field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  async function updateTableFields(table: ITableFullVo) {
    const tableFields = await getFields(table.id);
    table.fields = tableFields;
    return tableFields;
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('general lookup', () => {
    let table1: ITableFullVo = {} as any;
    let table2: ITableFullVo = {} as any;
    const tables: ITableFullVo[] = [];

    beforeAll(async () => {
      // create table1 with fundamental field
      table1 = await createTable(baseId, {
        name: 'table1',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table1]' })),
      });

      // create table2 with fundamental field
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table2]' })),
      });

      // create link field
      await createField(table1.id, {
        name: 'link[table1]',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });
      // update fields in table after create link field
      await updateTableFields(table1);
      await updateTableFields(table2);
      tables.push(table1, table2);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    beforeEach(async () => {
      // remove all link
      await updateRecordByApi(
        table2.id,
        table2.records[0].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        null
      );
      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        null
      );
      await updateRecordByApi(
        table2.id,
        table2.records[2].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        null
      );
      // add a link record to first row
      await updateRecordByApi(
        table1.id,
        table1.records[0].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[0].id }]
      );
    });

    function getFieldByType(fields: IFieldVo[], type: FieldType) {
      const field = fields.find((field) => field.type === type);
      if (!field) {
        throw new Error('field not found');
      }
      return field;
    }

    function getFieldByName(fields: IFieldVo[], name: string) {
      const field = fields.find((field) => field.name === name);
      if (!field) {
        throw new Error('field not found');
      }
      return field;
    }

    async function lookupFrom(table: ITableFullVo, lookupFieldId: string) {
      const linkField = getFieldByType(table.fields, FieldType.Link) as LinkFieldCore;
      const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;
      const lookupField = foreignTable.fields.find((f) => f.id === lookupFieldId)!;
      const options = lookupField.options as INumberFieldOptions | undefined;
      const lookupFieldRo: IFieldRo = {
        name: `lookup ${lookupField.name} [${table.name}]`,
        type: lookupField.type,
        isLookup: true,
        options: options?.formatting
          ? {
              formatting: options.formatting,
            }
          : undefined,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          linkFieldId: linkField.id,
          lookupFieldId, // getFieldByType(table2.fields, FieldType.SingleLineText).id,
        } as ILookupOptionsRo,
      };

      // create lookup field
      await createField(table.id, lookupFieldRo);

      await updateTableFields(table);
      return getFieldByName(table.fields, lookupFieldRo.name!);
    }

    async function expectLookup(table: ITableFullVo, fieldType: FieldType, updateValue: any) {
      const linkField = getFieldByType(table.fields, FieldType.Link) as LinkFieldCore;
      const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;

      const lookedUpToField = getFieldByType(foreignTable.fields, fieldType);
      const lookupFieldVo = await lookupFrom(table, lookedUpToField.id);

      // update a field that be lookup by previous field
      await updateRecordByApi(
        foreignTable.id,
        foreignTable.records[0].id,
        lookedUpToField.id,
        updateValue
      );

      const record = await getRecord(table.id, table.records[0].id);
      return expect(record.fields[lookupFieldVo.id]);
    }

    it('should update lookupField by remove a linkRecord from cell', async () => {
      const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
      const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

      // update a field that will be lookup by after field
      await updateRecordByApi(table2.id, table2.records[1].id, lookedUpToField.id, 123);
      await updateRecordByApi(table2.id, table2.records[2].id, lookedUpToField.id, 456);

      // add a link record after
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }, { id: table2.records[2].id }]
      );

      const record = await getRecord(table1.id, table1.records[1].id);
      expect(record.fields[lookupFieldVo.id]).toEqual([123, 456]);

      // remove a link record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }]
      );

      const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
      expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([123]);

      // remove all link record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        null
      );

      const recordAfter2 = await getRecord(table1.id, table1.records[1].id);
      expect(recordAfter2.fields[lookupFieldVo.id]).toEqual(undefined);

      // add a link record from many - one field
      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        { id: table1.records[1].id }
      );

      const recordAfter3 = await getRecord(table1.id, table1.records[1].id);
      expect(recordAfter3.fields[lookupFieldVo.id]).toEqual([123]);
    });

    it('should update many - one lookupField by remove a linkRecord from cell', async () => {
      const lookedUpToField = getFieldByType(table1.fields, FieldType.Number);
      const lookupFieldVo = await lookupFrom(table2, lookedUpToField.id);

      // update a field that will be lookup by after field
      await updateRecordByApi(table1.id, table1.records[1].id, lookedUpToField.id, 123);

      // add a link record after
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }, { id: table2.records[2].id }]
      );

      const record1 = await getRecord(table2.id, table2.records[1].id);
      expect(record1.fields[lookupFieldVo.id]).toEqual(123);
      const record2 = await getRecord(table2.id, table2.records[2].id);
      expect(record2.fields[lookupFieldVo.id]).toEqual(123);
      // remove a link record
      const updatedRecord = await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }]
      );

      expect(updatedRecord.fields[getFieldByType(table1.fields, FieldType.Link).id]).toEqual([
        { id: table2.records[1].id },
      ]);

      const record3 = await getRecord(table2.id, table2.records[1].id);
      expect(record3.fields[lookupFieldVo.id]).toEqual(123);
      const record4 = await getRecord(table2.id, table2.records[2].id);
      expect(record4.fields[lookupFieldVo.id]).toEqual(undefined);

      // remove all link record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        null
      );

      const record5 = await getRecord(table2.id, table2.records[1].id);
      expect(record5.fields[lookupFieldVo.id]).toEqual(undefined);

      // add a link record from many - one field
      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        { id: table1.records[1].id }
      );

      const record6 = await getRecord(table2.id, table2.records[1].id);
      expect(record6.fields[lookupFieldVo.id]).toEqual(123);
    });

    it('should update many - one lookupField by replace a linkRecord from cell', async () => {
      const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
      const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

      // update a field that will be lookup by after field
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.SingleLineText).id,
        'A2'
      );
      await updateRecordByApi(
        table1.id,
        table1.records[2].id,
        getFieldByType(table1.fields, FieldType.SingleLineText).id,
        'A3'
      );
      await updateRecordByApi(table2.id, table2.records[1].id, lookedUpToField.id, 123);
      await updateRecordByApi(table2.id, table2.records[2].id, lookedUpToField.id, 456);

      // add a link record after
      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        { id: table1.records[1].id }
      );

      const record = await getRecord(table1.id, table1.records[1].id);
      expect(record.fields[lookupFieldVo.id]).toEqual([123]);

      // replace a link record
      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.Link).id,
        { id: table1.records[2].id }
      );

      const record1 = await getRecord(table1.id, table1.records[1].id);
      expect(record1.fields[lookupFieldVo.id]).toEqual(undefined);

      const record2 = await getRecord(table1.id, table1.records[2].id);
      expect(record2.fields[lookupFieldVo.id]).toEqual([123]);
    });

    it('should update one - many lookupField by add a linkRecord from cell', async () => {
      const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
      const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

      // update a field that will be lookup by after field
      await updateRecordByApi(table2.id, table2.records[1].id, lookedUpToField.id, 123);
      await updateRecordByApi(table2.id, table2.records[2].id, lookedUpToField.id, 456);

      // add a link record after
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }]
      );

      const record = await getRecord(table1.id, table1.records[1].id);
      expect(record.fields[lookupFieldVo.id]).toEqual([123]);

      // // add a link record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }, { id: table2.records[2].id }]
      );

      const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
      expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([123, 456]);
    });

    it('should update one -many lookupField by replace a linkRecord from cell', async () => {
      const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
      const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

      // update a field that will be lookup by after field
      await updateRecordByApi(table2.id, table2.records[1].id, lookedUpToField.id, 123);
      await updateRecordByApi(table2.id, table2.records[2].id, lookedUpToField.id, 456);

      // add a link record after
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }]
      );

      const record = await getRecord(table1.id, table1.records[1].id);
      expect(record.fields[lookupFieldVo.id]).toEqual([123]);

      // replace a link record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[2].id }]
      );

      const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
      expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([456]);
    });

    it('should update lookupField by edit the a looked up text field', async () => {
      (await expectLookup(table1, FieldType.SingleLineText, 'lookup text')).toEqual([
        'lookup text',
      ]);
      (await expectLookup(table2, FieldType.SingleLineText, 'lookup text')).toEqual('lookup text');
    });

    it('should update lookupField by edit the a looked up number field', async () => {
      (await expectLookup(table1, FieldType.Number, 123)).toEqual([123]);
      (await expectLookup(table2, FieldType.Number, 123)).toEqual(123);
    });

    it('should update lookupField by edit the a looked up singleSelect field', async () => {
      (await expectLookup(table1, FieldType.SingleSelect, 'todo')).toEqual(['todo']);
      (await expectLookup(table2, FieldType.SingleSelect, 'todo')).toEqual('todo');
    });

    it('should update lookupField by edit the a looked up multipleSelect field', async () => {
      (await expectLookup(table1, FieldType.MultipleSelect, ['rap'])).toEqual(['rap']);
      (await expectLookup(table2, FieldType.MultipleSelect, ['rap'])).toEqual(['rap']);
    });

    it('should update lookupField by edit the a looked up date field', async () => {
      const now = new Date().toISOString();
      (await expectLookup(table1, FieldType.Date, now)).toEqual([now]);
      (await expectLookup(table2, FieldType.Date, now)).toEqual(now);
    });

    // it('should update lookupField by edit the a looked up attachment field', async () => {
    //   (await expectLookup(table1, FieldType.Attachment, 123)).toEqual([123]);
    // });

    // it('should update lookupField by edit the a looked up formula field', async () => {
    //   (await expectLookup(table1, FieldType.Number, 123)).toEqual([123]);
    // });

    it('should update link field lookup value', async () => {
      // add a link record after
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }]
      );

      await updateRecordByApi(
        table2.id,
        table2.records[1].id,
        getFieldByType(table2.fields, FieldType.SingleLineText).id,
        'text'
      );

      const record = await getRecord(table1.id, table1.records[1].id);

      expect(record.fields[getFieldByType(table1.fields, FieldType.Link).id]).toEqual([
        { id: table2.records[1].id, title: 'text' },
      ]);
    });

    it('should calculate when add a lookup field', async () => {
      const textField = getFieldByType(table1.fields, FieldType.SingleLineText);

      await updateRecordByApi(table1.id, table1.records[0].id, textField.id, 'A1');
      await updateRecordByApi(table1.id, table1.records[1].id, textField.id, 'A2');
      await updateRecordByApi(table1.id, table1.records[2].id, textField.id, 'A3');

      const lookedUpToField = getFieldByType(table1.fields, FieldType.SingleLineText);

      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        getFieldByType(table1.fields, FieldType.Link).id,
        [{ id: table2.records[1].id }, { id: table2.records[2].id }]
      );

      const lookupFieldVo = await lookupFrom(table2, lookedUpToField.id);
      const record1 = await getRecord(table2.id, table2.records[1].id);
      expect(record1.fields[lookupFieldVo.id]).toEqual('A2');
      const record2 = await getRecord(table2.id, table2.records[2].id);
      expect(record2.fields[lookupFieldVo.id]).toEqual('A2');
    });

    it('should delete a field that be lookup', async () => {
      const textFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };
      const textField = await createField(table2.id, textFieldRo);
      const lookupFieldRo = {
        name: 'lookup',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: getFieldByType(table1.fields, FieldType.Link).id,
          lookupFieldId: textField.id,
        } as ILookupOptionsRo,
      };

      const lookupField = await createField(table1.id, lookupFieldRo);

      await deleteField(table2.id, textField.id);
      await deleteField(table1.id, lookupField.id);
    });

    it('should set showAs when create field lookup to a rollup', async () => {
      const rollupFieldRo: IFieldRo = {
        name: 'rollup',
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: getFieldByType(table1.fields, FieldType.Link).id,
          lookupFieldId: getFieldByType(table2.fields, FieldType.Number).id,
        },
      };

      const rollupField = await createField(table1.id, rollupFieldRo);

      const lookupFieldRo: IFieldRo = {
        name: `lookup ${rollupField.name} [${table1.name}]`,
        type: rollupField.type,
        isLookup: true,
        options: {
          showAs: {
            color: Colors.Green,
            maxValue: 100,
            showValue: true,
            type: 'ring',
          },
        },
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: getFieldByType(table2.fields, FieldType.Link).id,
          lookupFieldId: rollupField.id,
        } as ILookupOptionsRo,
      };
      const lookupField = await createField(table2.id, lookupFieldRo);

      expect(lookupField).toMatchObject(lookupFieldRo);
    });
  });

  describe('lookup filter', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, {});
      table2 = await createTable(baseId, {});
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update a simple lookup field', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2.fields[0].id,
        },
      });

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
      ]);

      const record = await getRecord(table1.id, table1.records[0].id);
      expect(record.fields[lookupField.id]).toEqual(['B1']);
    });

    it('should create a lookup field with filter', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });
      const symLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId as string;

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: table2.records.map((r, i) => ({
          id: r.id,
          fields: {
            [table2.fields[0].id]: `B${i + 1}`,
            [symLinkFieldId]: table1.records[0].id,
          },
        })),
      });

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2.fields[0].id,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: table2.fields[0].id,
                value: 'B1',
                operator: 'isNot',
              },
            ],
          },
        },
      });

      const table1Records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records.records[0].fields[lookupField.id]).toEqual(['B2', 'B3']);
    });

    it('should create a many-many lookup field with filter', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });
      const symLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId as string;

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: table2.records.map((r, i) => ({
          id: r.id,
          fields: {
            [table2.fields[0].id]: `B${i + 1}`,
            [symLinkFieldId]: [table1.records[0].id],
          },
        })),
      });

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2.fields[0].id,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: table2.fields[0].id,
                value: 'B1',
                operator: 'isNot',
              },
            ],
          },
        },
      });

      const table1Records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records.records[0].fields[lookupField.id]).toEqual(['B2', 'B3']);
    });

    it('should update a lookup field with filter', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });
      const symLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId as string;

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: table2.records.map((r, i) => ({
          id: r.id,
          fields: {
            [table2.fields[0].id]: `B${i + 1}`,
            [symLinkFieldId]: table1.records[0].id,
          },
        })),
      });

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2.fields[0].id,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: table2.fields[0].id,
                value: 'B1',
                operator: 'isNot',
              },
            ],
          },
        },
      });

      const table1RecordsBefore = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id }))
        .data;
      expect(table1RecordsBefore.records[0].fields[lookupField.id]).toEqual(['B2', 'B3']);

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: table2.records.map((r, i) => ({
          id: r.id,
          fields: {
            [table2.fields[0].id]: `BB${i + 1}`,
          },
        })),
      });

      const table1RecordsAfter = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id }))
        .data;
      expect(table1RecordsAfter.records[0].fields[lookupField.id]).toEqual(['BB1', 'BB2', 'BB3']);
    });

    it('should update a lookup field with filter when add or remove records link', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });
      const symLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId as string;

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkField.id,
          lookupFieldId: table2.fields[0].id,
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: table2.fields[0].id,
                value: 'B1',
                operator: 'isNot',
              },
            ],
          },
        },
      });

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table2.records[1].id,
            fields: {
              [table2.fields[0].id]: 'B2',
              [symLinkFieldId]: table1.records[0].id,
            },
          },
          {
            id: table2.records[2].id,
            fields: {
              [table2.fields[0].id]: 'B3',
              [symLinkFieldId]: table1.records[0].id,
            },
          },
        ],
      });

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table2.records[0].id,
            fields: {
              [table2.fields[0].id]: 'B1',
              [symLinkFieldId]: table1.records[0].id,
            },
          },
        ],
      });

      const table1Records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records.records[0].fields[lookupField.id]).toEqual(['B2', 'B3']);

      // remove a link

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table2.records[0].id,
            fields: {
              [symLinkFieldId]: null,
            },
          },
        ],
      });

      const table1Records2 = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records2.records[0].fields[lookupField.id]).toEqual(['B2', 'B3']);

      // set it to exist a filtered value (key state!)
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[0].id,
            fields: {
              [linkField.id]: [{ id: table2.records[0].id }],
            },
          },
        ],
      });

      // add a link in a multiple value link cell
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[0].id,
            fields: {
              [linkField.id]: [{ id: table2.records[0].id }, { id: table2.records[1].id }],
            },
          },
        ],
      });

      const table1Records3 = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records3.records[0].fields[lookupField.id]).toEqual(['B2']);

      // set it to filtered null
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[0].id,
            fields: { [linkField.id]: [{ id: table2.records[0].id }] },
          },
        ],
      });

      const table1Records4 = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records4.records[0].fields[lookupField.id]).toBeUndefined();

      // set it to null
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[0].id,
            fields: { [linkField.id]: null },
          },
        ],
      });

      const table1Records5 = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records5.records[0].fields[lookupField.id]).toBeUndefined();
    });

    it('should update a many-many self-link lookup field', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      });
      const symLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId as string;

      const lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField.id,
          lookupFieldId: table1.fields[0].id,
        },
      });

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[0].id,
            fields: {
              [table1.fields[0].id]: 'B1',
              [symLinkFieldId]: [table1.records[0].id],
            },
          },
        ],
      });
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: [
          {
            id: table1.records[1].id,
            fields: {
              [table1.fields[0].id]: 'B2',
              [symLinkFieldId]: [table1.records[0].id],
            },
          },
        ],
      });

      const table1Records = (await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id })).data;
      expect(table1Records.records[0].fields[lookupField.id]).toEqual(['B1', 'B2']);
    });
  });
});
