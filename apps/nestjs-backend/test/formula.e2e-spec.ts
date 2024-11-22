import type { INestApplication } from '@nestjs/common';
import type { IFieldRo, ILinkFieldOptionsRo } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  generateFieldId,
  NumberFormattingType,
  Relationship,
} from '@teable/core';
import { getRecord, updateRecords, type ITableFullVo } from '@teable/openapi';
import {
  createField,
  createRecords,
  createTable,
  permanentDeleteTable,
  getRecords,
  initApp,
  updateRecord,
  convertField,
} from './utils/init-app';

describe('OpenAPI formula (e2e)', () => {
  let app: INestApplication;
  let table1Id = '';
  let numberFieldRo: IFieldRo & { id: string; name: string };
  let textFieldRo: IFieldRo & { id: string; name: string };
  let formulaFieldRo: IFieldRo & { id: string; name: string };
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    numberFieldRo = {
      id: generateFieldId(),
      name: 'Number field',
      description: 'the number field',
      type: FieldType.Number,
      options: {
        formatting: { type: NumberFormattingType.Decimal, precision: 1 },
      },
    };

    textFieldRo = {
      id: generateFieldId(),
      name: 'text field',
      description: 'the text field',
      type: FieldType.SingleLineText,
    };

    formulaFieldRo = {
      id: generateFieldId(),
      name: 'New field',
      description: 'the new field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} & {${textFieldRo.id}}`,
      },
    };

    table1Id = (
      await createTable(baseId, {
        name: 'table1',
        fields: [numberFieldRo, textFieldRo, formulaFieldRo],
      })
    ).id;
  });

  afterEach(async () => {
    await permanentDeleteTable(baseId, table1Id);
  });

  it('should response calculate record after create', async () => {
    const recordResult = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [numberFieldRo.name]: 1,
            [textFieldRo.name]: 'x',
          },
        },
      ],
    });

    const record = recordResult.records[0];
    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update multi record field', async () => {
    const getResult = await getRecords(table1Id);

    const existRecord = getResult.records[0];

    const record = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [numberFieldRo.name]: 1,
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(record.fields[numberFieldRo.name]).toEqual(1);
    expect(record.fields[textFieldRo.name]).toEqual('x');
    expect(record.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should response calculate record after update single record field', async () => {
    const getResult = await getRecords(table1Id);

    const existRecord = getResult.records[0];

    const record1 = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [numberFieldRo.name]: 1,
        },
      },
    });

    expect(record1.fields[numberFieldRo.name]).toEqual(1);
    expect(record1.fields[textFieldRo.name]).toBeUndefined();
    expect(record1.fields[formulaFieldRo.name]).toEqual('1');

    const record2 = await updateRecord(table1Id, existRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(record2.fields[numberFieldRo.name]).toEqual(1);
    expect(record2.fields[textFieldRo.name]).toEqual('x');
    expect(record2.fields[formulaFieldRo.name]).toEqual('1x');
  });

  it('should calculate primary field when have link relationship', async () => {
    const table2: ITableFullVo = await createTable(baseId, { name: 'table2' });
    const linkFieldRo: IFieldRo = {
      type: FieldType.Link,
      options: {
        foreignTableId: table2.id,
        relationship: Relationship.ManyOne,
      } as ILinkFieldOptionsRo,
    };

    const formulaFieldRo: IFieldRo = {
      type: FieldType.Formula,
      options: {
        expression: `{${table2.fields[0].id}}`,
      },
    };

    await createField(table1Id, linkFieldRo);

    const formulaField = await createField(table2.id, formulaFieldRo);

    const record1 = await updateRecord(table2.id, table2.records[0].id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [table2.fields[0].name]: 'text',
        },
      },
    });
    expect(record1.fields[formulaField.name]).toEqual('text');
  });

  describe('safe calculate', () => {
    let table: ITableFullVo;
    beforeEach(async () => {
      table = await createTable(baseId, { name: 'table safe' });
    });

    afterEach(async () => {
      await permanentDeleteTable(baseId, table.id);
    });

    it('should safe calculate error function', async () => {
      const field = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "'x'*10",
        },
      });

      expect(field).toBeDefined();
    });

    it('should calculate formula with timeZone', async () => {
      const field1 = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "DAY('2024-02-29T00:00:00+08:00')",
          timeZone: 'Asia/Shanghai',
        },
      });

      const record1 = await getRecord(table.id, table.records[0].id);
      expect(record1.data.fields[field1.name]).toEqual(29);

      const field2 = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: "DAY('2024-02-28T00:00:00+09:00')",
          timeZone: 'Asia/Shanghai',
        },
      });

      const record2 = await getRecord(table.id, table.records[0].id);
      expect(record2.data.fields[field2.name]).toEqual(27);
    });

    it('should calculate auto number and number field', async () => {
      const autoNumberField = await createField(table.id, {
        name: 'ttttttt',
        type: FieldType.AutoNumber,
      });

      const numberField = await createField(table.id, {
        type: FieldType.Number,
      });
      const numberField1 = await createField(table.id, {
        type: FieldType.Number,
      });

      await updateRecords(table.id, {
        fieldKeyType: FieldKeyType.Name,
        records: table.records.map((record) => ({
          id: record.id,
          fields: {
            [numberField.name]: 2,
            [numberField1.name]: 3,
          },
        })),
      });

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${autoNumberField.id}} & "-" & {${numberField.id}} & "-" & {${numberField1.id}}`,
        },
      });

      const record = await getRecords(table.id);
      expect(record.records[0].fields[formulaField.name]).toEqual('1-2-3');
      expect(record.records[0].fields[autoNumberField.name]).toEqual(1);

      await convertField(table.id, formulaField.id, {
        type: FieldType.Formula,
        options: {
          expression: `{${autoNumberField.id}} & "-" & {${numberField.id}}`,
        },
      });

      const record2 = await getRecord(table.id, table.records[0].id);
      expect(record2.data.fields[autoNumberField.name]).toEqual(1);
      expect(record2.data.fields[formulaField.name]).toEqual('1-2');

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [numberField.name]: 22,
          },
        },
      });

      const record3 = await getRecord(table.id, table.records[0].id);
      expect(record3.data.fields[formulaField.name]).toEqual('1-22');
      expect(record2.data.fields[autoNumberField.name]).toEqual(1);
    });
  });
});
