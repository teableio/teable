/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { INestApplication } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IFilter,
  ILookupOptionsRo,
  IRecord,
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
import {
  createField,
  convertField,
  createTable,
  permanentDeleteTable,
  getField,
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
    await permanentDeleteTable(baseId, table1.id);
    await permanentDeleteTable(baseId, table2.id);

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
        formatting: ['count', 'sum', 'average'].some((prefix) => expression.startsWith(prefix))
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
    expect(recordAfter2.fields[rollupFieldVo.id]).toEqual(0);

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
    expect(record4.fields[rollupFieldVo.id]).toEqual(0);

    // remove all link record
    await updateRecordField(
      table1.id,
      table1.records[1].id,
      getFieldByType(table1.fields, FieldType.Link).id,
      null
    );

    const record5 = await getRecord(table2.id, table2.records[1].id);
    expect(record5.fields[rollupFieldVo.id]).toEqual(0);

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

  it('should calculate average in one - many rollup field', async () => {
    const lookedUpToField = getFieldByType(table2.fields, FieldType.Number);
    const linkFieldId = getFieldByType(table1.fields, FieldType.Link).id;
    const rollupFieldVo = await rollupFrom(table1, lookedUpToField.id, 'average({values})');

    await updateRecordField(table2.id, table2.records[1].id, lookedUpToField.id, 20);
    await updateRecordField(table2.id, table2.records[2].id, lookedUpToField.id, 40);

    await updateRecordField(table1.id, table1.records[1].id, linkFieldId, [
      { id: table2.records[1].id },
      { id: table2.records[2].id },
    ]);

    const record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[rollupFieldVo.id]).toEqual(30);

    await updateRecordField(table1.id, table1.records[1].id, linkFieldId, [
      { id: table2.records[2].id },
    ]);

    const recordAfter = await getRecord(table1.id, table1.records[1].id);
    expect(recordAfter.fields[rollupFieldVo.id]).toEqual(40);
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
    expect(record1.fields[rollupFieldVo.id]).toEqual(0);
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

  describe('rollup expression coverage', () => {
    const baseId = globalThis.testConfig.baseId;

    const setupRollupFixtures = async () => {
      const foreign = await createTable(baseId, {
        name: 'RollupExpr_Foreign',
        fields: [
          { name: 'Label', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Amount', type: FieldType.Number } as IFieldRo,
          { name: 'Flag', type: FieldType.Checkbox } as IFieldRo,
        ],
        records: [
          { fields: { Label: 'Alpha', Amount: 10, Flag: true } },
          { fields: { Label: 'Beta', Amount: 20, Flag: false } },
        ],
      });

      const host = await createTable(baseId, {
        name: 'RollupExpr_Host',
        fields: [{ name: 'Name', type: FieldType.SingleLineText } as IFieldRo],
        records: [{ fields: { Name: 'Rollup Holder' } }],
      });

      const linkField = await createField(host.id, {
        name: 'Links',
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: foreign.id,
        },
      } as IFieldRo);

      const hostRecordId = host.records[0].id;
      await updateRecordField(
        host.id,
        hostRecordId,
        linkField.id,
        foreign.records.map((record) => ({ id: record.id }))
      );

      const amountId = foreign.fields.find((field) => field.name === 'Amount')!.id;
      const labelId = foreign.fields.find((field) => field.name === 'Label')!.id;
      const flagId = foreign.fields.find((field) => field.name === 'Flag')!.id;

      return { foreign, host, linkField, hostRecordId, amountId, labelId, flagId };
    };

    const rollupCases: Array<{
      expression: string;
      lookupFieldKey: 'amountId' | 'labelId' | 'flagId';
      expected: unknown;
    }> = [
      { expression: 'countall({values})', lookupFieldKey: 'amountId', expected: 2 },
      { expression: 'counta({values})', lookupFieldKey: 'labelId', expected: 2 },
      { expression: 'count({values})', lookupFieldKey: 'amountId', expected: 2 },
      { expression: 'sum({values})', lookupFieldKey: 'amountId', expected: 30 },
      { expression: 'average({values})', lookupFieldKey: 'amountId', expected: 15 },
      { expression: 'max({values})', lookupFieldKey: 'amountId', expected: 20 },
      { expression: 'min({values})', lookupFieldKey: 'amountId', expected: 10 },
      { expression: 'and({values})', lookupFieldKey: 'flagId', expected: true },
      { expression: 'or({values})', lookupFieldKey: 'flagId', expected: true },
      { expression: 'xor({values})', lookupFieldKey: 'flagId', expected: true },
      { expression: 'array_join({values})', lookupFieldKey: 'labelId', expected: 'Alpha, Beta' },
      {
        expression: 'array_unique({values})',
        lookupFieldKey: 'labelId',
        expected: ['Alpha', 'Beta'],
      },
      {
        expression: 'array_compact({values})',
        lookupFieldKey: 'labelId',
        expected: ['Alpha', 'Beta'],
      },
      { expression: 'concatenate({values})', lookupFieldKey: 'labelId', expected: 'Alpha, Beta' },
    ];

    it.each(rollupCases)(
      'should compute rollup using %s',
      async ({ expression, lookupFieldKey, expected }) => {
        let fixtures: Awaited<ReturnType<typeof setupRollupFixtures>> | undefined;
        try {
          fixtures = await setupRollupFixtures();
          const { foreign, host, linkField, hostRecordId } = fixtures;
          const lookupFieldId = fixtures[lookupFieldKey];

          const field = await createField(host.id, {
            name: `rollup ${expression}`,
            type: FieldType.Rollup,
            options: { expression },
            lookupOptions: {
              foreignTableId: foreign.id,
              linkFieldId: linkField.id,
              lookupFieldId,
            } as ILookupOptionsRo,
          } as IFieldRo);

          const record = await getRecord(host.id, hostRecordId);
          const value = record.fields[field.id];

          if (Array.isArray(expected)) {
            expect(Array.isArray(value)).toBe(true);
            const sortedExpected = [...expected].sort();
            const sortedValue = [...(value as unknown[])].sort();
            expect(sortedValue).toEqual(sortedExpected);
          } else if (typeof expected === 'string') {
            if (expected.includes(', ')) {
              expect((value as string).split(', ').sort()).toEqual(expected.split(', ').sort());
            } else {
              expect(value).toEqual(expected);
            }
          } else {
            expect(value).toEqual(expected);
          }
        } finally {
          if (fixtures?.host) {
            await permanentDeleteTable(baseId, fixtures.host.id);
          }
          if (fixtures?.foreign) {
            await permanentDeleteTable(baseId, fixtures.foreign.id);
          }
        }
      }
    );
  });

  it('should create rollup fields with array join, unique, and compact expressions', async () => {
    const textField = getFieldByType(table2.fields, FieldType.SingleLineText);
    const linkFieldId = getFieldByType(table1.fields, FieldType.Link).id;

    // Link all foreign records to a host record for evaluation
    await updateRecordField(table1.id, table1.records[1].id, linkFieldId, [
      { id: table2.records[0].id },
      { id: table2.records[1].id },
      { id: table2.records[2].id },
    ]);

    // Populate duplicate values to verify join & unique behaviours
    await updateRecordField(table2.id, table2.records[0].id, textField.id, 'Alpha');
    await updateRecordField(table2.id, table2.records[1].id, textField.id, 'Alpha');
    await updateRecordField(table2.id, table2.records[2].id, textField.id, 'Beta');

    const arrayJoinRollup = await rollupFrom(table1, textField.id, 'array_join({values})');
    const arrayUniqueRollup = await rollupFrom(table1, textField.id, 'array_unique({values})');

    let record = await getRecord(table1.id, table1.records[1].id);
    const joinedValues = (record.fields[arrayJoinRollup.id] as string).split(', ').sort();
    expect(joinedValues).toEqual(['Alpha', 'Alpha', 'Beta'].sort());
    const uniqueValues = [...(record.fields[arrayUniqueRollup.id] as string[])].sort();
    expect(uniqueValues).toEqual(['Alpha', 'Beta']);

    // Update values to include blanks and verify compact removes empty entries
    await updateRecordField(table2.id, table2.records[0].id, textField.id, 'Gamma');
    await updateRecordField(table2.id, table2.records[1].id, textField.id, '');
    await updateRecordField(table2.id, table2.records[2].id, textField.id, null);

    const arrayCompactRollup = await rollupFrom(table1, textField.id, 'array_compact({values})');
    record = await getRecord(table1.id, table1.records[1].id);
    expect(record.fields[arrayCompactRollup.id]).toEqual(['Gamma']);
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
    expect(record0.fields[rollupFieldVo.id]).toEqual(0);
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

  describe('rollup targeting conditional computed fields', () => {
    let leaf: ITableFullVo;
    let middle: ITableFullVo;
    let root: ITableFullVo;
    let activeScoreConditionalRollup: IFieldVo;
    let activeItemConditionalLookup: IFieldVo;
    let rootLinkFieldId: string;

    beforeAll(async () => {
      leaf = await createTable(baseId, {
        name: 'RollupConditional_Leaf',
        fields: [
          { name: 'Item', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Category', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Score', type: FieldType.Number } as IFieldRo,
          { name: 'Status', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Item: 'Alpha', Category: 'Hardware', Score: 60, Status: 'Active' } },
          { fields: { Item: 'Beta', Category: 'Hardware', Score: 40, Status: 'Inactive' } },
          { fields: { Item: 'Gamma', Category: 'Software', Score: 80, Status: 'Active' } },
        ],
      });

      const leafItemId = leaf.fields.find((field) => field.name === 'Item')!.id;
      const leafCategoryId = leaf.fields.find((field) => field.name === 'Category')!.id;
      const leafScoreId = leaf.fields.find((field) => field.name === 'Score')!.id;
      const leafStatusId = leaf.fields.find((field) => field.name === 'Status')!.id;

      middle = await createTable(baseId, {
        name: 'RollupConditional_Middle',
        fields: [
          { name: 'Summary', type: FieldType.SingleLineText } as IFieldRo,
          { name: 'Target Category', type: FieldType.SingleLineText } as IFieldRo,
        ],
        records: [
          { fields: { Summary: 'Hardware Overview', 'Target Category': 'Hardware' } },
          { fields: { Summary: 'Software Overview', 'Target Category': 'Software' } },
        ],
      });
      const targetCategoryFieldId = middle.fields.find(
        (field) => field.name === 'Target Category'
      )!.id;

      const categoryMatchFilter: IFilter = {
        conjunction: 'and',
        filterSet: [
          {
            fieldId: leafCategoryId,
            operator: 'is',
            value: { type: 'field', fieldId: targetCategoryFieldId },
          },
          {
            fieldId: leafStatusId,
            operator: 'is',
            value: 'Active',
          },
        ],
      } as any;

      activeScoreConditionalRollup = await createField(middle.id, {
        name: 'Active Category Score',
        type: FieldType.ConditionalRollup,
        options: {
          foreignTableId: leaf.id,
          lookupFieldId: leafScoreId,
          expression: 'sum({values})',
          filter: categoryMatchFilter,
        },
      } as IFieldRo);

      activeItemConditionalLookup = await createField(middle.id, {
        name: 'Active Item Names',
        type: FieldType.SingleLineText,
        isLookup: true,
        isConditionalLookup: true,
        lookupOptions: {
          foreignTableId: leaf.id,
          lookupFieldId: leafItemId,
          filter: categoryMatchFilter,
        } as ILookupOptionsRo,
      } as IFieldRo);

      await updateTableFields(middle);
      tables.push(middle);

      root = await createTable(baseId, {
        name: 'RollupConditional_Root',
        fields: [{ name: 'Region', type: FieldType.SingleLineText } as IFieldRo],
        records: [
          { fields: { Region: 'North' } },
          { fields: { Region: 'Global' } },
          { fields: { Region: 'Unlinked' } },
        ],
      });

      const rootLinkField = await createField(root.id, {
        name: 'Middle Connection',
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyMany,
          foreignTableId: middle.id,
        },
      });
      rootLinkFieldId = rootLinkField.id;

      await updateTableFields(root);
      tables.push(root);

      await updateRecordField(root.id, root.records[0].id, rootLinkFieldId, [
        { id: middle.records[0].id },
      ]);
      await updateRecordField(root.id, root.records[1].id, rootLinkFieldId, [
        { id: middle.records[0].id },
        { id: middle.records[1].id },
      ]);
    });

    afterAll(async () => {
      await permanentDeleteTable(baseId, root.id);
      await permanentDeleteTable(baseId, middle.id);
      await permanentDeleteTable(baseId, leaf.id);
    });

    it('should roll up conditional rollup values across linked tables', async () => {
      const hardwareSummary = await getRecord(middle.id, middle.records[0].id);
      const softwareSummary = await getRecord(middle.id, middle.records[1].id);
      expect(hardwareSummary.fields[activeScoreConditionalRollup.id]).toEqual(60);
      expect(softwareSummary.fields[activeScoreConditionalRollup.id]).toEqual(80);

      const rollupFieldVo = await rollupFrom(
        root,
        activeScoreConditionalRollup.id,
        'sum({values})'
      );

      const north = await getRecord(root.id, root.records[0].id);
      const global = await getRecord(root.id, root.records[1].id);
      const unlinked = await getRecord(root.id, root.records[2].id);

      expect(north.fields[rollupFieldVo.id]).toEqual(60);
      expect(global.fields[rollupFieldVo.id]).toEqual(140);
      expect(unlinked.fields[rollupFieldVo.id]).toEqual(0);
    });

    it('should aggregate conditional lookup chains with rollup fields', async () => {
      const hardwareSummary = await getRecord(middle.id, middle.records[0].id);
      const softwareSummary = await getRecord(middle.id, middle.records[1].id);
      expect(hardwareSummary.fields[activeItemConditionalLookup.id]).toEqual(['Alpha']);
      expect(softwareSummary.fields[activeItemConditionalLookup.id]).toEqual(['Gamma']);

      const rollupFieldVo = await rollupFrom(
        root,
        activeItemConditionalLookup.id,
        'countall({values})'
      );

      const north = await getRecord(root.id, root.records[0].id);
      const global = await getRecord(root.id, root.records[1].id);
      const unlinked = await getRecord(root.id, root.records[2].id);

      expect(north.fields[rollupFieldVo.id]).toEqual(1);
      expect(global.fields[rollupFieldVo.id]).toEqual(2);
      expect(unlinked.fields[rollupFieldVo.id]).toEqual(0);
    });

    it('should concatenate conditional lookup values when rolled up', async () => {
      const decodeRollupValue = (value: unknown) => {
        if (value == null) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          if (value === '') return [];
          const tryParse = (input: string) => {
            try {
              return JSON.parse(input);
            } catch {
              return undefined;
            }
          };

          const direct = tryParse(value);
          if (direct !== undefined) return direct;

          const parts = value.split('],').map((part) => {
            const normalized = part.trim();
            const withBracket = normalized.endsWith(']') ? normalized : `${normalized}]`;
            const parsed = tryParse(withBracket);
            return parsed ?? [normalized.replace(/^\[|"|'|\]$/g, '')];
          });
          return parts.flat();
        }
        return value;
      };

      const rollupFieldVo = await rollupFrom(
        root,
        activeItemConditionalLookup.id,
        'concatenate({values})'
      );

      const north = await getRecord(root.id, root.records[0].id);
      const global = await getRecord(root.id, root.records[1].id);
      const unlinked = await getRecord(root.id, root.records[2].id);

      expect(decodeRollupValue(north.fields[rollupFieldVo.id])).toEqual(['Alpha']);
      expect(decodeRollupValue(global.fields[rollupFieldVo.id])).toEqual(['Alpha', 'Gamma']);
      expect(decodeRollupValue(unlinked.fields[rollupFieldVo.id])).toEqual([]);
    });
  });

  describe('Rollup aggregation validation', () => {
    it('keeps numeric aggregation valid for numeric sources', async () => {
      const foreign = await createTable(baseId, {
        name: 'RollupValidationForeign',
        fields: [{ name: 'Amount', type: FieldType.Number } as IFieldRo],
      });
      const host = await createTable(baseId, {
        name: 'RollupValidationHost',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
      });
      const amountFieldId = foreign.fields.find((field) => field.name === 'Amount')!.id;

      try {
        const linkField = await createField(host.id, {
          name: 'Link to Foreign',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: foreign.id,
          },
        } as IFieldRo);

        const rollupField = await createField(host.id, {
          name: 'Sum Amount',
          type: FieldType.Rollup,
          options: {
            expression: 'sum({values})',
          },
          lookupOptions: {
            foreignTableId: foreign.id,
            linkFieldId: linkField.id,
            lookupFieldId: amountFieldId,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const fetched = await getField(host.id, rollupField.id);
        expect(fetched.hasError).toBeFalsy();
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });

    it('marks rollup as errored when numeric source becomes text', async () => {
      const foreign = await createTable(baseId, {
        name: 'RollupValidationForeignConversion',
        fields: [{ name: 'Amount', type: FieldType.Number } as IFieldRo],
      });
      const host = await createTable(baseId, {
        name: 'RollupValidationHostConversion',
        fields: [{ name: 'Label', type: FieldType.SingleLineText } as IFieldRo],
      });
      const amountFieldId = foreign.fields.find((field) => field.name === 'Amount')!.id;

      try {
        const linkField = await createField(host.id, {
          name: 'Link to Foreign',
          type: FieldType.Link,
          options: {
            relationship: Relationship.OneMany,
            foreignTableId: foreign.id,
          },
        } as IFieldRo);

        const rollupField = await createField(host.id, {
          name: 'Sum Amount',
          type: FieldType.Rollup,
          options: {
            expression: 'sum({values})',
          },
          lookupOptions: {
            foreignTableId: foreign.id,
            linkFieldId: linkField.id,
            lookupFieldId: amountFieldId,
          } as ILookupOptionsRo,
        } as IFieldRo);

        const initial = await getField(host.id, rollupField.id);
        expect(initial.hasError).toBeFalsy();

        await convertField(foreign.id, amountFieldId, {
          name: 'Amount',
          type: FieldType.SingleLineText,
          options: {},
        } as IFieldRo);

        const afterConvert = await getField(host.id, rollupField.id);
        expect(afterConvert.hasError).toBe(true);
      } finally {
        await permanentDeleteTable(baseId, host.id);
        await permanentDeleteTable(baseId, foreign.id);
      }
    });
  });

  describe('Roll up corner case', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;

    beforeEach(async () => {
      table1 = await createTable(baseId, {});
      table2 = await createTable(baseId, {});
    });

    it('should update multiple field when rollup  to sum a formula field', async () => {
      const numberField = await createField(table1.id, {
        type: FieldType.Number,
      });

      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${numberField.id}}`,
        },
      });

      const linkField = await createField(table2.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      });

      const rollup1 = await createField(table2.id, {
        name: `rollup 1`,
        type: FieldType.Rollup,
        options: {
          expression: `sum({values})`,
        },
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField.id,
          lookupFieldId: formulaField.id,
        } as ILookupOptionsRo,
      });

      const rollup2 = await createField(table2.id, {
        name: `rollup 2`,
        type: FieldType.Rollup,
        options: {
          expression: `sum({values})`,
        },
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField.id,
          lookupFieldId: formulaField.id,
        } as ILookupOptionsRo,
      });

      await updateRecordField(table1.id, table1.records[0].id, numberField.id, 1);
      await updateRecordField(table1.id, table1.records[1].id, numberField.id, 2);

      // add a link record after
      await updateRecordField(table2.id, table2.records[0].id, linkField.id, [
        { id: table1.records[0].id },
        { id: table1.records[1].id },
      ]);

      const record1 = await getRecord(table2.id, table2.records[0].id);

      expect(record1.fields[rollup1.id]).toEqual(3);
      expect(record1.fields[rollup2.id]).toEqual(3);

      await updateRecordField(table1.id, table1.records[1].id, numberField.id, 3);

      const record2 = await getRecord(table2.id, table2.records[0].id);
      expect([record2.fields[rollup1.id], record2.fields[rollup2.id]]).toEqual([4, 4]);
    });

    it('should calculate rollup event has no link record', async () => {
      const numberField = await createField(table1.id, {
        type: FieldType.Number,
      });

      const linkField = await createField(table2.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.OneMany,
          foreignTableId: table1.id,
        },
      });

      const rollup1 = await createField(table2.id, {
        name: `rollup 1`,
        type: FieldType.Rollup,
        options: {
          expression: `sum({values})`,
        },
        lookupOptions: {
          foreignTableId: table1.id,
          linkFieldId: linkField.id,
          lookupFieldId: numberField.id,
        } as ILookupOptionsRo,
      });

      const record1 = await getRecord(table2.id, table2.records[0].id);
      expect(record1.fields[rollup1.id]).toEqual(0);
    });
  });
});
