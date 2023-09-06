/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  ILookupOptionsRo,
  IFieldVo,
  LinkFieldCore,
  IFieldRo,
  ITableFullVo,
  INumberFieldOptions,
} from '@teable-group/core';
import { Colors, FieldType, Relationship, TimeFormatting } from '@teable-group/core';
import type request from 'supertest';
import { updateRecordByApi, getRecord, initApp } from './utils/init-app';

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
        precision: 2,
      },
    },
  },
];

describe('OpenAPI Lookup field (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo = {} as any;
  let table2: ITableFullVo = {} as any;
  const tables: ITableFullVo[] = [];
  let request: request.SuperAgentTest;

  async function updateTableFields(table: ITableFullVo) {
    const tableFields = (await request.get(`/api/table/${table.id}/field`).expect(200)).body;
    table.fields = tableFields;
    return tableFields;
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
    request = appCtx.request;

    // create table1 with fundamental field
    const result1 = await request
      .post('/api/table')
      .send({
        name: 'table1',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table1]' })),
      })
      .expect(201);
    table1 = result1.body;

    // create table2 with fundamental field
    const result2 = await request
      .post('/api/table')
      .send({
        name: 'table2',
        fields: defaultFields.map((f) => ({ ...f, name: f.name + '[table2]' })),
      })
      .expect(201);
    table2 = result2.body;

    // create link field
    await request
      .post(`/api/table/${table1.id}/field`)
      .send({
        name: 'link[table1]',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table2.id,
        },
      } as IFieldRo)
      .expect(201);
    // update fields in table after create link field
    await updateTableFields(table1);
    await updateTableFields(table2);
    tables.push(table1, table2);
  });

  afterAll(async () => {
    try {
      await request.delete(`/api/table/arbitrary/${table1.id}`).expect(200);
      await request.delete(`/api/table/arbitrary/${table2.id}`).expect(200);
    } finally {
      await app.close();
    }
  });

  beforeEach(async () => {
    // remove all link
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[0].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
    );
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
    );
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[2].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
    );
    // add a link record to first row
    await updateRecordByApi(
      request,
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
    await request.post(`/api/table/${table.id}/field`).send(lookupFieldRo).expect(201);

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
      request,
      foreignTable.id,
      foreignTable.records[0].id,
      lookedUpToField.id,
      updateValue
    );

    const record = await getRecord(request, table.id, table.records[0].id);
    return expect(record.fields[lookupFieldVo.id]);
  }

  it('should update lookupField by remove a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordByApi(request, table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordByApi(request, table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const record = await getRecord(request, table1.id, table1.records[1].id);
    expect(record.fields[lookupFieldVo.id]).toEqual([123, 456]);

    // remove a link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const recordAfter1 = await getRecord(request, table1.id, table1.records[1].id);
    expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([123]);

    // remove all link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      null
    );

    const recordAfter2 = await getRecord(request, table1.id, table1.records[1].id);
    expect(recordAfter2.fields[lookupFieldVo.id]).toEqual(undefined);

    // add a link record from many - one field
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const recordAfter3 = await getRecord(request, table1.id, table1.records[1].id);
    expect(recordAfter3.fields[lookupFieldVo.id]).toEqual([123]);
  });

  it('should update many - one lookupField by remove a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table1.fields, FieldType.Number);
    const lookupFieldVo = await lookupFrom(table2, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordByApi(request, table1.id, table1.records[1].id, lookedUpToField.id, 123);

    // add a link record after
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const record1 = await getRecord(request, table2.id, table2.records[1].id);
    expect(record1.fields[lookupFieldVo.id]).toEqual(123);
    const record2 = await getRecord(request, table2.id, table2.records[2].id);
    expect(record2.fields[lookupFieldVo.id]).toEqual(123);

    // remove a link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record3 = await getRecord(request, table2.id, table2.records[1].id);
    expect(record3.fields[lookupFieldVo.id]).toEqual(123);
    const record4 = await getRecord(request, table2.id, table2.records[2].id);
    expect(record4.fields[lookupFieldVo.id]).toEqual(undefined);

    // remove all link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      null
    );

    const record5 = await getRecord(request, table2.id, table2.records[1].id);
    expect(record5.fields[lookupFieldVo.id]).toEqual(undefined);

    // add a link record from many - one field
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const record6 = await getRecord(request, table2.id, table2.records[1].id);
    expect(record6.fields[lookupFieldVo.id]).toEqual(123);
  });

  it('should update many - one lookupField by replace a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.SingleLineText).id,
      'A2'
    );
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[2].id,
      getFieldByType(table1.fields, FieldType.SingleLineText).id,
      'A3'
    );
    await updateRecordByApi(request, table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordByApi(request, table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const record = await getRecord(request, table1.id, table1.records[1].id);
    expect(record.fields[lookupFieldVo.id]).toEqual([123]);

    console.log('-------------------');
    // replace a link record
    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[2].id }
    );

    const record1 = await getRecord(request, table1.id, table1.records[1].id);
    expect(record1.fields[lookupFieldVo.id]).toEqual(undefined);
    const record2 = await getRecord(request, table1.id, table1.records[2].id);
    expect(record2.fields[lookupFieldVo.id]).toEqual([123]);
  });

  it('should update one - many lookupField by add a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordByApi(request, table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordByApi(request, table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record = await getRecord(request, table1.id, table1.records[1].id);
    expect(record.fields[lookupFieldVo.id]).toEqual([123]);

    console.log('-------------------');
    // add a link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const recordAfter1 = await getRecord(request, table1.id, table1.records[1].id);
    expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([123, 456]);
  });

  it('should update one -many lookupField by replace a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const lookupFieldVo = await lookupFrom(table1, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordByApi(request, table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordByApi(request, table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record = await getRecord(request, table1.id, table1.records[1].id);
    expect(record.fields[lookupFieldVo.id]).toEqual([123]);

    // replace a link record
    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[2].id }]
    );

    const recordAfter1 = await getRecord(request, table1.id, table1.records[1].id);
    expect(recordAfter1.fields[lookupFieldVo.id]).toEqual([456]);
  });

  it('should update lookupField by edit the a looked up text field', async () => {
    (await expectLookup(table1, FieldType.SingleLineText, 'lookup text')).toEqual(['lookup text']);
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
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    await updateRecordByApi(
      request,
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.SingleLineText).id,
      'text'
    );

    const record = await getRecord(request, table1.id, table1.records[1].id);

    expect(record.fields[getFieldByType(table1.fields, FieldType.Link).id]).toEqual([
      { id: table2.records[1].id, title: 'text' },
    ]);
  });

  it('should calculate when add a lookup field', async () => {
    const textField = getFieldByType(table1.fields, FieldType.SingleLineText);

    await updateRecordByApi(request, table1.id, table1.records[0].id, textField.id, 'A1');
    await updateRecordByApi(request, table1.id, table1.records[1].id, textField.id, 'A2');
    await updateRecordByApi(request, table1.id, table1.records[2].id, textField.id, 'A3');

    const lookedUpToField = getFieldByType(table1.fields, FieldType.SingleLineText);

    await updateRecordByApi(
      request,
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const lookupFieldVo = await lookupFrom(table2, lookedUpToField.id);
    const record1 = await getRecord(request, table2.id, table2.records[1].id);
    expect(record1.fields[lookupFieldVo.id]).toEqual('A2');
    const record2 = await getRecord(request, table2.id, table2.records[2].id);
    expect(record2.fields[lookupFieldVo.id]).toEqual('A2');
  });
});
