/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type INestApplication } from '@nestjs/common';
import type {
  IConditionalRollupFieldOptions,
  IFieldRo,
  IFieldVo,
  IFilter,
  ILinkFieldOptions,
  ILookupLinkOptions,
  ILookupOptionsRo,
  INumberFieldOptions,
  IUnionShowAs,
  LinkFieldCore,
} from '@teable/core';
import {
  CellFormat,
  Colors,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords, updateRecords } from '@teable/openapi';
import { RecordService } from '../src/features/record/record.service';
import {
  createField,
  deleteField,
  createTable,
  permanentDeleteTable,
  getFields,
  getField,
  getRecord,
  initApp,
  createRecords,
  updateRecordByApi,
  convertField,
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
const normalizeSingle = <T>(value: T | T[]) =>
  Array.isArray(value) ? (value.length ? value[0] : undefined) : value;

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

    async function expectLinkText(
      table: ITableFullVo,
      recordId: string,
      linkFieldId: string,
      expectedText: string
    ) {
      const deadline = Date.now() + 15000;
      let lastValue: unknown;
      do {
        const record = await getRecord(table.id, recordId, CellFormat.Text);
        lastValue = record.fields[linkFieldId];
        if (lastValue === expectedText) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < deadline);

      expect(lastValue).toEqual(expectedText);
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

    it('should preserve lookup metadata when renaming via convertField', async () => {
      const linkField = getFieldByType(table1.fields, FieldType.Link) as LinkFieldCore;
      const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;
      const lookedUpField = getFieldByType(foreignTable.fields, FieldType.SingleLineText);
      const lookupName = 'lookup rename safeguard';

      const lookupField = await createField(table1.id, {
        name: lookupName,
        type: lookedUpField.type,
        isLookup: true,
        lookupOptions: {
          foreignTableId: foreignTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: lookedUpField.id,
        } as ILookupOptionsRo,
      } as IFieldRo);

      await updateTableFields(table1);
      const fieldId = lookupField.id;
      const beforeDetail = await getField(table1.id, fieldId);
      const rawLookupOptions = beforeDetail.lookupOptions as ILookupLinkOptions | undefined;
      const normalizedLookupOptions: ILookupOptionsRo | undefined = rawLookupOptions
        ? {
            foreignTableId: rawLookupOptions.foreignTableId,
            lookupFieldId: rawLookupOptions.lookupFieldId,
            linkFieldId: rawLookupOptions.linkFieldId,
            filter: rawLookupOptions.filter,
          }
        : undefined;
      const recordBefore = await getRecord(table1.id, table1.records[0].id);
      const baseline = recordBefore.fields[fieldId];

      try {
        const renamed = await convertField(table1.id, fieldId, {
          name: `${lookupName} renamed`,
          type: lookedUpField.type,
          isLookup: true,
          lookupOptions: normalizedLookupOptions,
          options: beforeDetail.options,
        } as IFieldRo);

        expect(renamed.dbFieldType).toBe(beforeDetail.dbFieldType);
        expect(renamed.isMultipleCellValue).toBe(beforeDetail.isMultipleCellValue);
        expect(renamed.isComputed).toBe(true);
        expect(renamed.lookupOptions).toMatchObject(
          beforeDetail.lookupOptions as Record<string, unknown>
        );

        const recordAfter = await getRecord(table1.id, table1.records[0].id);
        expect(recordAfter.fields[fieldId]).toEqual(baseline);
      } finally {
        await deleteField(table1.id, fieldId);
        await updateTableFields(table1);
      }
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

    it('should expose link display text when requesting text cell format', async () => {
      const linkField = getFieldByType(table1.fields, FieldType.Link);
      const primaryField = getFieldByType(table2.fields, FieldType.SingleLineText);

      await updateRecordByApi(table2.id, table2.records[1].id, primaryField.id, 'text');

      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, [
        { id: table2.records[1].id, title: 'text' },
      ]);

      await expectLinkText(table1, table1.records[1].id, linkField.id, 'text');

      const recordJson = await getRecord(table1.id, table1.records[1].id, CellFormat.Json);
      expect(recordJson.fields[linkField.id]).toEqual([
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
          } as IUnionShowAs,
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

  describe('system field lookup propagation', () => {
    const SOURCE_AUTO_FIELD = 'Auto Number Field';
    const SOURCE_CREATED_TIME_FIELD = 'Created Time Field';
    const SOURCE_LAST_MODIFIED_TIME_FIELD = 'Last Modified Time Field';
    const SOURCE_CREATED_BY_FIELD = 'Created By Field';
    const SOURCE_LAST_MODIFIED_BY_FIELD = 'Last Modified By Field';

    const HOST_LOOKUP_AUTO = 'Lookup Auto Number';
    const HOST_LOOKUP_CREATED_TIME = 'Lookup Created Time';
    const HOST_LOOKUP_LAST_MODIFIED_TIME = 'Lookup Last Modified Time';
    const HOST_LOOKUP_CREATED_BY = 'Lookup Created By';
    const HOST_LOOKUP_LAST_MODIFIED_BY = 'Lookup Last Modified By';

    const CONSUMER_LOOKUP_AUTO = 'Nested Lookup Auto Number';
    const CONSUMER_LOOKUP_CREATED_TIME = 'Nested Lookup Created Time';
    const CONSUMER_LOOKUP_LAST_MODIFIED_TIME = 'Nested Lookup Last Modified Time';
    const CONSUMER_LOOKUP_CREATED_BY = 'Nested Lookup Created By';
    const CONSUMER_LOOKUP_LAST_MODIFIED_BY = 'Nested Lookup Last Modified By';

    let sourceTable: ITableFullVo;
    let hostTable: ITableFullVo;
    let consumerTable: ITableFullVo;
    let hostLinkField: IFieldVo;
    let consumerLinkField: IFieldVo;

    const hostLookupFields: Record<string, IFieldVo> = {};

    async function refreshFields(table: ITableFullVo) {
      const updated = await getFields(table.id);
      table.fields = updated;
      return updated;
    }

    beforeAll(async () => {
      sourceTable = await createTable(baseId, {
        name: 'system-source',
        fields: [
          { name: 'Source Title', type: FieldType.SingleLineText, options: {} },
          { name: SOURCE_AUTO_FIELD, type: FieldType.AutoNumber },
          { name: SOURCE_CREATED_TIME_FIELD, type: FieldType.CreatedTime },
          { name: SOURCE_LAST_MODIFIED_TIME_FIELD, type: FieldType.LastModifiedTime },
          { name: SOURCE_CREATED_BY_FIELD, type: FieldType.CreatedBy },
          { name: SOURCE_LAST_MODIFIED_BY_FIELD, type: FieldType.LastModifiedBy },
        ],
      });

      hostTable = await createTable(baseId, {
        name: 'system-host',
        fields: [{ name: 'Host Title', type: FieldType.SingleLineText, options: {} }],
      });

      consumerTable = await createTable(baseId, {
        name: 'system-consumer',
        fields: [{ name: 'Consumer Title', type: FieldType.SingleLineText, options: {} }],
      });

      await refreshFields(sourceTable);
      await refreshFields(hostTable);
      await refreshFields(consumerTable);

      hostLinkField = await createField(hostTable.id, {
        name: 'Link To Source',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: sourceTable.id,
        } as ILinkFieldOptions,
      });
      hostTable.fields.push(hostLinkField);

      const lookupConfigs: Array<{ name: string; type: FieldType; targetName: string }> = [
        { name: HOST_LOOKUP_AUTO, type: FieldType.AutoNumber, targetName: SOURCE_AUTO_FIELD },
        {
          name: HOST_LOOKUP_CREATED_TIME,
          type: FieldType.CreatedTime,
          targetName: SOURCE_CREATED_TIME_FIELD,
        },
        {
          name: HOST_LOOKUP_LAST_MODIFIED_TIME,
          type: FieldType.LastModifiedTime,
          targetName: SOURCE_LAST_MODIFIED_TIME_FIELD,
        },
        {
          name: HOST_LOOKUP_CREATED_BY,
          type: FieldType.CreatedBy,
          targetName: SOURCE_CREATED_BY_FIELD,
        },
        {
          name: HOST_LOOKUP_LAST_MODIFIED_BY,
          type: FieldType.LastModifiedBy,
          targetName: SOURCE_LAST_MODIFIED_BY_FIELD,
        },
      ];

      for (const config of lookupConfigs) {
        const sourceField = sourceTable.fields.find((f) => f.name === config.targetName);
        if (!sourceField) {
          throw new Error(`Source field ${config.targetName} not found`);
        }
        const createdLookup = await createField(hostTable.id, {
          name: config.name,
          type: config.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: sourceTable.id,
            linkFieldId: hostLinkField.id,
            lookupFieldId: sourceField.id,
          } satisfies ILookupOptionsRo,
        });
        hostLookupFields[config.name] = createdLookup;
        hostTable.fields.push(createdLookup);
      }

      consumerLinkField = await createField(consumerTable.id, {
        name: 'Link To Host',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: hostTable.id,
        } as ILinkFieldOptions,
      });
      consumerTable.fields.push(consumerLinkField);

      const nestedConfigs: Array<{ name: string; hostLookupName: string }> = [
        { name: CONSUMER_LOOKUP_AUTO, hostLookupName: HOST_LOOKUP_AUTO },
        { name: CONSUMER_LOOKUP_CREATED_TIME, hostLookupName: HOST_LOOKUP_CREATED_TIME },
        {
          name: CONSUMER_LOOKUP_LAST_MODIFIED_TIME,
          hostLookupName: HOST_LOOKUP_LAST_MODIFIED_TIME,
        },
        { name: CONSUMER_LOOKUP_CREATED_BY, hostLookupName: HOST_LOOKUP_CREATED_BY },
        {
          name: CONSUMER_LOOKUP_LAST_MODIFIED_BY,
          hostLookupName: HOST_LOOKUP_LAST_MODIFIED_BY,
        },
      ];

      for (const config of nestedConfigs) {
        const hostLookup = hostLookupFields[config.hostLookupName];
        const nestedLookup = await createField(consumerTable.id, {
          name: config.name,
          type: hostLookup.type,
          isLookup: true,
          lookupOptions: {
            foreignTableId: hostTable.id,
            linkFieldId: consumerLinkField.id,
            lookupFieldId: hostLookup.id,
          } satisfies ILookupOptionsRo,
        });
        consumerTable.fields.push(nestedLookup);
      }

      await updateRecordByApi(hostTable.id, hostTable.records[0].id, hostLinkField.id, [
        { id: sourceTable.records[0].id },
      ]);

      await updateRecordByApi(consumerTable.id, consumerTable.records[0].id, consumerLinkField.id, [
        { id: hostTable.records[0].id },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, consumerTable.id);
      await permanentDeleteTable(baseId, hostTable.id);
      await permanentDeleteTable(baseId, sourceTable.id);
    });

    it('should resolve lookup values for system fields', async () => {
      const sourceRecords = await getRecords(sourceTable.id, {
        fieldKeyType: FieldKeyType.Name,
      });
      const hostRecords = await getRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      const sourceRecord = sourceRecords.data.records.find(
        (record) => record.id === sourceTable.records[0].id
      );
      const hostRecord = hostRecords.data.records.find(
        (record) => record.id === hostTable.records[0].id
      );
      expect(sourceRecord).toBeTruthy();
      expect(hostRecord).toBeTruthy();

      expect(hostRecord!.fields[HOST_LOOKUP_AUTO]).toEqual(sourceRecord!.fields[SOURCE_AUTO_FIELD]);
      expect(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_CREATED_TIME] as unknown)).toEqual(
        sourceRecord!.fields[SOURCE_CREATED_TIME_FIELD]
      );
      expect(
        normalizeSingle(hostRecord!.fields[HOST_LOOKUP_LAST_MODIFIED_TIME] as unknown)
      ).toEqual(sourceRecord!.fields[SOURCE_LAST_MODIFIED_TIME_FIELD]);
      expect(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_CREATED_BY] as unknown)).toEqual(
        sourceRecord!.fields[SOURCE_CREATED_BY_FIELD]
      );
      expect(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_LAST_MODIFIED_BY] as unknown)).toEqual(
        sourceRecord!.fields[SOURCE_LAST_MODIFIED_BY_FIELD]
      );
    });

    it('should resolve nested lookup values for system fields', async () => {
      const hostRecords = await getRecords(hostTable.id, { fieldKeyType: FieldKeyType.Name });
      const consumerRecords = await getRecords(consumerTable.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      const hostRecord = hostRecords.data.records.find(
        (record) => record.id === hostTable.records[0].id
      );
      const consumerRecord = consumerRecords.data.records.find(
        (record) => record.id === consumerTable.records[0].id
      );
      expect(hostRecord).toBeTruthy();
      expect(consumerRecord).toBeTruthy();

      expect(consumerRecord!.fields[CONSUMER_LOOKUP_AUTO]).toEqual(
        hostRecord!.fields[HOST_LOOKUP_AUTO]
      );
      expect(
        normalizeSingle(consumerRecord!.fields[CONSUMER_LOOKUP_CREATED_TIME] as unknown)
      ).toEqual(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_CREATED_TIME] as unknown));
      expect(
        normalizeSingle(consumerRecord!.fields[CONSUMER_LOOKUP_LAST_MODIFIED_TIME] as unknown)
      ).toEqual(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_LAST_MODIFIED_TIME] as unknown));
      expect(
        normalizeSingle(consumerRecord!.fields[CONSUMER_LOOKUP_CREATED_BY] as unknown)
      ).toEqual(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_CREATED_BY] as unknown));
      expect(
        normalizeSingle(consumerRecord!.fields[CONSUMER_LOOKUP_LAST_MODIFIED_BY] as unknown)
      ).toEqual(normalizeSingle(hostRecord!.fields[HOST_LOOKUP_LAST_MODIFIED_BY] as unknown));
    });

    it('should return created-by lookup value in updateRecords response', async () => {
      expect(hostLinkField.isMultipleCellValue).toBe(true);
      const linkedRecordIds = sourceTable.records.slice(0, 2).map((record) => ({ id: record.id }));
      const response = await updateRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Name,
        records: [
          {
            id: hostTable.records[0].id,
            fields: {
              [hostLinkField.name]: linkedRecordIds,
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      const lookupFieldId = hostLookupFields[HOST_LOOKUP_CREATED_BY].id;
      const refreshedRecords = await getRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      const refreshedRecord = refreshedRecords.data.records.find(
        (record) => record.id === hostTable.records[0].id
      );
      expect(refreshedRecord).toBeTruthy();
      const refreshedLookupValue = refreshedRecord!.fields[lookupFieldId];
      expect(refreshedLookupValue).toBeTruthy();

      const rawRecords = await getRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.DbFieldName,
        projection: [hostLookupFields[HOST_LOOKUP_CREATED_BY].dbFieldName],
      });
      const rawRecord = rawRecords.data.records.find(
        (record) => record.id === hostTable.records[0].id
      );
      expect(rawRecord).toBeTruthy();
      const rawLookupValue =
        rawRecord!.fields[hostLookupFields[HOST_LOOKUP_CREATED_BY].dbFieldName];
      expect(typeof rawLookupValue).toBe('object');
      if (Array.isArray(refreshedLookupValue) && Array.isArray(rawLookupValue)) {
        expect(rawLookupValue).toHaveLength(refreshedLookupValue.length);
      }
    });

    it('should resolve created-by lookup via table cache snapshot', async () => {
      const linkedRecordIds = sourceTable.records.slice(0, 2).map((record) => ({ id: record.id }));
      await updateRecords(hostTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: hostTable.records[0].id,
            fields: {
              [hostLinkField.id]: linkedRecordIds,
            },
          },
        ],
      });

      const recordService = app.get<RecordService>(RecordService);
      const snapshots = await recordService.getSnapshotBulkWithPermission(
        hostTable.id,
        [hostTable.records[0].id],
        { [hostLookupFields[HOST_LOOKUP_CREATED_BY].id]: true },
        FieldKeyType.Id,
        CellFormat.Json,
        true
      );

      expect(snapshots).toHaveLength(1);
      const snapshot = snapshots[0];
      const lookupFieldId = hostLookupFields[HOST_LOOKUP_CREATED_BY].id;
      const lookupValue = snapshot.data.fields[lookupFieldId];
      expect(lookupValue).toBeTruthy();
      if (Array.isArray(lookupValue)) {
        expect(lookupValue).toHaveLength(linkedRecordIds.length);
        lookupValue.forEach((entry) => {
          expect(entry).toMatchObject({
            id: expect.any(String),
            title: expect.any(String),
          });
        });
      } else {
        expect(lookupValue).toMatchObject({
          id: expect.any(String),
          title: expect.any(String),
        });
      }
    });
  });

  describe('nested lookup dependencies', () => {
    let usersTable: ITableFullVo;
    let projectsTable: ITableFullVo;
    let tasksTable: ITableFullVo;
    let userNameField: IFieldVo;
    let projectNameField: IFieldVo;
    let taskNameField: IFieldVo;
    let projectOwnerLookupField: IFieldVo;
    let taskOwnerLookupField: IFieldVo;
    let projectLinkFieldId: string;
    let taskLinkFieldId: string;
    let userRecordId: string;
    let projectRecordId: string;
    let taskRecordId: string;

    const refreshFields = async (table: ITableFullVo) => {
      table.fields = await getFields(table.id);
    };

    const getFieldByName = (fields: IFieldVo[], name: string) => {
      const field = fields.find((f) => f.name === name);
      if (!field) {
        throw new Error(`Field ${name} not found`);
      }
      return field;
    };

    beforeAll(async () => {
      usersTable = await createTable(baseId, {
        name: 'lookup-nested-users',
        fields: [
          {
            name: 'User Name',
            type: FieldType.SingleLineText,
            options: {},
          },
        ],
      });

      projectsTable = await createTable(baseId, {
        name: 'lookup-nested-projects',
        fields: [
          {
            name: 'Project Name',
            type: FieldType.SingleLineText,
            options: {},
          },
        ],
      });

      tasksTable = await createTable(baseId, {
        name: 'lookup-nested-tasks',
        fields: [
          {
            name: 'Task Name',
            type: FieldType.SingleLineText,
            options: {},
          },
        ],
      });

      await refreshFields(usersTable);
      await refreshFields(projectsTable);
      await refreshFields(tasksTable);

      userNameField = getFieldByName(usersTable.fields, 'User Name');
      projectNameField = getFieldByName(projectsTable.fields, 'Project Name');
      taskNameField = getFieldByName(tasksTable.fields, 'Task Name');

      const projectLinkField = await createField(projectsTable.id, {
        name: 'Project -> User',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: usersTable.id,
        },
      });
      projectLinkFieldId = projectLinkField.id;

      await refreshFields(projectsTable);
      await refreshFields(usersTable);

      projectOwnerLookupField = await createField(projectsTable.id, {
        name: 'Project Owner (lookup)',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: usersTable.id,
          linkFieldId: projectLinkFieldId,
          lookupFieldId: userNameField.id,
        } as ILookupOptionsRo,
      });

      await refreshFields(projectsTable);

      const taskLinkField = await createField(tasksTable.id, {
        name: 'Task -> Project',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: projectsTable.id,
        },
      });
      taskLinkFieldId = taskLinkField.id;

      await refreshFields(tasksTable);
      await refreshFields(projectsTable);

      taskOwnerLookupField = await createField(tasksTable.id, {
        name: 'Task Project Owner (lookup)',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: projectsTable.id,
          linkFieldId: taskLinkFieldId,
          lookupFieldId: projectOwnerLookupField.id,
        } as ILookupOptionsRo,
      });

      await refreshFields(tasksTable);

      const createdUsers = await createRecords(usersTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [userNameField.id]: 'Alice',
            },
          },
        ],
      });
      userRecordId = createdUsers.records[0].id;

      const createdProjects = await createRecords(projectsTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [projectNameField.id]: 'Project Alpha',
            },
          },
        ],
      });
      projectRecordId = createdProjects.records[0].id;

      await updateRecordByApi(projectsTable.id, projectRecordId, projectLinkFieldId, {
        id: userRecordId,
      });

      const createdTasks = await createRecords(tasksTable.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            fields: {
              [taskNameField.id]: 'Task 1',
            },
          },
        ],
      });
      taskRecordId = createdTasks.records[0].id;

      await updateRecordByApi(tasksTable.id, taskRecordId, taskLinkFieldId, {
        id: projectRecordId,
      });
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, tasksTable.id);
      await permanentDeleteTable(baseId, projectsTable.id);
      await permanentDeleteTable(baseId, usersTable.id);
    });

    it('should recompute nested lookup values after relinking', async () => {
      let taskRecord = await getRecord(tasksTable.id, taskRecordId);
      expect(taskRecord.fields[taskOwnerLookupField.id]).toEqual('Alice');

      await updateRecordByApi(tasksTable.id, taskRecordId, taskLinkFieldId, null);

      taskRecord = await getRecord(tasksTable.id, taskRecordId);
      expect(taskRecord.fields[taskOwnerLookupField.id]).toBeUndefined();

      await updateRecordByApi(tasksTable.id, taskRecordId, taskLinkFieldId, {
        id: projectRecordId,
      });

      taskRecord = await getRecord(tasksTable.id, taskRecordId);
      expect(taskRecord.fields[taskOwnerLookupField.id]).toEqual('Alice');
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

    it('should update a lookup field with fiter when update statusField in filterSet', async () => {
      const statusField = await createField(table2.id, {
        type: FieldType.SingleSelect,
        options: {
          choices: [
            { id: 'choX', name: 'x', color: Colors.Cyan },
            { id: 'choY', name: 'y', color: Colors.Blue },
          ],
        },
      });

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
          filter: {
            conjunction: 'and',
            filterSet: [
              {
                fieldId: statusField.id,
                value: 'x',
                operator: 'is',
              },
            ],
          },
        },
      });

      // update from table record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'A1');
      await updateRecordByApi(table2.id, table2.records[0].id, statusField.id, 'x');

      // set to table link
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
        { id: table2.records[0].id },
      ]);

      //  check lookup field
      const record = await getRecord(table1.id, table1.records[0].id);
      expect(record.fields[lookupField.id]).toEqual(['A1']);

      //  update from table record
      await updateRecordByApi(table2.id, table2.records[0].id, statusField.id, 'y');
      console.log('e2euno tablel2 end');

      //  check lookup field
      const recordAfter = await getRecord(table1.id, table1.records[0].id);
      expect(recordAfter.fields[lookupField.id]).toBeUndefined();
    });
  });

  describe('conditional lookup chains', () => {
    const normalizeLookupValues = (value: unknown): unknown[] | undefined => {
      if (value === undefined) {
        return undefined;
      }
      const normalized: unknown[] = [];
      const collect = (item: unknown) => {
        if (Array.isArray(item)) {
          item.forEach(collect);
        } else {
          normalized.push(item);
        }
      };
      collect(value);
      return normalized;
    };

    let leaf: ITableFullVo;
    let middle: ITableFullVo;
    let root: ITableFullVo;

    let middleLinkToLeaf: IFieldVo;
    let leafNameFieldId: string;
    let leafScoreFieldId: string;
    let middleCategoryFieldId: string;
    let rootCategoryFilterFieldId: string;

    let middleLeafNameLookup: IFieldVo;
    let middleLeafScoreLookup: IFieldVo;
    let middleLeafScoreRollup: IFieldVo;

    let rootConditionalNameLookup: IFieldVo;
    let rootConditionalScoreLookup: IFieldVo;
    let rootConditionalRollup: IFieldVo;

    let hardwareRootRecordId: string;
    let softwareRootRecordId: string;

    let categoryMatchFilter: IFilter;

    beforeAll(async () => {
      leaf = await createTable(baseId, {
        name: 'ConditionalLeaf',
        fields: [
          { name: 'LeafName', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'LeafScore', type: FieldType.Number } as IFieldRo,
        ],
        records: [
          { fields: { LeafName: 'Alpha', LeafScore: 10 } },
          { fields: { LeafName: 'Beta', LeafScore: 20 } },
          { fields: { LeafName: 'Gamma', LeafScore: 30 } },
        ],
      });
      leafNameFieldId = leaf.fields.find((field) => field.name === 'LeafName')!.id;
      leafScoreFieldId = leaf.fields.find((field) => field.name === 'LeafScore')!.id;

      middle = await createTable(baseId, {
        name: 'ConditionalMiddle',
        fields: [{ name: 'Category', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Category: 'Hardware' } },
          { fields: { Category: 'Hardware' } },
          { fields: { Category: 'Software' } },
        ],
      });
      middleCategoryFieldId = middle.fields.find((field) => field.name === 'Category')!.id;

      middleLinkToLeaf = await createField(middle.id, {
        name: 'LeafLink',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: leaf.id,
        },
      });

      middleLeafNameLookup = await createField(middle.id, {
        name: 'LeafNames',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: leaf.id,
          linkFieldId: middleLinkToLeaf.id,
          lookupFieldId: leafNameFieldId,
        } as ILookupOptionsRo,
      });

      middleLeafScoreLookup = await createField(middle.id, {
        name: 'LeafScores',
        type: FieldType.Number,
        isLookup: true,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 0,
          },
        },
        lookupOptions: {
          foreignTableId: leaf.id,
          linkFieldId: middleLinkToLeaf.id,
          lookupFieldId: leafScoreFieldId,
        } as ILookupOptionsRo,
      });

      middleLeafScoreRollup = await createField(middle.id, {
        name: 'LeafScoreTotal',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: leaf.id,
          linkFieldId: middleLinkToLeaf.id,
          lookupFieldId: leafScoreFieldId,
        },
      } as IFieldRo);

      // Connect middle records to leaf records for lookup resolution
      await updateRecordByApi(middle.id, middle.records[0].id, middleLinkToLeaf.id, [
        { id: leaf.records[0].id },
      ]);
      await updateRecordByApi(middle.id, middle.records[1].id, middleLinkToLeaf.id, [
        { id: leaf.records[1].id },
      ]);
      await updateRecordByApi(middle.id, middle.records[2].id, middleLinkToLeaf.id, [
        { id: leaf.records[2].id },
      ]);

      root = await createTable(baseId, {
        name: 'ConditionalRoot',
        fields: [{ name: 'CategoryFilter', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { CategoryFilter: 'Hardware' } },
          { fields: { CategoryFilter: 'Software' } },
        ],
      });
      rootCategoryFilterFieldId = root.fields.find((field) => field.name === 'CategoryFilter')!.id;
      hardwareRootRecordId = root.records[0].id;
      softwareRootRecordId = root.records[1].id;

      categoryMatchFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: middleCategoryFieldId,
            operator: 'is',
            value: { type: 'field', fieldId: rootCategoryFilterFieldId },
          },
        ],
      };

      rootConditionalNameLookup = await createField(root.id, {
        name: 'FilteredLeafNames',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: middle.id,
          lookupFieldId: middleLeafNameLookup.id,
          filter: categoryMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      rootConditionalScoreLookup = await createField(root.id, {
        name: 'FilteredLeafScores',
        type: FieldType.Number,
        isLookup: true,
        isConditionalLookup: true,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 0,
          },
        },
        lookupOptions: {
          foreignTableId: middle.id,
          lookupFieldId: middleLeafScoreLookup.id,
          filter: categoryMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      rootConditionalRollup = await createField(root.id, {
        name: 'FilteredLeafScoreSum',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: middle.id,
          lookupFieldId: middleLeafScoreRollup.id,
          expression: 'sum({values})',
          filter: categoryMatchFilter,
        } as IConditionalRollupFieldOptions,
      } as IFieldRo);

      // Link root records to the appropriate middle records
      const rootLinkToMiddle = await createField(root.id, {
        name: 'MiddleLink',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: middle.id,
        },
      });
      await updateRecordByApi(root.id, hardwareRootRecordId, rootLinkToMiddle.id, [
        { id: middle.records[0].id },
        { id: middle.records[1].id },
      ]);
      await updateRecordByApi(root.id, softwareRootRecordId, rootLinkToMiddle.id, [
        { id: middle.records[2].id },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, root.id);
      await permanentDeleteTable(baseId, middle.id);
      await permanentDeleteTable(baseId, leaf.id);
    });

    it('should resolve multi-layer conditional lookup returning text values', async () => {
      const hardwareRecord = await getRecord(root.id, hardwareRootRecordId);
      const softwareRecord = await getRecord(root.id, softwareRootRecordId);

      expect(normalizeLookupValues(hardwareRecord.fields[rootConditionalNameLookup.id])).toEqual([
        'Alpha',
        'Beta',
      ]);
      expect(normalizeLookupValues(softwareRecord.fields[rootConditionalNameLookup.id])).toEqual([
        'Gamma',
      ]);
    });

    it('should resolve multi-layer conditional lookup returning number values', async () => {
      const hardwareRecord = await getRecord(root.id, hardwareRootRecordId);
      const softwareRecord = await getRecord(root.id, softwareRootRecordId);

      expect(normalizeLookupValues(hardwareRecord.fields[rootConditionalScoreLookup.id])).toEqual([
        10, 20,
      ]);
      expect(normalizeLookupValues(softwareRecord.fields[rootConditionalScoreLookup.id])).toEqual([
        30,
      ]);
    });

    it('should compute conditional rollup values from nested lookups', async () => {
      const hardwareRecord = await getRecord(root.id, hardwareRootRecordId);
      const softwareRecord = await getRecord(root.id, softwareRootRecordId);

      expect(hardwareRecord.fields[rootConditionalRollup.id]).toEqual(30);
      expect(softwareRecord.fields[rootConditionalRollup.id]).toEqual(30);
    });
  });

  describe('lookup of multi-value datetime used inside formulas', () => {
    let projectTable: ITableFullVo;
    let contractTable: ITableFullVo;
    let projectNameField: IFieldVo;
    let contractNameField: IFieldVo;
    let contractStartField: IFieldVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let formulaField: IFieldVo;
    let projectRecordId: string;
    const contractRecordIds: string[] = [];

    beforeAll(async () => {
      contractTable = await createTable(baseId, {
        name: 'lookup-contracts',
        fields: [
          { name: 'Contract Name', type: FieldType.SingleLineText, options: {} },
          {
            name: 'Contract Start',
            type: FieldType.Date,
            options: {
              formatting: {
                date: 'YYYY-MM-DD',
                time: TimeFormatting.None,
                timeZone: 'Asia/Shanghai',
              },
            },
          },
        ],
      });

      projectTable = await createTable(baseId, {
        name: 'lookup-projects',
        fields: [{ name: 'Project Name', type: FieldType.SingleLineText, options: {} }],
      });

      await updateTableFields(contractTable);
      await updateTableFields(projectTable);

      contractNameField = contractTable.fields.find((f) => f.name === 'Contract Name')!;
      contractStartField = contractTable.fields.find((f) => f.name === 'Contract Start')!;
      projectNameField = projectTable.fields.find((f) => f.name === 'Project Name')!;

      linkField = await createField(projectTable.id, {
        name: 'Contracts',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: contractTable.id,
        },
      });

      const symmetricLinkFieldId = (linkField.options as ILinkFieldOptions)
        .symmetricFieldId as string;

      await updateTableFields(projectTable);
      await updateTableFields(contractTable);

      lookupField = await createField(projectTable.id, {
        name: 'Contract Starts',
        type: FieldType.Date,
        isLookup: true,
        lookupOptions: {
          foreignTableId: contractTable.id,
          linkFieldId: linkField.id,
          lookupFieldId: contractStartField.id,
        },
      });

      const formulaExpression = `"prefix-" & {${lookupField.id}}`;
      formulaField = await createField(projectTable.id, {
        name: 'Lookup Path',
        type: FieldType.Formula,
        options: { expression: formulaExpression },
      });

      await updateTableFields(projectTable);

      const projectRecords = await createRecords(projectTable.id, {
        typecast: true,
        records: [
          {
            fields: {
              [projectNameField.id]: 'Project Alpha',
            },
          },
        ],
      });
      projectRecordId = projectRecords.records[0].id;

      const contractRecords = await createRecords(contractTable.id, {
        typecast: true,
        records: [
          {
            fields: {
              [contractNameField.id]: 'Contract A',
              [contractStartField.id]: '2024-01-10T00:00:00.000Z',
            },
          },
          {
            fields: {
              [contractNameField.id]: 'Contract B',
              [contractStartField.id]: '2024-02-15T00:00:00.000Z',
            },
          },
        ],
      });

      contractRecordIds.push(...contractRecords.records.map((r) => r.id));

      await updateRecords(contractTable.id, {
        fieldKeyType: FieldKeyType.Id,
        typecast: true,
        records: contractRecordIds.map((id) => ({
          id,
          fields: {
            [symmetricLinkFieldId]: [projectRecordId],
          },
        })),
      });
    });

    afterAll(async () => {
      if (projectTable?.id) {
        await permanentDeleteTable(baseId, projectTable.id);
      }
      if (contractTable?.id) {
        await permanentDeleteTable(baseId, contractTable.id);
      }
    });

    it('should return records when multi-value datetime lookup feeds a string formula', async () => {
      const recordsVo = (await getRecords(projectTable.id, { fieldKeyType: FieldKeyType.Id })).data;
      const projectRecord = recordsVo.records.find((r) => r.id === projectRecordId);
      expect(projectRecord).toBeDefined();

      const lookupValue = projectRecord!.fields[lookupField.id];
      expect(Array.isArray(lookupValue)).toBe(true);
      expect(lookupValue).toHaveLength(2);
      expect(typeof (lookupValue as any[])[0]).toBe('string');

      const formulaValue = projectRecord!.fields[formulaField.id];
      expect(typeof formulaValue).toBe('string');
      expect(formulaValue as string).toContain('prefix-');

      await updateRecordByApi(
        projectTable.id,
        projectRecordId,
        projectNameField.id,
        'Project Beta'
      );
    });
  });
});
