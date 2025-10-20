/* eslint-disable sonarjs/cognitive-complexity */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */

import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  ILinkFieldOptions,
  ILookupLinkOptionsVo,
  LinkFieldCore,
} from '@teable/core';
import {
  Colors,
  DriverClient,
  FieldKeyType,
  FieldType,
  getRandomString,
  NumberFormattingType,
  RatingIcon,
  Relationship,
  isLinkLookupOptions,
} from '@teable/core';
import type { ITableFullVo, IRecordsVo } from '@teable/openapi';
import {
  axios,
  convertField,
  createBase,
  deleteBase,
  deleteRecords,
  planFieldConvert,
  undo,
  updateDbTableName,
  updateRecords,
} from '@teable/openapi';
import { EventEmitterService } from '../src/event-emitter/event-emitter.service';
import { Events } from '../src/event-emitter/events';
import { createAwaitWithEvent } from './utils/event-promise';
import {
  createField,
  createRecords,
  createTable,
  deleteField,
  deleteRecord,
  permanentDeleteTable,
  getField,
  getFields,
  getRecord,
  getRecords,
  getTable,
  initApp,
  updateRecord,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI link (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  const spaceId = globalThis.testConfig.spaceId;
  const split = globalThis.testConfig.driver === 'postgresql' ? '.' : '_';
  let eventEmitterService: EventEmitterService;
  let awaitWithEvent: <T>(fn: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    eventEmitterService = app.get(EventEmitterService);
    const windowId = 'win' + getRandomString(8);
    axios.interceptors.request.use((config) => {
      config.headers['X-Window-Id'] = windowId;
      return config;
    });
    awaitWithEvent = createAwaitWithEvent(eventEmitterService, Events.OPERATION_PUSH);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create table with link field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let table3: ITableFullVo;

    afterEach(async () => {
      table1 && (await permanentDeleteTable(baseId, table1.id));
      table2 && (await permanentDeleteTable(baseId, table2.id));
      table3 && (await permanentDeleteTable(baseId, table3.id));
    });

    it('should format lookup-of-link titles inside formulas when aggregating link records', async () => {
      table1 = await createTable(baseId, {
        name: 'tblA-link-api',
        fields: [
          { name: 'Name', type: FieldType.SingleLineText },
          { name: 'Label', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Name: 'Alpha', Label: 'Alpha Label' } },
          { fields: { Name: 'Beta', Label: 'Beta Label' } },
        ],
      });
      // eslint-disable-next-line no-console

      table2 = await createTable(baseId, {
        name: 'tblB-link-api',
        fields: [
          { name: 'Capture', type: FieldType.SingleLineText },
          { name: 'Shot Time', type: FieldType.SingleLineText },
        ],
        records: [
          { fields: { Capture: 'Screen 1', 'Shot Time': '2024-01-01' } },
          { fields: { Capture: 'Screen 2', 'Shot Time': '2024-02-02' } },
          { fields: { Capture: 'Screen 3', 'Shot Time': '2024-03-03' } },
        ],
      });

      const linkToAField = await createField(table2.id, {
        name: 'LinkToA',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      });
      // eslint-disable-next-line no-console

      await updateRecordByApi(table2.id, table2.records[0].id, linkToAField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[1].id, linkToAField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[2].id, linkToAField.id, {
        id: table1.records[1].id,
      });

      table3 = await createTable(baseId, {
        name: 'tblC-link-api',
        fields: [{ name: 'Entry', type: FieldType.SingleLineText }],
        records: [{ fields: { Entry: 'Group A' } }, { fields: { Entry: 'Group B' } }],
      });

      const linkToBField = await createField(table3.id, {
        name: 'LinkToB',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });

      await updateRecordByApi(table3.id, table3.records[0].id, linkToBField.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);
      await updateRecordByApi(table3.id, table3.records[1].id, linkToBField.id, [
        { id: table2.records[2].id },
      ]);

      const lookupLinkToAField = await createField(table3.id, {
        name: 'LookupLinkToA',
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkToBField.id,
          lookupFieldId: linkToAField.id,
        },
      });

      const shotTimeFieldId = table2.fields.find((f) => f.name === 'Shot Time')!.id;
      const lookupShotTimeField = await createField(table3.id, {
        name: 'LookupShotTime',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          linkFieldId: linkToBField.id,
          lookupFieldId: shotTimeFieldId,
        },
      });

      await createField(table3.id, {
        name: 'Summary',
        type: FieldType.Formula,
        options: {
          expression: `{${lookupLinkToAField.id}} & ' - ' & ARRAYJOIN({${lookupShotTimeField.id}}, ', ')`,
        },
      });

      const recordsVo: IRecordsVo = await getRecords(table3.id, {
        fieldKeyType: FieldKeyType.Name,
      });

      expect(recordsVo.records).toHaveLength(2);
      const summaryA = recordsVo.records.find((r) => r.fields.Entry === 'Group A')!;
      const summaryB = recordsVo.records.find((r) => r.fields.Entry === 'Group B')!;

      expect(typeof summaryA.fields.Summary).toBe('string');
      expect(typeof summaryB.fields.Summary).toBe('string');
    });

    it('should create foreign link field when create a new table with many-one link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      };
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo, linkFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      const getTable1FieldsResult = await getFields(table1.id);

      expect(getTable1FieldsResult).toHaveLength(3);
      expect(getTable1FieldsResult[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          selfKeyName: '__fk_' + table2.fields[2].id,
          foreignKeyName: '__id',
          symmetricFieldId: table2.fields[2].id,
        },
      });

      expect(table2.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          lookupFieldId: getTable1FieldsResult[0].id,
          foreignKeyName: '__fk_' + table2.fields[2].id,
          selfKeyName: '__id',
          symmetricFieldId: getTable1FieldsResult[2].id,
        },
      });
    });

    it('should create foreign link field when create a new table with many-many link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      };
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo, linkFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      const getTable1FieldsResult = await getFields(table1.id);
      expect(getTable1FieldsResult).toHaveLength(3);
      table1.fields = getTable1FieldsResult;

      const fkHostTableName = `${baseId}${split}junction_${table2.fields[2].id}_${
        (table2.fields[2].options as ILinkFieldOptions).symmetricFieldId
      }`;

      expect(table1.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + table2.fields[2].id,
          foreignKeyName: '__fk_' + table1.fields[2].id,
          symmetricFieldId: table2.fields[2].id,
        },
      });

      expect(table2.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + table1.fields[2].id,
          foreignKeyName: '__fk_' + table2.fields[2].id,
          symmetricFieldId: table1.fields[2].id,
        },
      });
    });

    it('should auto create foreign manyOne link field when create oneMany link field', async () => {
      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        fields: [numberFieldRo, textFieldRo],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [numberFieldRo, textFieldRo, linkFieldRo],
      });

      const getTable1FieldsResult = await getFields(table1.id);

      expect(getTable1FieldsResult).toHaveLength(3);
      expect(getTable1FieldsResult[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          selfKeyName: '__id',
          foreignKeyName: '__fk_' + getTable1FieldsResult[2].id,
          symmetricFieldId: table2.fields[2].id,
        },
      });

      expect(table2.fields[2]).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
          lookupFieldId: getTable1FieldsResult[0].id,
          foreignKeyName: '__id',
          selfKeyName: '__fk_' + getTable1FieldsResult[2].id,
          symmetricFieldId: getTable1FieldsResult[2].id,
        },
      });
    });

    it('should set link record in foreign link field when create a new table with link field and link record', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo, linkFieldRo],
        records: [
          {
            fields: {
              'text field': 'table2_1',
              'link field': [{ id: table1.records[0].id }, { id: table1.records[1].id }],
            },
          },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      expect(table2.records).toHaveLength(3);
      expect(table2.records[0].fields['link field']).toEqual([
        { id: table1.records[0].id, title: 'table1_1' },
        { id: table1.records[1].id, title: 'table1_2' },
      ]);
    });

    it('should throw error when create a new table with link field and error link record', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      await createTable(
        baseId,
        {
          name: 'table2',
          fields: [textFieldRo, numberFieldRo, linkFieldRo],
          records: [
            {
              fields: {
                'text field': 'table2_1',
                'link field': [{ id: table1.records[0].id }, { id: table1.records[0].id }], // illegal link record
              },
            },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        },
        400
      );
    });

    it('should have correct title when create a new table with manyOne link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      };

      const table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, linkFieldRo],
        records: [
          {
            fields: {
              'text field': 'table2_1',
              'link field': { id: table1.records[0].id },
            },
          },
        ],
      });
      expect(table2.records[0].fields['link field']).toEqual({
        title: 'table1_1',
        id: table1.records[0].id,
      });
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const table1Fields = await getFields(table1.id);

      expect(table1Records.records[0].fields[table1Fields[1].id]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
    });

    it('should have correct title when create a new table with oneMany link field', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };
      const table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, linkFieldRo],
        records: [
          {
            fields: {
              'text field': 'table2_1',
              'link field': [{ id: table1.records[0].id }],
            },
          },
        ],
      });
      expect(table2.records[0].fields['link field']).toEqual([
        {
          title: 'table1_1',
          id: table1.records[0].id,
        },
      ]);
      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      const table1Fields = await getFields(table1.id);

      expect(table1Records.records[0].fields[table1Fields[1].id]).toEqual({
        title: 'table2_1',
        id: table2.records[0].id,
      });
    });

    it('should create a new record with link field when primary field is a formula', async () => {
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };
      const table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, linkFieldRo],
        records: [
          {
            fields: {
              'text field': 'table2_1',
              'link field': [{ id: table1.records[0].id }],
            },
          },
          {
            fields: {
              'text field': 'table2_2',
            },
          },
        ],
      });

      const table1Fields = await getFields(table1.id);
      const table1LinkField = table1Fields[1];

      const table1PrimaryField = (
        await convertField(table1.id, table1.fields[0].id, {
          type: FieldType.Formula,
          options: {
            expression: `{${table1LinkField.id}}`,
          },
        })
      ).data;

      const table1Records = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });

      expect(table1Records.records[0].fields[table1PrimaryField.id]).toEqual('table2_1');

      // create with existing link cellValue in table2
      await createRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table1LinkField.id]: { id: table2.records[0].id } } }],
      });

      // create with empty link cellValue in table2
      await createRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [{ fields: { [table1LinkField.id]: { id: table2.records[1].id } } }],
      });

      // update with existing link cellValue in table2
      await updateRecordByApi(table1.id, table1.records[0].id, table1LinkField.id, {
        id: table2.records[0].id,
      });

      const table1RecordsAfter = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(table1RecordsAfter.records[0].fields[table1PrimaryField.id]).toEqual('table2_1');
    });
  });

  describe('create link fields', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should create two way, many many link', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);
      const fkHostTableName = `${baseId}${split}junction_${linkField1.id}_${
        (linkField1.options as ILinkFieldOptions).symmetricFieldId
      }`;

      const table2Fields = await getFields(table2.id);
      const linkField2 = table2Fields[2];

      expect(linkField1).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + linkField2.id,
          foreignKeyName: '__fk_' + linkField1.id,
          symmetricFieldId: linkField2.id,
        },
      });

      expect(linkField2).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + linkField1.id,
          foreignKeyName: '__fk_' + linkField2.id,
          symmetricFieldId: linkField1.id,
        },
      });
    });

    it('should create two way, many many link to self', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);
      const fkHostTableName = `${baseId}${split}junction_${linkField1.id}_${
        (linkField1.options as ILinkFieldOptions).symmetricFieldId
      }`;

      const newFields = await getFields(table1.id, table1.views[0].id);
      const linkField2 = newFields[3];

      expect(linkField1).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + linkField2.id,
          foreignKeyName: '__fk_' + linkField1.id,
          symmetricFieldId: linkField2.id,
        },
      });

      expect(linkField2).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          fkHostTableName: fkHostTableName,
          selfKeyName: '__fk_' + linkField1.id,
          foreignKeyName: '__fk_' + linkField2.id,
          symmetricFieldId: linkField1.id,
        },
      });
    });

    it('should create one way, many many link', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);
      const fkHostTableName = `${baseId}${split}junction_${linkField1.id}`;

      expect(linkField1).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
          isOneWay: true,
          fkHostTableName: fkHostTableName,
          lookupFieldId: table2.fields[0].id,
          foreignKeyName: '__fk_' + linkField1.id,
        },
      });
      expect((linkField1.options as ILinkFieldOptions).selfKeyName).toContain('rad');
      expect((linkField1.options as ILinkFieldOptions).symmetricFieldId).toBeUndefined();

      const table2Fields = await getFields(table2.id);
      expect(table2Fields.length).toEqual(2);
    });

    it('should create two way, one one link', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);
      const table2Fields = await getFields(table2.id);
      const linkField2 = table2Fields[2];

      expect(linkField1).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          fkHostTableName: table1.dbTableName,
          lookupFieldId: table2.fields[0].id,
          selfKeyName: '__id',
          foreignKeyName: `__fk_${linkField1.id}`,
          symmetricFieldId: linkField2.id,
        },
      });

      expect(linkField2).toMatchObject({
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table1.id,
          fkHostTableName: table1.dbTableName,
          lookupFieldId: table1.fields[0].id,
          foreignKeyName: '__id',
          selfKeyName: `__fk_${linkField1.id}`,
          symmetricFieldId: linkField1.id,
        },
      });
    });

    it('should throw error when add a duplicate record in one way one one link field', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);

      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      // first update
      await updateRecordByApi(table1.id, table1.records[0].id, linkField1.id, {
        title: 'B1',
        id: table2.records[0].id,
      });

      // update a duplicated link record in other record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        linkField1.id,
        { id: table2.records[0].id },
        400
      );
    });

    it('should throw error when add a duplicate record in one way one one link field in create record', async () => {
      // create link field
      const Link1FieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      const linkField1 = await createField(table1.id, Link1FieldRo);

      await createRecords(
        table1.id,
        {
          records: [
            { fields: { [linkField1.id]: { id: table2.records[0].id } } },
            { fields: { [linkField1.id]: { id: table2.records[0].id } } },
          ],
        },
        400
      );
    });
  });

  describe('many one and one many link field cell update', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
        },
      };

      await createField(table2.id, table2LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'table1_2',
        id: table1.records[1].id,
      });

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
    });

    it('should update foreign link field when change lookupField value', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // add an extra link for table1 record1
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[2].id, {
        title: 'table1_1',
        id: table1.records[0].id,
      });

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'AX');

      const table2RecordResult2 = await getRecords(table2.id);

      expect(table2RecordResult2.records[0].fields[table2.fields[2].name!]).toEqual({
        title: 'AX',
        id: table1.records[0].id,
      });
    });

    it('should update self foreign link with correct title', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);
    });

    it('should update self foreign link with correct formatted title', async () => {
      // use number field as primary field
      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      });

      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 1);
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 2);
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, null);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
        { id: table2.records[2].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: '1.0',
          id: table2.records[0].id,
        },
        {
          title: '2.0',
          id: table2.records[1].id,
        },
        {
          title: undefined,
          id: table2.records[2].id,
        },
      ]);
    });

    it('should update self foreign link with correct currency formatted title', async () => {
      // use number field with currency formatting as primary field
      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Currency, symbol: '$', precision: 2 },
        },
      });

      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set values for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 100.5);
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 250.75);
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, null);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
        { id: table2.records[2].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: '$100.50',
          id: table2.records[0].id,
        },
        {
          title: '$250.75',
          id: table2.records[1].id,
        },
        {
          title: undefined,
          id: table2.records[2].id,
        },
      ]);
    });

    it('should update self foreign link with correct percentage formatted title', async () => {
      // use number field with percentage formatting as primary field
      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Percent, precision: 1 },
        },
      });

      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set values for lookup field (stored as decimal, displayed as percentage)
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 0.25);
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 0.8);
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, null);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
        { id: table2.records[2].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: '25.0%',
          id: table2.records[0].id,
        },
        {
          title: '80.0%',
          id: table2.records[1].id,
        },
        {
          title: undefined,
          id: table2.records[2].id,
        },
      ]);
    });

    it('should update self foreign link with correct rating field formatted title', async () => {
      // use rating field as primary field
      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.Rating,
        options: {
          icon: RatingIcon.Star,
          color: Colors.YellowBright,
          max: 5,
        },
      });

      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });
      // set values for rating field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 3);
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 5);
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, null);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
        { id: table2.records[2].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: '3',
          id: table2.records[0].id,
        },
        {
          title: '5',
          id: table2.records[1].id,
        },
        {
          title: undefined,
          id: table2.records[2].id,
        },
      ]);
    });

    it('should update self foreign link with correct auto number field formatted title', async () => {
      // use auto number field as primary field
      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.AutoNumber,
      });

      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
        { id: table2.records[2].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      // Auto number fields should be formatted as text
      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: '1',
          id: table2.records[0].id,
        },
        {
          title: '2',
          id: table2.records[1].id,
        },
        {
          title: '3',
          id: table2.records[2].id,
        },
      ]);
    });

    it('should update formula field when change manyOne link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      };
      await createField(table2.id, table2FormulaFieldRo);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'illegal title',
        id: table1.records[1].id,
      });

      const table1RecordResult = await getRecords(table1.id);
      const table2RecordResult = await getRecords(table2.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
      expect(table2RecordResult.records[0].fields[table2FormulaFieldRo.name!]).toEqual('table1_2');
    });

    it('should update formula field when change oneMany link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      const table1FormulaFieldRo: IFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${table1.fields[2].id}}`,
        },
      };

      await createField(table1.id, table1FormulaFieldRo);

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[2].name]: [
              { title: 'illegal test1', id: table2.records[0].id },
              { title: 'illegal test2', id: table2.records[1].id },
            ],
          },
        },
      });
      const table1RecordResult = await getRecords(table1.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'table2_1', id: table2.records[0].id },
        { title: 'table2_2', id: table2.records[1].id },
      ]);

      expect(table1RecordResult.records[0].fields[table1FormulaFieldRo.name!]).toEqual([
        'table2_1',
        'table2_2',
      ]);
    });

    it('should throw error when add a duplicate record in oneMany link field', async () => {
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // first update
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      // update a duplicated link record in other record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        table1.fields[2].id,
        [{ title: 'B1', id: table2.records[0].id }],
        400
      );

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);
      expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toBeUndefined();
    });

    it('should throw error when add a duplicate record in oneMany link field in create record', async () => {
      await createRecords(
        table1.id,
        {
          records: [
            {
              fields: {
                [table1.fields[2].id]: [{ id: table2.records[0].id }, { id: table2.records[0].id }],
              },
            },
          ],
        },
        400
      );

      await createRecords(
        table1.id,
        {
          records: [
            { fields: { [table1.fields[2].id]: [{ id: table2.records[0].id }] } },
            { fields: { [table1.fields[2].id]: [{ id: table2.records[0].id }] } },
          ],
        },
        400
      );
    });

    it('should preserve multiple linkages created by concurrent requests', async () => {
      const [createResp1, createResp2] = await Promise.all([
        createRecords(table2.id, {
          records: [
            {
              fields: {
                [table2.fields[0].id]: 'table2_4',
                [table2.fields[2].id]: { id: table1.records[0].id },
              },
            },
          ],
        }),
        createRecords(table2.id, {
          records: [
            {
              fields: {
                [table2.fields[0].id]: 'table2_5',
                [table2.fields[2].id]: { id: table1.records[0].id },
              },
            },
          ],
        }),
      ]);

      const createdRecords = [createResp1.records[0], createResp2.records[0]];

      expect(createdRecords).toHaveLength(2);
      expect(createdRecords[0].id).not.toEqual(createdRecords[1].id);
      for (const createdRecord of createdRecords) {
        expect(createdRecord.fields[table2.fields[2].id] as { id: string }).toMatchObject({
          id: table1.records[0].id,
        });
      }

      const table1Record = await getRecord(table1.id, table1.records[0].id);
      const linkedRecords = table1Record.fields[table1.fields[2].id] as Array<{
        id: string;
        title?: string;
      }>;

      expect(linkedRecords).toHaveLength(2);
      expect(linkedRecords).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: createdRecords[0].id, title: 'table2_4' }),
          expect.objectContaining({ id: createdRecords[1].id, title: 'table2_5' }),
        ])
      );

      const refreshedFirst = await getRecord(table2.id, createdRecords[0].id);
      const refreshedSecond = await getRecord(table2.id, createdRecords[1].id);

      for (const refreshed of [refreshedFirst, refreshedSecond]) {
        expect(refreshed.fields[table2.fields[2].id] as { id: string }).toMatchObject({
          id: table1.records[0].id,
        });
      }
    });

    it('should set a text value in a link record with typecast', async () => {
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'A1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');
      // // reject data when typecast is false
      await createRecords(
        table2.id,
        {
          typecast: false,
          records: [
            {
              fields: {
                [table2.fields[2].id]: ['A1'],
              },
            },
          ],
        },
        400
      );

      const { records } = await createRecords(table2.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table2.fields[2].id]: 'A1',
            },
          },
        ],
      });

      expect(records[0].fields[table2.fields[2].id]).toEqual({
        id: table1.records[0].id,
        title: 'A1',
      });

      const { records: records2 } = await createRecords(table1.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table1.fields[2].id]: 'B2',
            },
          },
        ],
      });

      expect(records2[0].fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'B2',
        },
      ]);
    });

    it('should update link cellValue when change primary field value', async () => {
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1+');

      const record1 = await getRecord(table1.id, table1.records[0].id);

      expect(record1.fields[table1.fields[2].id]).toEqual([
        {
          title: 'B1+',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2+');
      const record2 = await getRecord(table1.id, table1.records[0].id);
      expect(record2.fields[table1.fields[2].id]).toEqual([
        {
          title: 'B1+',
          id: table2.records[0].id,
        },
        {
          title: 'B2+',
          id: table2.records[1].id,
        },
      ]);
    });

    it('should not insert illegal value in link cel', async () => {
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, ['NO'], 400);
    });
  });

  describe('many many link field cell update', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      };

      await createField(table2.id, table2LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          id: table1.records[0].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          title: 'table1_2',
          id: table1.records[1].id,
        },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
    });

    it('should update foreign link field when change lookupField value', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          id: table1.records[0].id,
        },
      ]);
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // add an extra link for table1 record1
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[2].id, [
        {
          title: 'table1_1',
          id: table1.records[0].id,
        },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'AX');

      const table2RecordResult2 = await getRecords(table2.id);

      expect(table2RecordResult2.records[0].fields[table2.fields[2].name!]).toEqual([
        {
          title: 'AX',
          id: table1.records[0].id,
        },
      ]);
    });

    it('should update self foreign link with correct title', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          id: table1.records[0].id,
        },
      ]);
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B1',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);
    });

    it('should update formula field when change link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          id: table1.records[0].id,
        },
      ]);

      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      };

      await createField(table2.id, table2FormulaFieldRo);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        {
          title: 'illegal title',
          id: table1.records[1].id,
        },
      ]);

      const table1RecordResult = await getRecords(table1.id);

      const table2RecordResult = await getRecords(table2.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'table2_1',
          id: table2.records[0].id,
        },
      ]);
      expect(table2RecordResult.records[0].fields[table2FormulaFieldRo.name!]).toEqual([
        'table1_2',
      ]);
    });

    it('should update formula field with function when change link cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        { id: table1.records[0].id },
      ]);

      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `AND({${table2.fields[2].id}})`,
        },
      };

      await createField(table2.id, table2FormulaFieldRo);

      const t2r1 = await getRecords(table2.id);

      expect(t2r1.records[0].fields[table2FormulaFieldRo.name!]).toEqual(true);

      // replace
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        { id: table1.records[1].id },
      ]);

      const t2r2 = await getRecords(table2.id);

      expect(t2r2.records[0].fields[table2FormulaFieldRo.name!]).toEqual(true);

      // add
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        { id: table1.records[1].id },
        { id: table1.records[2].id },
      ]);

      const t2r3 = await getRecords(table2.id);

      expect(t2r3.records[0].fields[table2FormulaFieldRo.name!]).toEqual(true);

      // remove
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, [
        { id: table1.records[1].id },
      ]);

      const t2r4 = await getRecords(table2.id);

      expect(t2r4.records[0].fields[table2FormulaFieldRo.name!]).toEqual(true);
    });

    it('should update formula field when change many many link cell', async () => {
      const table1FormulaFieldRo: IFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${table1.fields[2].id}}`,
        },
      };

      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      };

      await createField(table1.id, table1FormulaFieldRo);
      await createField(table2.id, table2FormulaFieldRo);

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[2].name]: [
              { title: 'illegal test1', id: table2.records[0].id },
              { title: 'illegal test2', id: table2.records[1].id },
            ],
          },
        },
      });

      const table1RecordResult = await getRecords(table1.id);
      const table2RecordResult = await getRecords(table2.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'table2_1', id: table2.records[0].id },
        { title: 'table2_2', id: table2.records[1].id },
      ]);

      expect(table2RecordResult.records[0].fields[table2.fields[2].name]).toEqual([
        { title: 'table1_1', id: table1.records[0].id },
      ]);
      expect(table2RecordResult.records[1].fields[table2.fields[2].name]).toEqual([
        { title: 'table1_1', id: table1.records[0].id },
      ]);

      expect(table1RecordResult.records[0].fields[table1FormulaFieldRo.name!]).toEqual([
        'table2_1',
        'table2_2',
      ]);

      expect(table2RecordResult.records[0].fields[table2FormulaFieldRo.name!]).toEqual([
        'table1_1',
      ]);
      expect(table2RecordResult.records[1].fields[table2FormulaFieldRo.name!]).toEqual([
        'table1_1',
      ]);
    });

    it('should throw error when add a duplicate record within one cell', async () => {
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // first update
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      // allow to update a duplicated link record in other record
      await updateRecordByApi(table1.id, table1.records[1].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
      ]);

      // not allow to update a duplicated link record within one cell
      await updateRecordByApi(
        table1.id,
        table1.records[2].id,
        table1.fields[2].id,
        [
          { title: 'B2', id: table2.records[1].id },
          { title: 'B2', id: table2.records[1].id },
        ],
        400
      );

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      expect(table1RecordResult2.records[2].fields[table1.fields[2].name]).toBeUndefined();
    });

    it('should set a text value in a link record with typecast', async () => {
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'A1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');
      // // reject data when typecast is false
      await createRecords(
        table2.id,
        {
          typecast: false,
          records: [
            {
              fields: {
                [table2.fields[2].id]: ['A1'],
              },
            },
          ],
        },
        400
      );

      const { records } = await createRecords(table2.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table2.fields[2].id]: 'A1',
            },
          },
        ],
      });

      expect(records[0].fields[table2.fields[2].id]).toEqual([
        {
          id: table1.records[0].id,
          title: 'A1',
        },
      ]);

      const { records: records2 } = await createRecords(table1.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table1.fields[2].id]: 'B2',
            },
          },
        ],
      });

      expect(records2[0].fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'B2',
        },
      ]);
    });
  });

  describe.each([{ type: 'isTwoWay' }, { type: 'isOneWay' }])(
    'one one $type link field cell update',
    ({ type }) => {
      let table1: ITableFullVo;
      let table2: ITableFullVo;
      beforeEach(async () => {
        // create tables
        const textFieldRo: IFieldRo = {
          name: 'text field',
          type: FieldType.SingleLineText,
        };

        const numberFieldRo: IFieldRo = {
          name: 'Number field',
          type: FieldType.Number,
          options: {
            formatting: { type: NumberFormattingType.Decimal, precision: 1 },
          },
        };

        table1 = await createTable(baseId, {
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table1_1' } },
            { fields: { 'text field': 'table1_2' } },
            { fields: { 'text field': 'table1_3' } },
          ],
        });

        table2 = await createTable(baseId, {
          name: 'table2',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        });

        // create link field
        const table2LinkFieldRo: IFieldRo = {
          name: 'link field',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneOne,
            foreignTableId: table1.id,
            isOneWay: type === 'isOneWay',
          },
        };

        await createField(table2.id, table2LinkFieldRo);

        table1.fields = await getFields(table1.id);
        table2.fields = await getFields(table2.id);
      });

      afterEach(async () => {
        await permanentDeleteTable(baseId, table1.id);
        await permanentDeleteTable(baseId, table2.id);
      });

      it('should update foreign link field when set a new link in to link field cell', async () => {
        // table2 link field first record link to table1 first record
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
          id: table1.records[0].id,
        });

        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
          title: 'table1_2',
          id: table1.records[1].id,
        });

        const table1RecordResult2 = await getRecords(table1.id);

        if (type === 'isOneWay') {
          expect(table1.fields[2]).toBeUndefined();
        }

        if (type === 'isTwoWay') {
          expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toBeUndefined();
          expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toEqual({
            title: 'table2_1',
            id: table2.records[0].id,
          });
        }
      });

      it('should update foreign link field when change lookupField value', async () => {
        // table2 link field first record link to table1 first record
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
          id: table1.records[0].id,
        });
        await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'AX');

        const table2RecordResult2 = await getRecords(table2.id);

        expect(table2RecordResult2.records[0].fields[table2.fields[2].name!]).toEqual({
          title: 'AX',
          id: table1.records[0].id,
        });
      });

      it('should update self foreign link with correct title', async () => {
        // table2 link field first record link to table1 first record
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
          id: table1.records[0].id,
        });
        // set text for lookup field
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

        const table1RecordResult2 = await getRecords(table1.id);

        if (type === 'isOneWay') {
          expect(table1.fields[2]).toBeUndefined();
        }

        if (type === 'isTwoWay') {
          expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual({
            title: 'B1',
            id: table2.records[0].id,
          });
        }
      });

      it('should throw error when add a duplicate record in one one link field', async () => {
        // set text for lookup field
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');

        if (type === 'isOneWay') {
          // first update
          await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
            title: 'A1',
            id: table1.records[0].id,
          });

          // update a foreign table duplicated link record in other record
          await updateRecordByApi(
            table2.id,
            table2.records[1].id,
            table2.fields[2].id,
            { id: table1.records[0].id },
            400
          );
        }

        if (type === 'isTwoWay') {
          // first update
          await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, {
            title: 'B1',
            id: table2.records[0].id,
          });

          // update a duplicated link record in other record
          await updateRecordByApi(
            table1.id,
            table1.records[1].id,
            table1.fields[2].id,
            { id: table2.records[0].id },
            400
          );

          // update a foreign table duplicated link record in other record
          await updateRecordByApi(
            table2.id,
            table2.records[1].id,
            table2.fields[2].id,
            { id: table1.records[0].id },
            400
          );
        }
      });

      it('should throw error when add a duplicate record in one one link field in create record', async () => {
        if (type === 'isTwoWay') {
          await createRecords(
            table1.id,
            {
              records: [
                { fields: { [table1.fields[2].id]: { id: table2.records[0].id } } },
                { fields: { [table1.fields[2].id]: { id: table2.records[0].id } } },
              ],
            },
            400
          );
        }

        await createRecords(
          table2.id,
          {
            records: [
              { fields: { [table2.fields[2].id]: { id: table1.records[0].id } } },
              { fields: { [table2.fields[2].id]: { id: table1.records[0].id } } },
            ],
          },
          400
        );
      });
    }
  );

  describe('many many link field cell update with a multiple-value lookupField', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      const multipleSelectFieldRo: IFieldRo = {
        name: 'multiple select field',
        type: FieldType.MultipleSelect,
        options: {
          choices: [
            { name: 'A', color: Colors.Blue },
            { name: 'B', color: Colors.Red },
            { name: 'C', color: Colors.Green },
          ],
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: table1.id,
        },
      };

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo, multipleSelectFieldRo, table2LinkFieldRo],
        records: [
          { fields: { 'text field': 'table2_1', 'multiple select field': ['A'] } },
          { fields: { 'text field': 'table2_2', 'multiple select field': ['B', 'C'] } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      await convertField(table2.id, table2.fields[0].id, {
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      });

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      expect(table2.fields[0].isMultipleCellValue).toEqual(true);
      const table1LinkField = table1.fields.find((field) => field.type === FieldType.Link)!;
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table1.id, table1.records[0].id, table1LinkField.id, [
        {
          id: table2.records[0].id,
        },
      ]);

      await updateRecordByApi(table1.id, table1.records[1].id, table1LinkField.id, [
        {
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table1.id, table1.records[2].id, table1LinkField.id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      const table1RecordResult = await getRecords(table1.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toEqual([
        {
          title: 'A',
          id: table2.records[0].id,
        },
      ]);
      expect(table1RecordResult.records[1].fields[table1.fields[2].name]).toEqual([
        {
          title: 'B, C',
          id: table2.records[1].id,
        },
      ]);
      expect(table1RecordResult.records[2].fields[table1.fields[2].name]).toEqual([
        {
          title: 'A',
          id: table2.records[0].id,
        },
        {
          title: 'B, C',
          id: table2.records[1].id,
        },
      ]);
    });
  });

  describe('isOneWay many one and one many link field cell update', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table1_1' } },
          { fields: { 'text field': 'table1_2' } },
          { fields: { 'text field': 'table1_3' } },
        ],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { 'text field': 'table2_1' } },
          { fields: { 'text field': 'table2_2' } },
          { fields: { 'text field': 'table2_3' } },
        ],
      });

      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table1.id,
          isOneWay: true,
        },
      };

      await createField(table1.id, table1LinkFieldRo);
      await createField(table2.id, table2LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update foreign link field when set a new link in to link field cell', async () => {
      // table2 link field first record link to table1 first record
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        id: table1.records[0].id,
      });

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'table1_2',
        id: table1.records[1].id,
      });

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toBeUndefined();
      expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toBeUndefined();
    });

    it('should update foreign link field when change lookupField value', async () => {
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'table1_1',
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[2].id, {
        title: 'table1_1',
        id: table1.records[0].id,
      });

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toBeUndefined();

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'AX');

      const table2RecordResult2 = await getRecords(table2.id);

      expect(table2RecordResult2.records[0].fields[table2.fields[2].name!]).toEqual({
        title: 'AX',
        id: table1.records[0].id,
      });
    });

    it('should update formula field when change manyOne link cell', async () => {
      const table2FormulaFieldRo: IFieldRo = {
        name: 'table2Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${table2.fields[2].id}}`,
        },
      };

      await createField(table2.id, table2FormulaFieldRo);
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[2].id, {
        title: 'illegal title',
        id: table1.records[1].id,
      });

      const table2RecordResult = await getRecords(table2.id);

      expect(table2RecordResult.records[0].fields[table2FormulaFieldRo.name!]).toEqual('table1_2');
    });

    it('should update formula field when change oneMany link cell', async () => {
      const table1FormulaFieldRo: IFieldRo = {
        name: 'table1 formula field',
        type: FieldType.Formula,
        options: {
          expression: `{${table1.fields[2].id}}`,
        },
      };

      await createField(table1.id, table1FormulaFieldRo);

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[2].name]: [
              { title: 'illegal test1', id: table2.records[0].id },
              { title: 'illegal test2', id: table2.records[1].id },
            ],
          },
        },
      });
      const table1RecordResult = await getRecords(table1.id);

      expect(table1RecordResult.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'table2_1', id: table2.records[0].id },
        { title: 'table2_2', id: table2.records[1].id },
      ]);
      expect(table1RecordResult.records[0].fields[table1FormulaFieldRo.name!]).toEqual([
        'table2_1',
        'table2_2',
      ]);
    });

    it('should throw error when add a duplicate record in oneMany link field', async () => {
      // set text for lookup field
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      // first update
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      // update a duplicated link record in other record
      await updateRecordByApi(
        table1.id,
        table1.records[1].id,
        table1.fields[2].id,
        [{ title: 'B1', id: table2.records[0].id }],
        400
      );

      const table1RecordResult2 = await getRecords(table1.id);

      expect(table1RecordResult2.records[0].fields[table1.fields[2].name]).toEqual([
        { title: 'B1', id: table2.records[0].id },
        { title: 'B2', id: table2.records[1].id },
      ]);

      expect(table1RecordResult2.records[1].fields[table1.fields[2].name]).toBeUndefined();
    });

    it('should throw error when add a duplicate record in oneMany link field in create record', async () => {
      await createRecords(
        table1.id,
        {
          records: [
            {
              fields: {
                [table1.fields[2].id]: [{ id: table2.records[0].id }, { id: table2.records[0].id }],
              },
            },
          ],
        },
        400
      );

      await createRecords(
        table1.id,
        {
          records: [
            { fields: { [table1.fields[2].id]: [{ id: table2.records[0].id }] } },
            { fields: { [table1.fields[2].id]: [{ id: table2.records[0].id }] } },
          ],
        },
        400
      );
    });

    it('should set a text value in a link record with typecast', async () => {
      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'A1');
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');
      await updateRecordByApi(table2.id, table2.records[2].id, table2.fields[0].id, 'B3');
      // reject data when typecast is false
      await createRecords(
        table2.id,
        {
          typecast: false,
          records: [
            {
              fields: {
                [table2.fields[2].id]: ['A1'],
              },
            },
          ],
        },
        400
      );

      const { records: records1 } = await createRecords(table2.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table2.fields[2].id]: 'A1',
            },
          },
        ],
      });

      expect(records1[0].fields[table2.fields[2].id]).toEqual({
        id: table1.records[0].id,
        title: 'A1',
      });

      const { records: records2 } = await createRecords(table1.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table1.fields[2].id]: 'B1',
            },
          },
        ],
      });

      expect(records2[0].fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'B1',
        },
      ]);

      // typecast title[]
      const { records: records3 } = await createRecords(table1.id, {
        typecast: true,
        records: [
          {
            fields: {
              [table1.fields[2].id]: 'B2,B3',
            },
          },
        ],
      });

      expect(records3[0].fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[1].id,
          title: 'B2',
        },
        {
          id: table2.records[2].id,
          title: 'B3',
        },
      ]);

      // typecast id[]
      const record4 = await updateRecord(table1.id, records3[0].id, {
        typecast: true,
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table1.fields[2].id]: `${table2.records[2].id},${table2.records[1].id}`,
          },
        },
      });

      expect(record4.fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[2].id,
          title: 'B3',
        },
        {
          id: table2.records[1].id,
          title: 'B2',
        },
      ]);
    });

    it('should update link cellValue when change primary field value', async () => {
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1');
      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2');

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[2].id, [
        {
          id: table2.records[0].id,
        },
        {
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'B1+');

      const record1 = await getRecord(table1.id, table1.records[0].id);

      expect(record1.fields[table1.fields[2].id]).toEqual([
        {
          title: 'B1+',
          id: table2.records[0].id,
        },
        {
          title: 'B2',
          id: table2.records[1].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[1].id, table2.fields[0].id, 'B2+');
      const record2 = await getRecord(table1.id, table1.records[0].id);
      expect(record2.fields[table1.fields[2].id]).toEqual([
        {
          title: 'B1+',
          id: table2.records[0].id,
        },
        {
          title: 'B2+',
          id: table2.records[1].id,
        },
      ]);
    });
  });

  describe('multi link with depends same field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update many-one record when add both many-one and many-one link', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(table1.id, manyOneFieldRo);
      await createField(table1.id, oneManyFieldRo);

      await updateRecordByApi(table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'y');

      const { records: table1Records } = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      expect(table1Records[0].fields[manyOneField.id]).toEqual({
        title: 'y',
        id: table2.records[0].id,
      });
    });

    it('should update one-many record when add both many-one and many-one link', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const oneManyField = await createField(table1.id, oneManyFieldRo);
      const manyOneField = await createField(table1.id, manyOneFieldRo);

      const lookupOneManyField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: oneManyField.id,
        },
      });

      const rollupOneManyField = await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: oneManyField.id,
        },
      });

      const lookupManyOneField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: manyOneField.id,
        },
      });

      const rollupManyOneField = await createField(table1.id, {
        type: FieldType.Rollup,
        options: {
          expression: 'countall({values})',
        },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id,
          linkFieldId: manyOneField.id,
        },
      });

      await updateRecordByApi(table1.id, table1.records[0].id, oneManyField.id, [
        {
          id: table2.records[0].id,
        },
      ]);
      const { records: table1Records1 } = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      expect(table1Records1[0].fields[oneManyField.id]).toEqual([
        {
          title: 'x',
          id: table2.records[0].id,
        },
      ]);

      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'y');

      const { records: table1Records2 } = await getRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
      });
      expect(table1Records2[0].fields[oneManyField.id]).toEqual([
        {
          title: 'y',
          id: table2.records[0].id,
        },
      ]);
      expect(table1Records2[0].fields[lookupOneManyField.id]).toEqual(['y']);
      expect(table1Records2[0].fields[rollupOneManyField.id]).toEqual(1);
      expect(table1Records2[0].fields[lookupManyOneField.id]).toEqual(undefined);
      expect(table1Records2[0].fields[rollupManyOneField.id]).toEqual(0);
    });
  });

  describe('update link when delete record', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, {
        name: 'table1',
      });
      table2 = await createTable(baseId, {
        name: 'table2',
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should clean single link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(table1.id, manyOneFieldRo);
      const symManyOneField = await getField(
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      await updateRecordByApi(table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      await deleteRecord(table1.id, table1.records[0].id);

      const table2Record = await getRecord(table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toBeUndefined();
    });

    it('should update single link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'x1');
      await updateRecordByApi(table1.id, table1.records[1].id, table1.fields[0].id, 'x2');

      // get get a oneManyField involved
      const manyOneField = await createField(table1.id, manyOneFieldRo);
      const symManyOneField = await getField(
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      await updateRecordByApi(table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      const table2RecordPre = await getRecord(table2.id, table2.records[0].id);
      expect(table2RecordPre.fields[symManyOneField.id]).toEqual([
        {
          title: 'x1',
          id: table1.records[0].id,
        },
        {
          title: 'x2',
          id: table1.records[1].id,
        },
      ]);

      await deleteRecord(table1.id, table1.records[0].id);

      const table2Record = await getRecord(table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toEqual([
        {
          title: 'x2',
          id: table1.records[1].id,
        },
      ]);
    });

    it('should update single link record when delete multiple records', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      await updateRecordByApi(table1.id, table1.records[0].id, table1.fields[0].id, 'x1');
      await updateRecordByApi(table1.id, table1.records[1].id, table1.fields[0].id, 'x2');
      await updateRecordByApi(table1.id, table1.records[2].id, table1.fields[0].id, 'x3');

      // get get a oneManyField involved
      const manyOneField = await createField(table1.id, manyOneFieldRo);
      const symManyOneField = await getField(
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      await updateRecordByApi(table1.id, table1.records[0].id, manyOneField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, manyOneField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[2].id, manyOneField.id, {
        id: table2.records[0].id,
      });

      const table2RecordPre = await getRecord(table2.id, table2.records[0].id);
      expect(table2RecordPre.fields[symManyOneField.id]).toEqual([
        {
          title: 'x1',
          id: table1.records[0].id,
        },
        {
          title: 'x2',
          id: table1.records[1].id,
        },
        {
          title: 'x3',
          id: table1.records[2].id,
        },
      ]);

      await deleteRecords(table1.id, [table1.records[0].id, table1.records[1].id]);

      const table2Record = await getRecord(table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toEqual([
        {
          title: 'x3',
          id: table1.records[2].id,
        },
      ]);
    });

    it('should clean multi link record when delete a record', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const oneManyFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      // set primary key 'x' in table2
      await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
      // get get a oneManyField involved
      const manyOneField = await createField(table1.id, manyOneFieldRo);
      const oneManyField = await createField(table1.id, oneManyFieldRo);

      const symManyOneField = await getField(
        table2.id,
        (manyOneField.options as ILinkFieldOptions).symmetricFieldId as string
      );
      const symOneManyField = await getField(
        table2.id,
        (oneManyField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      await updateRecordByApi(table2.id, table2.records[0].id, symOneManyField.id, {
        id: table1.records[0].id,
      });
      await updateRecordByApi(table2.id, table2.records[0].id, symManyOneField.id, [
        {
          id: table1.records[0].id,
        },
      ]);

      await deleteRecord(table1.id, table1.records[0].id);

      const table2Record = await getRecord(table2.id, table2.records[0].id);
      expect(table2Record.fields[symManyOneField.id]).toBeUndefined();
      expect(table2Record.fields[symOneManyField.id]).toBeUndefined();
    });

    it.each([
      { relationship: Relationship.OneOne },
      { relationship: Relationship.ManyMany },
      { relationship: Relationship.ManyOne },
      { relationship: Relationship.OneMany },
    ])(
      'should clean one-way $relationship link record when delete a record',
      async ({ relationship }) => {
        const linkFieldRo: IFieldRo = {
          type: FieldType.Link,
          options: {
            relationship,
            foreignTableId: table2.id,
            isOneWay: true,
          },
        };

        // set primary key 'x' in table2
        await updateRecordByApi(table2.id, table2.records[0].id, table2.fields[0].id, 'x');
        // get get a oneManyField involved
        const linkField = await createField(table1.id, linkFieldRo);

        if (relationship === Relationship.OneOne || relationship === Relationship.ManyOne) {
          await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
            id: table2.records[0].id,
          });
          await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
            id: table2.records[1].id,
          });
        } else {
          await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, [
            {
              id: table2.records[0].id,
            },
          ]);
          await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, [
            {
              id: table2.records[1].id,
            },
          ]);
        }

        await deleteRecord(table2.id, table2.records[0].id);

        const table1Record = await getRecord(table1.id, table1.records[0].id);
        expect(table1Record.fields[linkField.id]).toBeUndefined();

        // check if the record is successfully deleted
        await deleteRecord(table1.id, table1.records[1].id);
      }
    );

    it('should clean one-many link record when delete a record', async () => {
      const table1TitleField = table1.fields[0];
      const table2TitleField = table2.fields[0];

      const table1RecordId1 = table1.records[0].id;
      const table1RecordId2 = table1.records[1].id;
      const table2RecordId1 = table2.records[0].id;
      const table2RecordId2 = table2.records[1].id;

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { id: table1RecordId1, fields: { [table1TitleField.id]: 'table1:A1' } },
          { id: table1RecordId2, fields: { [table1TitleField.id]: 'table1:A2' } },
        ],
      });
      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          { id: table2RecordId1, fields: { [table2TitleField.id]: 'table2:A1' } },
          { id: table2RecordId2, fields: { [table2TitleField.id]: 'table2:A2' } },
        ],
      });
      const linkFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };
      const table1LinkField = await createField(table1.id, linkFieldRo);
      const symmetricLinkFieldId = (table1LinkField.options as ILinkFieldOptions).symmetricFieldId!;

      await updateRecordByApi(table1.id, table1RecordId1, table1LinkField.id, [
        {
          id: table2RecordId1,
        },
        {
          id: table2RecordId2,
        },
      ]);

      const table1Record1Res = await getRecord(table1.id, table1RecordId1);
      expect(table1Record1Res.fields[table1LinkField.id]).toEqual([
        { id: table2RecordId1, title: 'table2:A1' },
        { id: table2RecordId2, title: 'table2:A2' },
      ]);

      await convertField(table2.id, table2TitleField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${symmetricLinkFieldId}}`,
        },
      });

      const table2Record1Res1 = await getRecord(table2.id, table2RecordId1);
      expect(table2Record1Res1.fields[symmetricLinkFieldId]).toEqual({
        id: table1RecordId1,
        title: 'table1:A1',
      });
      expect(table2Record1Res1.fields[table2TitleField.id]).toEqual('table1:A1');

      await deleteRecord(table1.id, table1RecordId1);
      const table2Record1Res2 = await getRecord(table2.id, table2RecordId1);
      expect(table2Record1Res2.fields[symmetricLinkFieldId]).toBeUndefined();
    });
  });

  describe('formula primary referencing link-derived fields', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      const textFieldRo: IFieldRo = {
        name: 'Title',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Amount',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      };

      // Table2: Title + Amount
      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [
          { fields: { Title: '21', Amount: 444 } },
          { fields: { Title: '22', Amount: 555 } },
          { fields: { Title: '23', Amount: 666 } },
        ],
      });

      // Table1: Title
      table1 = await createTable(baseId, {
        name: 'table1',
        fields: [textFieldRo],
        records: [{ fields: { Title: 'A1' } }],
      });

      // Link: table1 (OneMany) -> table2
      const linkField = await createField(table1.id, {
        name: 't1->t2',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      // Lookup: table1.lookup Amount via link (array of numbers)
      const lookupAmount = await createField(table1.id, {
        name: 'Amounts (lookup)',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[1].id, // Amount
          linkFieldId: linkField.id,
        },
      });
      // eslint-disable-next-line no-console

      // Formula: conditional rollup to produce number[]; its formatting should be applied when used as Link title
      const formula = await createField(table1.id, {
        name: 'Amounts Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${lookupAmount.id}}`,
        },
      });
      // eslint-disable-next-line no-console

      // Attach two t2 records to t1 record
      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: table2.records[0].id }, { id: table2.records[1].id }],
          },
        },
      });

      // Point symmetric link (on table2) title to table1 formula
      const t2Fields = await getFields(table2.id);
      const t2Link = t2Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!;
      await convertField(table2.id, t2Link.id, {
        type: FieldType.Link,
        options: {
          relationship: (t2Link.options as ILinkFieldOptions).relationship!,
          foreignTableId: table1.id,
          lookupFieldId: formula.id,
        },
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('reads table1 with formula referencing lookup (number array)', async () => {
      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Name });
      const rec = records[0];
      expect(rec.fields['Amounts (lookup)']).toEqual([444, 555]);
      expect(rec.fields['Amounts Formula']).toEqual([444, 555]);
    });

    it('reads table2 link with title formatted as decimals from formula', async () => {
      const t2Fields = await getFields(table2.id);
      const t2LinkName = t2Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!.name;
      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Name });
      const rec1 = records.find((r) => r.fields['Title'] === '21')!;
      const rec2 = records.find((r) => r.fields['Title'] === '22')!;
      // Both should link back to table1 A1 with title using formatted decimals
      expect(rec1.fields[t2LinkName]).toEqual([
        { id: table1.records[0].id, title: '444.00, 555.00' },
      ]);
      expect(rec2.fields[t2LinkName]).toEqual([
        { id: table1.records[0].id, title: '444.00, 555.00' },
      ]);
    });

    it('formula referencing rollup is formatted and usable as link title', async () => {
      // Create rollup on table1: sum of Amount via link
      const t1Fields = await getFields(table1.id);
      const linkField = t1Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!;
      const rollup = await createField(table1.id, {
        name: 'Sum Amounts',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[1].id, // Amount
          linkFieldId: linkField.id,
        },
      });

      // Formula references rollup
      const formulaRollup = await createField(table1.id, {
        name: 'Sum Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${rollup.id}}`,
          formatting: { type: NumberFormattingType.Decimal, precision: 2 },
        },
      });

      // Point table2 symmetric link title to this formula
      const t2Fields = await getFields(table2.id);
      const t2Link = t2Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!;
      await convertField(table2.id, t2Link.id, {
        type: FieldType.Link,
        options: {
          relationship: (t2Link.options as ILinkFieldOptions).relationship!,
          foreignTableId: table1.id,
          lookupFieldId: formulaRollup.id,
        },
      });

      const t2LinkName = (await getFields(table2.id)).find(
        (f) => f.type === FieldType.Link && !f.isLookup
      )!.name;
      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Name });
      // For 21 and 22 both linked to table1.A1, sum is 444+555=999 => '999.00'
      const rec1 = records.find((r) => r.fields['Title'] === '21')!;
      const rec2 = records.find((r) => r.fields['Title'] === '22')!;
      expect(rec1.fields[t2LinkName]).toEqual([{ id: table1.records[0].id, title: '999.00' }]);
      expect(rec2.fields[t2LinkName]).toEqual([{ id: table1.records[0].id, title: '999.00' }]);
    });

    it('formula referencing text lookup renders comma-joined titles', async () => {
      // Create text lookup on table1: Title via link
      const t1Fields = await getFields(table1.id);
      const linkField = t1Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!;
      const lookupTitle = await createField(table1.id, {
        name: 'Titles (lookup)',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields[0].id, // Title
          linkFieldId: linkField.id,
        },
      });

      const formulaText = await createField(table1.id, {
        name: 'Titles Formula',
        type: FieldType.Formula,
        options: { expression: `{${lookupTitle.id}}` },
      });

      // Point table2 symmetric link title to this formula
      const t2Fields = await getFields(table2.id);
      const t2Link = t2Fields.find((f) => f.type === FieldType.Link && !f.isLookup)!;
      await convertField(table2.id, t2Link.id, {
        type: FieldType.Link,
        options: {
          relationship: (t2Link.options as ILinkFieldOptions).relationship!,
          foreignTableId: table1.id,
          lookupFieldId: formulaText.id,
        },
      });

      const t2LinkName = (await getFields(table2.id)).find(
        (f) => f.type === FieldType.Link && !f.isLookup
      )!.name;
      const { records } = await getRecords(table2.id, { fieldKeyType: FieldKeyType.Name });
      const rec1 = records.find((r) => r.fields['Title'] === '21')!;
      const rec2 = records.find((r) => r.fields['Title'] === '22')!;
      expect(rec1.fields[t2LinkName]).toEqual([{ id: table1.records[0].id, title: '21, 22' }]);
      expect(rec2.fields[t2LinkName]).toEqual([{ id: table1.records[0].id, title: '21, 22' }]);
    });
  });

  describe('Create two bi-link for two tables', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      table1 = await createTable(baseId, {
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

    it('should update record in two same manyOne link', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      await createField(table1.id, table1LinkFieldRo);
      await createField(table1.id, table1LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);

      const record = await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table1.fields[1].id]: {
              id: table2.records[0].id,
            },
            [table1.fields[2].id]: {
              id: table2.records[0].id,
            },
          },
        },
      });
      expect(record.fields[table1.fields[1].id]).toEqual({
        id: table2.records[0].id,
        title: 'table2_1',
      });
      expect(record.fields[table1.fields[2].id]).toEqual({
        id: table2.records[0].id,
        title: 'table2_1',
      });
    });

    it('should update record in two same oneMany link', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      };

      await createField(table1.id, table1LinkFieldRo);
      await createField(table1.id, table1LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);

      const record = await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table1.fields[1].id]: [
              {
                id: table2.records[0].id,
              },
            ],
            [table1.fields[2].id]: [
              {
                id: table2.records[0].id,
              },
            ],
          },
        },
      });
      expect(record.fields[table1.fields[1].id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
      expect(record.fields[table1.fields[2].id]).toEqual([
        {
          id: table2.records[0].id,
          title: 'table2_1',
        },
      ]);
    });

    it('should delete a record when have a lookup field with link field', async () => {
      // create link field
      const table1LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const table1LinkField = (await createField(table1.id, table1LinkFieldRo)) as LinkFieldCore;

      const lookupFieldRo: IFieldRo = {
        type: FieldType.Link,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table1LinkField.options.symmetricFieldId as string,
          linkFieldId: table1LinkField.id,
        },
      };

      await createField(table1.id, lookupFieldRo);

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table1LinkField.id]: { id: table2.records[0].id },
          },
        },
      });

      await deleteRecord(table1.id, table1.records[0].id);
    });

    it.skipIf(globalThis.testConfig.driver === DriverClient.Sqlite)(
      'should delete a record with link field not null constraint',
      async () => {
        // create link field
        const table1LinkFieldRo: IFieldRo = {
          name: 'link field',
          type: FieldType.Link,
          options: {
            relationship: Relationship.ManyOne,
            foreignTableId: table2.id,
          },
        };

        const table1LinkField = (await createField(table1.id, table1LinkFieldRo)) as LinkFieldCore;

        const lookupFieldRo: IFieldRo = {
          type: FieldType.Link,
          isLookup: true,
          lookupOptions: {
            foreignTableId: table2.id,
            lookupFieldId: table1LinkField.options.symmetricFieldId as string,
            linkFieldId: table1LinkField.id,
          },
        };

        await createField(table1.id, lookupFieldRo);

        await updateRecord(table1.id, table1.records[0].id, {
          fieldKeyType: FieldKeyType.Id,
          record: {
            fields: {
              [table1LinkField.id]: { id: table2.records[0].id },
            },
          },
        });
        await deleteRecord(table1.id, table1.records[1].id);
        await deleteRecord(table1.id, table1.records[2].id);

        await convertField(table1.id, table1LinkField.id, {
          ...table1LinkFieldRo,
          notNull: true,
        });

        await deleteRecord(table1.id, table1.records[0].id);
      }
    );
  });

  describe('update multi cell when contains link field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, {
        name: 'table1',
      });
      table2 = await createTable(baseId, {
        name: 'table2',
      });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should update primary field cell with another cell', async () => {
      const manyOneFieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const textFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
      };

      await createField(table1.id, manyOneFieldRo);
      const textField = await createField(table1.id, textFieldRo);

      await updateRecord(table1.id, table1.records[0].id, {
        record: {
          fields: {
            [table1.fields[0].id]: 'primary',
            [textField.id]: 'text',
          },
        },
        fieldKeyType: FieldKeyType.Id,
      });
    });
  });

  describe('delete field', () => {
    describe.each([
      { relationship: Relationship.OneOne, isOneWay: true },
      { relationship: Relationship.OneOne, isOneWay: false },
      { relationship: Relationship.ManyMany, isOneWay: true },
      { relationship: Relationship.ManyMany, isOneWay: false },
      { relationship: Relationship.ManyOne, isOneWay: true },
      { relationship: Relationship.ManyOne, isOneWay: false },
      { relationship: Relationship.OneMany, isOneWay: true },
      { relationship: Relationship.OneMany, isOneWay: false },
    ])('delete $relationship link field with isOneWay: $isOneWay', ({ relationship, isOneWay }) => {
      let table1: ITableFullVo;
      let table2: ITableFullVo;
      beforeEach(async () => {
        // create tables
        const textFieldRo: IFieldRo = {
          name: 'text field',
          type: FieldType.SingleLineText,
        };

        const numberFieldRo: IFieldRo = {
          name: 'Number field',
          type: FieldType.Number,
          options: {
            formatting: { type: NumberFormattingType.Decimal, precision: 1 },
          },
        };

        table1 = await createTable(baseId, {
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table1_1' } },
            { fields: { 'text field': 'table1_2' } },
            { fields: { 'text field': 'table1_3' } },
          ],
        });

        table2 = await createTable(baseId, {
          name: 'table2',
          fields: [textFieldRo, numberFieldRo],
          records: [
            { fields: { 'text field': 'table2_1' } },
            { fields: { 'text field': 'table2_2' } },
            { fields: { 'text field': 'table2_3' } },
          ],
        });

        // create link field
        const table2LinkFieldRo: IFieldRo = {
          name: 'link field',
          type: FieldType.Link,
          options: {
            relationship: relationship,
            foreignTableId: table1.id,
            isOneWay: isOneWay,
          },
        };

        await createField(table2.id, table2LinkFieldRo);

        table1.fields = await getFields(table1.id);
        table2.fields = await getFields(table2.id);
      });

      afterEach(async () => {
        await permanentDeleteTable(baseId, table1.id);
        await permanentDeleteTable(baseId, table2.id);
      });

      it('should safe delete link field', async () => {
        await deleteField(table2.id, table2.fields[2].id);
        const table1Fields = await getFields(table1.id);
        expect(table1Fields.length).toEqual(2);
      });
    });
  });

  describe('change db table name', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const numberFieldRo: IFieldRo = {
        name: 'Number field',
        type: FieldType.Number,
        options: {
          formatting: { type: NumberFormattingType.Decimal, precision: 1 },
        },
      };

      table1 = await createTable(baseId, {
        fields: [textFieldRo, numberFieldRo],
        records: [],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo, numberFieldRo],
        records: [],
      });

      // create link field
      const table2LinkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      };

      await createField(table2.id, table2LinkFieldRo);

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should correct update db table name', async () => {
      const table1LinkField = table1.fields[2];
      const table2LinkField = table2.fields[2];
      expect((table1LinkField.options as ILinkFieldOptions).fkHostTableName).toEqual(
        table1.dbTableName
      );
      expect((table2LinkField.options as ILinkFieldOptions).fkHostTableName).toEqual(
        table1.dbTableName
      );

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          linkFieldId: table2LinkField.id,
        },
      };

      const lookupField = await createField(table2.id, lookupFieldRo);

      await updateDbTableName(baseId, table1.id, { dbTableName: 'newAwesomeName' });
      const newTable1 = await getTable(baseId, table1.id);
      const updatedLink1 = await getField(table1.id, table1LinkField.id);
      const updatedLink2 = await getField(table2.id, table2LinkField.id);
      const updatedLookupField = await getField(table2.id, lookupField.id);

      expect(newTable1.dbTableName.split(/[._]/)).toEqual(['bseTestBaseId', 'newAwesomeName']);
      expect((updatedLink1.options as ILinkFieldOptions).fkHostTableName.split(/[._]/)).toEqual([
        'bseTestBaseId',
        'newAwesomeName',
      ]);
      expect((updatedLink2.options as ILinkFieldOptions).fkHostTableName.split(/[._]/)).toEqual([
        'bseTestBaseId',
        'newAwesomeName',
      ]);
      expect(isLinkLookupOptions(updatedLookupField.lookupOptions)).toBe(true);
      expect(
        (updatedLookupField.lookupOptions as ILookupLinkOptionsVo).fkHostTableName.split(/[._]/)
      ).toEqual(['bseTestBaseId', 'newAwesomeName']);
    });
  });

  describe('cross base link db table name', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let baseId2: string;
    beforeEach(async () => {
      baseId2 = (await createBase({ spaceId, name: 'base2' })).data.id;
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId2, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId2, table2.id);
      await deleteBase(baseId2);
    });

    it('should create link cross base', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);
      expect((linkField.options as ILinkFieldOptions).baseId).toEqual(baseId2);

      const symLinkField = await getField(
        table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((symLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId);

      await convertField(table1.id, linkField.id, {
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      const updatedLinkField = await getField(table1.id, linkField.id);
      expect((updatedLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId2);

      const symUpdatedLinkField = await getField(
        table2.id,
        (updatedLinkField.options as ILinkFieldOptions).symmetricFieldId as string
      );
      expect((symUpdatedLinkField.options as ILinkFieldOptions).baseId).toEqual(baseId);
    });

    it('should correct update db table name when link field is cross base', async () => {
      const linkFieldRo: IFieldRo = {
        name: 'link field',
        type: FieldType.Link,
        options: {
          baseId: baseId2,
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      };

      const linkField = await createField(table1.id, linkFieldRo);

      const symLinkField = await getField(
        table2.id,
        (linkField.options as ILinkFieldOptions).symmetricFieldId as string
      );

      expect((linkField.options as ILinkFieldOptions).fkHostTableName).toEqual(table1.dbTableName);
      expect((symLinkField.options as ILinkFieldOptions).fkHostTableName).toEqual(
        table1.dbTableName
      );

      const lookupFieldRo: IFieldRo = {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table1.id,
          lookupFieldId: table1.fields[0].id,
          linkFieldId: symLinkField.id,
        },
      };

      const lookupField = await createField(table2.id, lookupFieldRo);

      await updateDbTableName(baseId, table1.id, { dbTableName: 'newAwesomeName' });
      const newTable1 = await getTable(baseId, table1.id);
      const updatedLink1 = await getField(table1.id, linkField.id);
      const updatedLink2 = await getField(table2.id, symLinkField.id);
      const updatedLookupField = await getField(table2.id, lookupField.id);

      expect(newTable1.dbTableName.split(/[._]/)).toEqual(['bseTestBaseId', 'newAwesomeName']);
      expect((updatedLink1.options as ILinkFieldOptions).fkHostTableName.split(/[._]/)).toEqual([
        'bseTestBaseId',
        'newAwesomeName',
      ]);
      expect((updatedLink2.options as ILinkFieldOptions).fkHostTableName.split(/[._]/)).toEqual([
        'bseTestBaseId',
        'newAwesomeName',
      ]);
      expect(isLinkLookupOptions(updatedLookupField.lookupOptions)).toBe(true);
      expect(
        (updatedLookupField.lookupOptions as ILookupLinkOptionsVo).fkHostTableName.split(/[._]/)
      ).toEqual(['bseTestBaseId', 'newAwesomeName']);
    });
  });

  describe('lookup a link field cross 2 table', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let table3: ITableFullVo;
    let table2LinkField: IFieldVo;
    let table3LinkField: IFieldVo;

    beforeEach(async () => {
      // create tables
      const textFieldRo: IFieldRo = {
        name: 'text field',
        type: FieldType.SingleLineText,
      };

      const formulaFieldRo: IFieldRo = {
        name: 'formula field',
        type: FieldType.Formula,
        options: {
          expression: '"x"',
        },
      };

      table1 = await createTable(baseId, {
        fields: [formulaFieldRo],
      });

      table2 = await createTable(baseId, {
        name: 'table2',
        fields: [textFieldRo],
        records: [
          { fields: { ['text field']: 't2 r1' } },
          { fields: { ['text field']: 't2 r2' } },
          { fields: { ['text field']: 't2 r3' } },
        ],
      });

      table3 = await createTable(baseId, {
        name: 'table3',
        fields: [textFieldRo],
        records: [
          { fields: { ['text field']: 't3 r1' } },
          { fields: { ['text field']: 't3 r2' } },
          { fields: { ['text field']: 't3 r3' } },
        ],
      });

      // create link field

      table2LinkField = await createField(table2.id, {
        name: '1 - 2 link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      });

      table3LinkField = await createField(table3.id, {
        name: '2 - 3 link',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      await createField(table3.id, {
        name: 'lookup',
        isLookup: true,
        type: FieldType.Link,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2LinkField.id,
          linkFieldId: table3LinkField.id,
        },
      });

      table1.fields = await getFields(table1.id);
      table2.fields = await getFields(table2.id);
      table3.fields = await getFields(table3.id);
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
      await permanentDeleteTable(baseId, table3.id);
    });

    it('should work with cross table lookup', async () => {
      await updateRecord(table3.id, table3.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table3LinkField.id]: [{ id: table2.records[0].id }, { id: table2.records[1].id }],
          },
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [table2LinkField.id]: [{ id: table1.records[0].id }, { id: table1.records[1].id }],
          },
        },
      });

      const newTable3LookupField = await convertField(table1.id, table1.fields[0].id, {
        name: 'formula field',
        type: FieldType.Formula,
        options: {
          expression: '"xx"',
        },
      });

      expect(newTable3LookupField.data).toBeDefined();
    });
  });

  describe('link field conversion plan', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let baseId2: string;
    beforeEach(async () => {
      baseId2 = (await createBase({ spaceId, name: 'base2' })).data.id;
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId2, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId2, table2.id);
      await deleteBase(baseId2);
    });

    it('should plan conversion from bidirectional to unidirectional', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      });

      const fieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      };
      await planFieldConvert(table1.id, linkField.id, fieldRo);
    });

    it('should plan conversion from  unidirectional to bidirectional', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: true,
        },
      });

      const fieldRo: IFieldRo = {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          isOneWay: false,
        },
      };
      await planFieldConvert(table1.id, linkField.id, fieldRo);
    });
  });

  describe('link field show by lookup field', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should work with link field show by field - create field', async () => {
      const textField = await createField(table2.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });
      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          lookupFieldId: textField.id,
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H1',
            [table2.fields[0].id]: 'A1',
          },
        },
      });

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: { id: table2.records[0].id },
          },
        },
      });

      const res = await getRecord(table1.id, table1.records[0].id);
      expect(res.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'H1' });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H2',
          },
        },
      });

      const res1 = await getRecord(table1.id, table1.records[0].id);
      expect(res1.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'H2' });
    });

    it('should work with link field show by field - delete record', async () => {
      const textField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });

      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          isOneWay: true,
          relationship: Relationship.OneOne,
          foreignTableId: table1.id,
          lookupFieldId: textField.id,
        },
      });
      const table1RecordId1 = table1.records[0].id;
      const table1RecordId2 = table1.records[1].id;
      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table1RecordId1,
            fields: {
              [textField.id]: 'table1:A1',
            },
          },
          {
            id: table1RecordId2,
            fields: {
              [textField.id]: 'table1:A2',
            },
          },
        ],
      });

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table1RecordId1,
            fields: {
              [linkField.id]: { id: table1RecordId2 },
            },
          },
          {
            id: table1RecordId2,
            fields: {
              [linkField.id]: { id: table1RecordId1 },
            },
          },
        ],
      });

      const res = await getRecord(table1.id, table1RecordId1);
      expect(res.fields[linkField.id]).toEqual({ id: table1RecordId2, title: 'table1:A2' });

      await deleteRecord(table1.id, table1RecordId1);
    });

    it('should work with link field show by field - convert field', async () => {
      const textField = await createField(table2.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });
      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H1',
            [table2.fields[0].id]: 'A1',
          },
        },
      });

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: { id: table2.records[0].id },
          },
        },
      });

      const res1 = await getRecord(table1.id, table1.records[0].id);
      expect(res1.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'A1' });

      const newLinkField = await convertField(table1.id, linkField.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          lookupFieldId: textField.id,
        },
      });
      expect((newLinkField.data?.options as ILinkFieldOptions)?.lookupFieldId).toEqual(
        textField.id
      );

      const res2 = await getRecord(table1.id, table1.records[0].id);
      expect(res2.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'H1' });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H2',
          },
        },
      });

      const res3 = await getRecord(table1.id, table1.records[0].id);
      expect(res3.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'H2' });
    });

    it('should work with link field show by field - delete lookuped field and undo', async () => {
      const textField = await createField(table2.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });
      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          lookupFieldId: textField.id,
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H1',
            [table2.fields[0].id]: 'A1',
          },
        },
      });

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: { id: table2.records[0].id },
          },
        },
      });

      const res = await getRecord(table1.id, table1.records[0].id);
      expect(res.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'H1' });

      // await deleteField(table2.id, textField.id);
      await awaitWithEvent(() => deleteField(table2.id, textField.id));

      const res1 = await getRecord(table1.id, table1.records[0].id);
      expect(res1.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'A1' });

      const undoRes = await undo(table2.id);
      expect(undoRes.data.status).toEqual('fulfilled');
    });

    it('should work with link field show by field - convert lookuped field', async () => {
      const textField = await createField(table2.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });
      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
          lookupFieldId: textField.id,
          isOneWay: true,
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: '11',
            [table2.fields[0].id]: 'A1',
          },
        },
      });

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: { id: table2.records[0].id },
          },
        },
      });

      const res = await getRecord(table1.id, table1.records[0].id);
      expect(res.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: '11' });

      await convertField(table2.id, textField.id, {
        type: FieldType.Number,
        options: {
          formatting: {
            type: NumberFormattingType.Decimal,
            precision: 2,
          },
        },
      });

      const res1 = await getRecord(table1.id, table1.records[0].id);
      expect(res1.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: '11.00' });

      await convertField(table2.id, textField.id, {
        type: FieldType.Checkbox,
      });

      const res2 = await getRecord(table1.id, table1.records[0].id);
      expect(res2.fields[linkField.id]).toEqual({ id: table2.records[0].id, title: 'A1' });
    });

    it('should work with link field show by field - change lookuped field when link field is one-many way', async () => {
      const textField = await createField(table2.id, {
        type: FieldType.SingleLineText,
        name: 'text field',
      });

      const linkField = await createField(table1.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          isOneWay: true,
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      await updateRecord(table2.id, table2.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [textField.id]: 'H1',
            [table2.fields[0].id]: 'A1',
          },
        },
      });

      await updateRecord(table1.id, table1.records[0].id, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: table2.records[0].id }],
          },
        },
      });

      const res = await getRecord(table1.id, table1.records[0].id);
      expect(res.fields[linkField.id]).toEqual([{ id: table2.records[0].id, title: 'A1' }]);

      await convertField(table1.id, linkField.id, {
        name: 'tabele1 link field',
        type: FieldType.Link,
        options: {
          isOneWay: true,
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
          lookupFieldId: textField.id,
        },
      });

      const res1 = await getRecord(table1.id, table1.records[0].id);
      expect(res1.fields[linkField.id]).toEqual([{ id: table2.records[0].id, title: 'H1' }]);
    });
  });

  describe('link field update', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    beforeEach(async () => {
      table1 = await createTable(baseId, { name: 'table1' });
      table2 = await createTable(baseId, { name: 'table2' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table1.id);
      await permanentDeleteTable(baseId, table2.id);
    });

    it('should clean more link cellValue with link field many-many to many-one', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          isOneWay: false,
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });

      const symmetricLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId!;
      const table2TitleField = table2.fields[0];
      const table2RecordId1 = table2.records[0].id;
      const table2RecordId2 = table2.records[1].id;
      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table2RecordId1,
            fields: {
              [table2TitleField.id]: 'table2:A1',
            },
          },
          {
            id: table2RecordId2,
            fields: {
              [table2TitleField.id]: 'table2:A2',
            },
          },
        ],
      });

      const table1TitleField = table1.fields[0];
      const table1RecordId1 = table1.records[0].id;
      const table1RecordId2 = table1.records[1].id;

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table1RecordId1,
            fields: {
              [table1TitleField.id]: 'table1:A1',
            },
          },
          {
            id: table1RecordId2,
            fields: {
              [table1TitleField.id]: 'table1:A2',
            },
          },
        ],
      });

      const table1Record1Res = await updateRecord(table1.id, table1RecordId1, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: table2RecordId1 }, { id: table2RecordId2 }],
          },
        },
      });

      expect(table1Record1Res.fields[linkField.id]).toEqual([
        { id: table2RecordId1, title: 'table2:A1' },
        { id: table2RecordId2, title: 'table2:A2' },
      ]);

      const table2Record2Res = await getRecord(table2.id, table2RecordId2);
      expect(table2Record2Res.fields[symmetricLinkFieldId]).toEqual([
        { id: table1RecordId1, title: 'table1:A1' },
      ]);

      await convertField(table1.id, linkField.id, {
        type: FieldType.Link,
        options: {
          isOneWay: false,
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      const table1Record1ResUpdated = await getRecord(table1.id, table1RecordId1);
      expect(table1Record1ResUpdated.fields[linkField.id]).toEqual({
        id: table2RecordId1,
        title: 'table2:A1',
      });

      const table2Record2ResUpdated = await getRecord(table2.id, table2RecordId2);

      expect(table2Record2ResUpdated.fields[symmetricLinkFieldId]).toBeUndefined();

      const table1RecordRes2 = await updateRecord(table1.id, table1RecordId2, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: { id: table2RecordId2 },
          },
        },
      });

      expect(table1RecordRes2.fields[linkField.id]).toEqual({
        id: table2RecordId2,
        title: 'table2:A2',
      });
    });

    it('should clean more link cellValue with link field many-many to one-one', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          isOneWay: false,
          relationship: Relationship.ManyMany,
          foreignTableId: table2.id,
        },
      });

      const symmetricLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId!;
      const table2TitleField = table2.fields[0];
      const table2RecordId1 = table2.records[0].id;
      const table2RecordId2 = table2.records[1].id;
      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table2RecordId1,
            fields: {
              [table2TitleField.id]: 'table2:A1',
            },
          },
          {
            id: table2RecordId2,
            fields: {
              [table2TitleField.id]: 'table2:A2',
            },
          },
        ],
      });

      const table1TitleField = table1.fields[0];
      const table1RecordId1 = table1.records[0].id;
      const table1RecordId2 = table1.records[1].id;

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table1RecordId1,
            fields: {
              [table1TitleField.id]: 'table1:A1',
            },
          },
          {
            id: table1RecordId2,
            fields: {
              [table1TitleField.id]: 'table1:A2',
            },
          },
        ],
      });

      const table1Record1Res = await updateRecord(table1.id, table1RecordId1, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: table2RecordId1 }, { id: table2RecordId2 }],
          },
        },
      });

      expect(table1Record1Res.fields[linkField.id]).toEqual([
        { id: table2RecordId1, title: 'table2:A1' },
        { id: table2RecordId2, title: 'table2:A2' },
      ]);

      const table2Record2Res = await getRecord(table2.id, table2RecordId2);
      expect(table2Record2Res.fields[symmetricLinkFieldId]).toEqual([
        { id: table1RecordId1, title: 'table1:A1' },
      ]);

      await convertField(table1.id, linkField.id, {
        type: FieldType.Link,
        options: {
          isOneWay: false,
          relationship: Relationship.OneOne,
          foreignTableId: table2.id,
        },
      });

      const table1Record1ResUpdated = await getRecord(table1.id, table1RecordId1);
      expect(table1Record1ResUpdated.fields[linkField.id]).toEqual({
        id: table2RecordId1,
        title: 'table2:A1',
      });

      const table2Record2ResUpdated = await getRecord(table2.id, table2RecordId2);
      expect(table2Record2ResUpdated.fields[symmetricLinkFieldId]).toBeUndefined();
    });

    it('should update link cellValue with link field Many-One to Many-Many when isOneWay is false', async () => {
      const linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          isOneWay: false,
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      });

      const table1TitleField = table1.fields[0];
      const table1RecordId1 = table1.records[0].id;
      const table1RecordId2 = table1.records[1].id;

      const symmetricLinkFieldId = (linkField.options as ILinkFieldOptions).symmetricFieldId!;
      const table2TitleField = table2.fields[0];
      const table2RecordId1 = table2.records[0].id;
      const table2RecordId2 = table2.records[1].id;

      await updateRecords(table1.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table1RecordId1,
            fields: {
              [table1TitleField.id]: 'table1:A1',
            },
          },
          {
            id: table1RecordId2,
            fields: {
              [table1TitleField.id]: 'table1:A2',
            },
          },
        ],
      });

      await updateRecords(table2.id, {
        fieldKeyType: FieldKeyType.Id,
        records: [
          {
            id: table2RecordId1,
            fields: {
              [table2TitleField.id]: 'table2:A1',
            },
          },
          {
            id: table2RecordId2,
            fields: {
              [table2TitleField.id]: 'table2:A2',
            },
          },
        ],
      });

      const table1Record1Res = await updateRecord(table1.id, table1RecordId1, {
        fieldKeyType: FieldKeyType.Id,
        record: {
          fields: {
            [linkField.id]: [{ id: table2RecordId1 }, { id: table2RecordId2 }],
          },
        },
      });

      expect(table1Record1Res.fields[linkField.id]).toEqual([
        { id: table2RecordId1, title: 'table2:A1' },
        { id: table2RecordId2, title: 'table2:A2' },
      ]);

      const table2Record2Res = await getRecord(table2.id, table2RecordId2);
      expect(table2Record2Res.fields[symmetricLinkFieldId]).toEqual({
        id: table1RecordId1,
        title: 'table1:A1',
      });

      const symmetricLinkField = await getField(table2.id, symmetricLinkFieldId);
      await convertField(table2.id, symmetricLinkField.id, {
        type: FieldType.Link,
        options: {
          ...symmetricLinkField.options,
          relationship: Relationship.ManyMany,
        },
      });

      const table1Record1ResUpdated = await getRecord(table1.id, table1RecordId1);
      expect(table1Record1ResUpdated.fields[linkField.id]).toEqual([
        { id: table2RecordId1, title: 'table2:A1' },
        { id: table2RecordId2, title: 'table2:A2' },
      ]);

      const table2Record2ResUpdated = await getRecord(table2.id, table2RecordId2);
      expect(table2Record2ResUpdated.fields[symmetricLinkFieldId]).toEqual([
        { id: table1RecordId1, title: 'table1:A1' },
      ]);
    });
  });

  describe('rollup -> formula -> rollup chain', () => {
    it('should aggregate correctly through formula referencing a rollup across links', async () => {
      // Table2: text + number with records
      const t2Text: IFieldRo = { name: 't2 text', type: FieldType.SingleLineText };
      const t2Number: IFieldRo = {
        name: 't2 number',
        type: FieldType.Number,
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
      };

      const table2 = await createTable(baseId, {
        name: 'table2_rfr',
        fields: [t2Text, t2Number],
        records: [
          { fields: { 't2 text': 'r1', 't2 number': 5 } },
          { fields: { 't2 text': 'r2', 't2 number': 7 } },
        ],
      });

      // Table3: text + link(to t2) + rollup(sum t2.number) + formula(rollup*2)
      const t3Text: IFieldRo = { name: 't3 text', type: FieldType.SingleLineText };
      const table3 = await createTable(baseId, {
        name: 'table3_rfr',
        fields: [t3Text],
        records: [{ fields: { 't3 text': 'a' } }],
      });

      const linkT3ToT2 = await createField(table3.id, {
        name: 't3->t2',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: table2.id },
      });

      const rollupT3 = await createField(table3.id, {
        name: 't3 rollup',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields.find((f) => f.name === 't2 number')!.id,
          linkFieldId: linkT3ToT2.id,
        },
      });

      const formulaT3 = await createField(table3.id, {
        name: 't3 formula x2',
        type: FieldType.Formula,
        options: { expression: `{${rollupT3.id}} * 2` },
      });

      // Link table3.r1 -> table2.r1 + table2.r2, so rollup=5+7=12, formula=24
      await updateRecordByApi(table3.id, table3.records[0].id, linkT3ToT2.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);

      // Table4: text + link(to t3) + rollup(sum t3 formula)
      const t4Text: IFieldRo = { name: 't4 text', type: FieldType.SingleLineText };
      const table4 = await createTable(baseId, {
        name: 'table4_rfr',
        fields: [t4Text],
        records: [{ fields: { 't4 text': 'x' } }],
      });

      const linkT4ToT3 = await createField(table4.id, {
        name: 't4->t3',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: table3.id },
      });

      const rollupT4 = await createField(table4.id, {
        name: 't4 rollup of t3 formula',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table3.id,
          lookupFieldId: formulaT3.id,
          linkFieldId: linkT4ToT3.id,
        },
      });

      // Link table4.r1 -> table3.r1, so t4 rollup should be 24
      await updateRecordByApi(table4.id, table4.records[0].id, linkT4ToT3.id, [
        { id: table3.records[0].id },
      ]);

      const t4Fields = await getFields(table4.id);
      const t4RollupField = t4Fields.find((f) => f.id === rollupT4.id)!;
      const t4Res = await getRecords(table4.id);
      expect(t4Res.records[0].fields[t4RollupField.name]).toEqual(24);
    });

    it('should sum formulas across multiple t3 records (OneMany)', async () => {
      // Table2
      const t2Text: IFieldRo = { name: 't2 text v2', type: FieldType.SingleLineText };
      const t2Number: IFieldRo = {
        name: 't2 number v2',
        type: FieldType.Number,
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
      };
      const table2 = await createTable(baseId, {
        name: 'table2_rfrm_v2',
        fields: [t2Text, t2Number],
        records: [
          { fields: { 't2 text v2': 'r1', 't2 number v2': 5 } },
          { fields: { 't2 text v2': 'r2', 't2 number v2': 7 } },
          { fields: { 't2 text v2': 'r3', 't2 number v2': 11 } },
        ],
      });

      // Table3
      const t3Text: IFieldRo = { name: 't3 text v2', type: FieldType.SingleLineText };
      const table3 = await createTable(baseId, {
        name: 'table3_rfrm_v2',
        fields: [t3Text],
        records: [{ fields: { 't3 text v2': 'a' } }, { fields: { 't3 text v2': 'b' } }],
      });

      const linkT3ToT2 = await createField(table3.id, {
        name: 't3->t2 v2',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: table2.id },
      });

      const rollupT3 = await createField(table3.id, {
        name: 't3 rollup v2',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields.find((f) => f.name === 't2 number v2')!.id,
          linkFieldId: linkT3ToT2.id,
        },
      });

      const formulaT3 = await createField(table3.id, {
        name: 't3 formula x2 v2',
        type: FieldType.Formula,
        options: { expression: `{${rollupT3.id}} * 2` },
      });

      // r1 -> t2(r1,r2) => 5+7=12 => 24; r2 -> t2(r3) => 11 => 22
      await updateRecordByApi(table3.id, table3.records[0].id, linkT3ToT2.id, [
        { id: table2.records[0].id },
        { id: table2.records[1].id },
      ]);
      await updateRecordByApi(table3.id, table3.records[1].id, linkT3ToT2.id, [
        { id: table2.records[2].id },
      ]);

      // Table4: rollup of t3 formula across two t3 records => 24 + 22 = 46
      const t4Text: IFieldRo = { name: 't4 text v2', type: FieldType.SingleLineText };
      const table4 = await createTable(baseId, {
        name: 'table4_rfrm_v2',
        fields: [t4Text],
        records: [{ fields: { 't4 text v2': 'x' } }],
      });

      const linkT4ToT3 = await createField(table4.id, {
        name: 't4->t3 v2',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: table3.id },
      });

      const rollupT4 = await createField(table4.id, {
        name: 't4 rollup of t3 formula v2',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table3.id,
          lookupFieldId: formulaT3.id,
          linkFieldId: linkT4ToT3.id,
        },
      });

      // Also create lookup of t3 formula to test lookup->formula->rollup chain resolution
      const lookupT4 = await createField(table4.id, {
        name: 't4 lookup t3 formula v2',
        type: FieldType.Formula,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table3.id,
          lookupFieldId: formulaT3.id,
          linkFieldId: linkT4ToT3.id,
        },
      });

      await updateRecordByApi(table4.id, table4.records[0].id, linkT4ToT3.id, [
        { id: table3.records[0].id },
        { id: table3.records[1].id },
      ]);

      const t4Fields = await getFields(table4.id);
      const t4RollupField = t4Fields.find((f) => f.id === rollupT4.id)!;
      const t4LookupField = t4Fields.find((f) => f.id === lookupT4.id)!;
      const t4Res = await getRecords(table4.id);
      expect(t4Res.records[0].fields[t4RollupField.name]).toEqual(46);
      expect(t4Res.records[0].fields[t4LookupField.name]).toEqual([24, 22]);
    });

    it('should work when t3->t2 is ManyOne (single-value rollup)', async () => {
      // Table2
      const t2Text: IFieldRo = { name: 't2 text v3', type: FieldType.SingleLineText };
      const t2Number: IFieldRo = {
        name: 't2 number v3',
        type: FieldType.Number,
        options: { formatting: { type: NumberFormattingType.Decimal, precision: 0 } },
      };
      const table2 = await createTable(baseId, {
        name: 'table2_rfrm_v3',
        fields: [t2Text, t2Number],
        records: [
          { fields: { 't2 text v3': 'r1', 't2 number v3': 3 } },
          { fields: { 't2 text v3': 'r2', 't2 number v3': 9 } },
        ],
      });

      // Table3 with ManyOne link to t2
      const t3Text: IFieldRo = { name: 't3 text v3', type: FieldType.SingleLineText };
      const table3 = await createTable(baseId, {
        name: 'table3_rfrm_v3',
        fields: [t3Text],
        records: [{ fields: { 't3 text v3': 'a' } }, { fields: { 't3 text v3': 'b' } }],
      });

      const linkT3ToT2 = await createField(table3.id, {
        name: 't3->t2 v3',
        type: FieldType.Link,
        options: { relationship: Relationship.ManyOne, foreignTableId: table2.id },
      });

      const rollupT3 = await createField(table3.id, {
        name: 't3 rollup v3',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: table2.fields.find((f) => f.name === 't2 number v3')!.id,
          linkFieldId: linkT3ToT2.id,
        },
      });

      const formulaT3 = await createField(table3.id, {
        name: 't3 formula x2 v3',
        type: FieldType.Formula,
        options: { expression: `{${rollupT3.id}} * 2` },
      });

      // Link: r1 -> t2.r1 (3) => rollup 3 => formula 6; r2 -> t2.r2 (9) => formula 18
      await updateRecordByApi(table3.id, table3.records[0].id, linkT3ToT2.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table3.id, table3.records[1].id, linkT3ToT2.id, {
        id: table2.records[1].id,
      });

      // Table4: OneMany to t3, rollup sum of t3 formula => 6 + 18 = 24
      const t4Text: IFieldRo = { name: 't4 text v3', type: FieldType.SingleLineText };
      const table4 = await createTable(baseId, {
        name: 'table4_rfrm_v3',
        fields: [t4Text],
        records: [{ fields: { 't4 text v3': 'x' } }],
      });

      const linkT4ToT3 = await createField(table4.id, {
        name: 't4->t3 v3',
        type: FieldType.Link,
        options: { relationship: Relationship.OneMany, foreignTableId: table3.id },
      });

      const rollupT4 = await createField(table4.id, {
        name: 't4 rollup of t3 formula v3',
        type: FieldType.Rollup,
        options: { expression: 'sum({values})' },
        lookupOptions: {
          foreignTableId: table3.id,
          lookupFieldId: formulaT3.id,
          linkFieldId: linkT4ToT3.id,
        },
      });

      await updateRecordByApi(table4.id, table4.records[0].id, linkT4ToT3.id, [
        { id: table3.records[0].id },
        { id: table3.records[1].id },
      ]);

      const t4Fields = await getFields(table4.id);
      const t4RollupField = t4Fields.find((f) => f.id === rollupT4.id)!;
      const t4Res = await getRecords(table4.id);
      expect(t4Res.records[0].fields[t4RollupField.name]).toEqual(24);
    });
  });
});
