/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, IFieldVo, ILookupOptionsRo, IRecord, LinkFieldCore } from '@teable/core';
import {
  Colors,
  FieldKeyType,
  FieldType,
  NumberFormattingType,
  Relationship,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import {
  createField,
  createTable,
  deleteTable,
  getFields,
  initApp,
  updateRecord,
  getRecord,
} from './utils/init-app';

// All kind of field type (except link)
const defaultFields: IFieldRo[] = [
  {
    name: FieldType.SingleLineText,
    type: FieldType.SingleLineText,
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
    },
  },
  {
    name: FieldType.Attachment,
    type: FieldType.Attachment,
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

describe('OpenAPI Rollup field (e2e)', () => {
  let app: INestApplication;
  let table1: ITableFullVo = {} as any;
  let table2: ITableFullVo = {} as any;
  const tables: ITableFullVo[] = [];
  const baseId = globalThis.testConfig.baseId;

  async function updateTableFields(table: ITableFullVo) {
    const tableFields = await getFields(table.id);
    table.fields = tableFields;
    return tableFields;
  }

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;

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
    await deleteTable(baseId, table1.id);
    await deleteTable(baseId, table2.id);

    await app.close();
  });

  beforeEach(async () => {
    // remove all link
    await updateRecordField(
      table2.id,
      table2.records[0].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
    );
    await updateRecordField(
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
    );
    await updateRecordField(
      table2.id,
      table2.records[2].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      null
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

  async function updateRecordField(
    tableId: string,
    recordId: string,
    fieldId: string,
    newValues: any
  ): Promise<IRecord> {
    return updateRecord(tableId, recordId, {
      fieldKeyType: FieldKeyType.Id,
      record: {
        fields: {
          [fieldId]: newValues,
        },
      },
    });
  }

  async function rollupFrom(
    table: ITableFullVo,
    lookupFieldId: string,
    expression = 'countall({values})'
  ) {
    const linkField = getFieldByType(table.fields, FieldType.Link) as LinkFieldCore;
    const foreignTable = tables.find((t) => t.id === linkField.options.foreignTableId)!;
    const lookupField = foreignTable.fields.find((f) => f.id === lookupFieldId)!;
    const rollupFieldRo: IFieldRo = {
      name: `rollup ${lookupField.name} ${expression} [${table.name}]`,
      type: FieldType.Rollup,
      options: {
        expression,
        formatting:
          expression.startsWith('count') || expression.startsWith('sum')
            ? {
                type: NumberFormattingType.Decimal,
                precision: 0,
              }
            : undefined,
      },
      lookupOptions: {
        foreignTableId: foreignTable.id,
        linkFieldId: linkField.id,
        lookupFieldId, // getFieldByType(table2.fields, FieldType.SingleLineText).id,
      } as ILookupOptionsRo,
    };

    // create rollup field
    await createField(table.id, rollupFieldRo);

    await updateTableFields(table);
    return getFieldByName(table.fields, rollupFieldRo.name!);
  }

  it('should update rollupField by remove a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id, 'countall({values})');

    // update a field that will be rollup by after field
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual(2);

    // remove a link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter1.fields[rollupFieldVo.id]).toEqual(1);

    // remove all link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      null
    );

    const recordAfter2 = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter2.fields[rollupFieldVo.id]).toBeUndefined();

    // add a link record from many - one field
    await updateRecordField(
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const recordAfter3 = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter3.fields[rollupFieldVo.id]).toEqual(1);
  });

  it('should update many - one rollupField by remove a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table1.fields, FieldType.Number);
    const rollupFieldVo = await rollupFrom(table2, lookedUpToField.id, 'sum({values})');

    // update a field that will be lookup by after field
    await updateRecordField(table1.id, table1.records[1].id, lookedUpToField.id, 123);

    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const record1 = await getRecord(table2.id, table2.records[1].id);
    expect(record1.fields[rollupFieldVo.id]).toEqual(123);
    const record2 = await getRecord(table2.id, table2.records[2].id);
    expect(record2.fields[rollupFieldVo.id]).toEqual(123);

    // remove a link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record3 = await getRecord(table2.id, table2.records[1].id);
    expect(record3.fields[rollupFieldVo.id]).toEqual(123);
    const record4 = await getRecord(table2.id, table2.records[2].id);
    expect(record4.fields[rollupFieldVo.id]).toBeUndefined();

    // remove all link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      null
    );

    const record5 = await getRecord(table2.id, table2.records[1].id);
    expect(record5.fields[rollupFieldVo.id]).toBeUndefined();

    // add a link record from many - one field
    await updateRecordField(
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const record6 = await getRecord(table2.id, table2.records[1].id);
    expect(record6.fields[rollupFieldVo.id]).toEqual(123);
  });

  it('should update many - one rollupField by replace a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id);

    // update a field that will be lookup by after field
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.SingleLineText).id,
      'A2'
    );
    await updateRecordField(
      table1.id,
      table1.records[2].id,
      getFieldByType(table1.fields, FieldType.SingleLineText).id,
      'A3'
    );
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordField(
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[1].id }
    );

    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual(1);

    // replace a link record
    await updateRecordField(
      table2.id,
      table2.records[1].id,
      getFieldByType(table2.fields, FieldType.Link).id,
      { id: table1.records[2].id }
    );

    const record1 = await getRecord(table1.id, table1.records[1].id);
    expect(record1.fields[rollupFieldVo.id]).toBeUndefined();
    const record2 = await getRecord(table1.id, table1.records[2].id);
    expect(record2.fields[rollupFieldVo.id]).toEqual(1);
  });

  it('should update one - many rollupField by add a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id, 'concatenate({values})');

    // update a field that will be lookup by after field
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual('123');

    // add a link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter1.fields[rollupFieldVo.id]).toEqual('123, 456');
  });

  it('should roll up a flat array  multiple select field -> one - many rollup field', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.MultipleSelect);
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id, 'countall({values})');
    // update a field that will be lookup by after field
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, ['rap', 'rock']);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, ['rap', 'hiphop']);

    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );
    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual(4);
  });

  it('should update one - many rollupField by replace a linkRecord from cell', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id, 'sum({values})');

    // update a field that will be lookup by after field
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, 123);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, 456);

    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }]
    );

    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual(123);

    // replace a link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[2].id }]
    );

    const recordAfter1 = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter1.fields[rollupFieldVo.id]).toEqual(456);
  });

  it('should calculate when add a rollup field', async () => {
    const textField = getFieldByType(table1.fields, FieldType.SingleLineText);

    await updateRecordField(table1.id, table1.records[0].id, textField.id, 'A1');
    await updateRecordField(table1.id, table1.records[1].id, textField.id, 'A2');
    await updateRecordField(table1.id, table1.records[2].id, textField.id, 'A3');

    const lookedUpToField = getFieldByType(table1.fields, FieldType.SingleLineText);

    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    const rollupFieldVo = await rollupFrom(table2, lookedUpToField.id);
    const record0 = await getRecord(table2.id, table2.records[0].id);
    expect(record0.fields[rollupFieldVo.id]).toEqual(undefined);
    const record1 = await getRecord(table2.id, table2.records[1].id);
    expect(record1.fields[rollupFieldVo.id]).toEqual(1);
    const record2 = await getRecord(table2.id, table2.records[2].id);
    expect(record2.fields[rollupFieldVo.id]).toEqual(1);
  });

  it('should rollup a number field in  one - many relationship', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, null);
    // add a link record after
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      [{ id: table2.records[1].id }, { id: table2.records[2].id }]
    );

    await rollupFrom(table1, lookedUpToField.id, 'count({values})');
    // update a field that will be lookup by after field
    const lookedUpToField2 = getFieldByType(table2.fields, FieldType.SingleLineText);

    await rollupFrom(table1, lookedUpToField2.id, 'count({values})');
  });
});
