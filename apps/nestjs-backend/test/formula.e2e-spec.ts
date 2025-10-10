/* eslint-disable sonarjs/no-duplicate-string */
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
  let table1: ITableFullVo;
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

    table1 = await createTable(baseId, {
      name: 'table1',
      fields: [numberFieldRo, textFieldRo, formulaFieldRo],
    });
    table1Id = table1.id;
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

  it('should concatenate strings with plus operator when operands are blank', async () => {
    const plusNumberSuffixField = await createField(table1Id, {
      name: 'plus-number-suffix',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} + ''`,
      },
    });

    const plusNumberPrefixField = await createField(table1Id, {
      name: 'plus-number-prefix',
      type: FieldType.Formula,
      options: {
        expression: `'' + {${numberFieldRo.id}}`,
      },
    });

    const plusTextSuffixField = await createField(table1Id, {
      name: 'plus-text-suffix',
      type: FieldType.Formula,
      options: {
        expression: `{${textFieldRo.id}} + ''`,
      },
    });

    const plusTextPrefixField = await createField(table1Id, {
      name: 'plus-text-prefix',
      type: FieldType.Formula,
      options: {
        expression: `'' + {${textFieldRo.id}}`,
      },
    });

    const plusMixedField = await createField(table1Id, {
      name: 'plus-mixed-field',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldRo.id}} + {${textFieldRo.id}}`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [numberFieldRo.name]: 1,
          },
        },
      ],
    });

    const createdRecord = records[0];
    expect(createdRecord.fields[plusNumberSuffixField.name]).toEqual('1');
    expect(createdRecord.fields[plusNumberPrefixField.name]).toEqual('1');
    expect(createdRecord.fields[plusTextSuffixField.name]).toEqual('');
    expect(createdRecord.fields[plusTextPrefixField.name]).toEqual('');
    expect(createdRecord.fields[plusMixedField.name]).toEqual('1');

    const updatedRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'x',
        },
      },
    });

    expect(updatedRecord.fields[plusNumberSuffixField.name]).toEqual('1');
    expect(updatedRecord.fields[plusNumberPrefixField.name]).toEqual('1');
    expect(updatedRecord.fields[plusTextSuffixField.name]).toEqual('x');
    expect(updatedRecord.fields[plusTextPrefixField.name]).toEqual('x');
    expect(updatedRecord.fields[plusMixedField.name]).toEqual('1x');
  });

  it('should treat empty string comparison as blank in formula condition', async () => {
    const equalsEmptyField = await createField(table1Id, {
      name: 'equals empty string',
      type: FieldType.Formula,
      options: {
        expression: `IF({${textFieldRo.id}}="", 1, 0)`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {},
        },
      ],
    });

    const createdRecord = records[0];
    const fetchedRecord = await getRecord(table1Id, createdRecord.id);
    expect(createdRecord.fields[equalsEmptyField.name]).toEqual(1);
    expect(fetchedRecord.data.fields[equalsEmptyField.name]).toEqual(1);

    const filledRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: 'value',
        },
      },
    });

    expect(filledRecord.fields[equalsEmptyField.name]).toEqual(0);

    const clearedRecord = await updateRecord(table1Id, createdRecord.id, {
      fieldKeyType: FieldKeyType.Name,
      record: {
        fields: {
          [textFieldRo.name]: '',
        },
      },
    });

    expect(clearedRecord.fields[equalsEmptyField.name]).toEqual(1);
  });

  it('should calculate formula containing question mark literal', async () => {
    const urlFormulaField = await createField(table1Id, {
      name: 'url formula',
      type: FieldType.Formula,
      options: {
        expression: `'https://example.com/?id=' & {${textFieldRo.id}}`,
      },
    });

    const { records } = await createRecords(table1Id, {
      fieldKeyType: FieldKeyType.Name,
      records: [
        {
          fields: {
            [textFieldRo.name]: 'abc',
          },
        },
      ],
    });

    expect(records[0].fields[urlFormulaField.name]).toEqual('https://example.com/?id=abc');
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

    it.skip('should evaluate boolean formulas with timezone aware date arguments', async () => {
      const dateField = await createField(table.id, {
        name: 'Boolean date',
        type: FieldType.Date,
      });

      const recordId = table.records[0].id;
      await updateRecord(table.id, recordId, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [dateField.name]: '2024-03-01T00:00:00+08:00',
          },
        },
      });

      const andField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `AND(IS_AFTER({${dateField.id}}, '2024-02-28T23:00:00+08:00'), IS_BEFORE({${dateField.id}}, '2024-03-01T12:00:00+08:00'))`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterAnd = await getRecord(table.id, recordId);
      expect(recordAfterAnd.data.fields[andField.name]).toEqual(true);

      const orField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `OR(IS_AFTER({${dateField.id}}, '2024-03-01T12:00:00+08:00'), IS_SAME(DATETIME_PARSE('2024-03-01T00:00:00+08:00'), {${dateField.id}}, 'minute'))`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterOr = await getRecord(table.id, recordId);
      expect(recordAfterOr.data.fields[orField.name]).toEqual(true);

      const ifField = await createField(table.id, {
        type: FieldType.Formula,
        options: {
          expression: `IF(IS_AFTER({${dateField.id}}, '2024-02-29T00:00:00+09:00'), 'after', 'before')`,
          timeZone: 'Asia/Shanghai',
        },
      });

      const recordAfterIf = await getRecord(table.id, recordId);
      expect(recordAfterIf.data.fields[ifField.name]).toEqual('after');
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

    it('should update record by name wile have create last modified field', async () => {
      await createField(table.id, {
        type: FieldType.LastModifiedTime,
      });

      await updateRecord(table.id, table.records[0].id, {
        fieldKeyType: FieldKeyType.Name,
        record: {
          fields: {
            [table.fields[0].name]: '1',
          },
        },
      });

      const record = await getRecord(table.id, table.records[0].id);
      expect(record.data.fields[table.fields[0].name]).toEqual('1');
    });
  });
});
