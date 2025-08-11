/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { FormulaFieldCore, IFieldVo } from '@teable/core';
import { Colors, FieldKeyType, FieldType, Relationship } from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getError } from './utils/get-error';
import {
  createField,
  createTable,
  deleteTable,
  getRecords,
  initApp,
  updateRecordByApi,
} from './utils/init-app';

describe('OpenAPI Formula Field (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;

  beforeAll(async () => {
    app = (await initApp()).app;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('create formula field', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      // Create a table with various field types for testing
      table = await createTable(baseId, {
        name: 'Formula Test Table',
        fields: [
          {
            name: 'Text Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Number Field',
            type: FieldType.Number,
            options: {
              formatting: { type: 'decimal', precision: 2 },
            },
          },
          {
            name: 'Date Field',
            type: FieldType.Date,
          },
          {
            name: 'Rating Field',
            type: FieldType.Rating,
            options: {
              icon: 'star',
              max: 5,
              color: 'yellowBright',
            },
          },
          {
            name: 'Checkbox Field',
            type: FieldType.Checkbox,
          },
          {
            name: 'Select Field',
            type: FieldType.SingleSelect,
            options: {
              choices: [
                { name: 'Option A', color: Colors.Blue },
                { name: 'Option B', color: Colors.Red },
              ],
            },
          },
        ],
        records: [
          {
            fields: {
              'Text Field': 'Hello World',
              'Number Field': 42.5,
              'Date Field': '2024-01-15',
              'Rating Field': 4,
              'Checkbox Field': true,
              'Select Field': 'Option A',
            },
          },
          {
            fields: {
              'Text Field': 'Test String',
              'Number Field': 100,
              'Date Field': '2024-02-20',
              'Rating Field': 3,
              'Checkbox Field': false,
              'Select Field': 'Option B',
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula referencing text field', async () => {
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Text Formula',
        options: {
          expression: `UPPER({${textFieldId}})`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`UPPER({${textFieldId}})`);

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('HELLO WORLD');
      expect(records[1].fields[formulaField.id]).toBe('TEST STRING');
    });

    it('should create formula referencing number field', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Number Formula',
        options: {
          expression: `{${numberFieldId}} * 2`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(85);
      expect(records[1].fields[formulaField.id]).toBe(200);
    });

    it('should create formula referencing date field', async () => {
      const dateFieldId = table.fields.find((f) => f.name === 'Date Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Date Formula',
        options: {
          expression: `YEAR({${dateFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(2024);
      expect(records[1].fields[formulaField.id]).toBe(2024);
    });

    it('should create formula referencing rating field', async () => {
      const ratingFieldId = table.fields.find((f) => f.name === 'Rating Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Rating Formula',
        options: {
          expression: `{${ratingFieldId}} + 1`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(5);
      expect(records[1].fields[formulaField.id]).toBe(4);
    });

    it('should create formula referencing checkbox field', async () => {
      const checkboxFieldId = table.fields.find((f) => f.name === 'Checkbox Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Checkbox Formula',
        options: {
          expression: `IF({${checkboxFieldId}}, "Yes", "No")`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Yes');
      expect(records[1].fields[formulaField.id]).toBe('No');
    });

    it('should create formula referencing select field', async () => {
      const selectFieldId = table.fields.find((f) => f.name === 'Select Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Select Formula',
        options: {
          expression: `CONCATENATE("Selected: ", {${selectFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Selected: Option A');
      expect(records[1].fields[formulaField.id]).toBe('Selected: Option B');
    });

    it('should create formula with multiple field references', async () => {
      const textFieldId = table.fields.find((f) => f.name === 'Text Field')!.id;
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Multi Field Formula',
        options: {
          expression: `CONCATENATE({${textFieldId}}, " - ", {${numberFieldId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Hello World - 42.5');
      expect(records[1].fields[formulaField.id]).toBe('Test String - 100');
    });
  });

  describe('create formula referencing formula', () => {
    let table: ITableFullVo;
    let baseFormulaField: IFieldVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Nested Formula Test Table',
        fields: [
          {
            name: 'Number Field',
            type: FieldType.Number,
          },
        ],
        records: [{ fields: { 'Number Field': 10 } }, { fields: { 'Number Field': 20 } }],
      });

      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      // Create base formula field
      baseFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Base Formula',
        options: {
          expression: `{${numberFieldId}} * 2`,
        },
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula referencing another formula', async () => {
      const nestedFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Nested Formula',
        options: {
          expression: `{${baseFormulaField.id}} + 5`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[nestedFormulaField.id]).toBe(25); // (10 * 2) + 5
      expect(records[1].fields[nestedFormulaField.id]).toBe(45); // (20 * 2) + 5
    });

    it('should create complex nested formula', async () => {
      const numberFieldId = table.fields.find((f) => f.name === 'Number Field')!.id;

      const complexFormulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Complex Formula',
        options: {
          expression: `IF({${baseFormulaField.id}} > {${numberFieldId}}, "Greater", "Not Greater")`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[complexFormulaField.id]).toBe('Greater'); // 20 > 10
      expect(records[1].fields[complexFormulaField.id]).toBe('Greater'); // 40 > 20
    });
  });

  describe('create formula with link, lookup and rollup fields', () => {
    let table1: ITableFullVo;
    let table2: ITableFullVo;
    let linkField: IFieldVo;
    let lookupField: IFieldVo;
    let rollupField: IFieldVo;

    beforeEach(async () => {
      // Create first table
      table1 = await createTable(baseId, {
        name: 'Main Table',
        fields: [
          {
            name: 'Name',
            type: FieldType.SingleLineText,
          },
        ],
        records: [{ fields: { Name: 'Record 1' } }, { fields: { Name: 'Record 2' } }],
      });

      // Create second table
      table2 = await createTable(baseId, {
        name: 'Related Table',
        fields: [
          {
            name: 'Title',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Value',
            type: FieldType.Number,
          },
        ],
        records: [
          { fields: { Title: 'Item A', Value: 100 } },
          { fields: { Title: 'Item B', Value: 200 } },
        ],
      });

      // Create link field
      linkField = await createField(table1.id, {
        type: FieldType.Link,
        options: {
          relationship: Relationship.ManyOne,
          foreignTableId: table2.id,
        },
      });

      // Link records
      await updateRecordByApi(table1.id, table1.records[0].id, linkField.id, {
        id: table2.records[0].id,
      });
      await updateRecordByApi(table1.id, table1.records[1].id, linkField.id, {
        id: table2.records[1].id,
      });

      // Create lookup field
      const titleFieldId = table2.fields.find((f) => f.name === 'Title')!.id;
      lookupField = await createField(table1.id, {
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: titleFieldId,
          linkFieldId: linkField.id,
        },
      });

      // Create rollup field
      const valueFieldId = table2.fields.find((f) => f.name === 'Value')!.id;
      rollupField = await createField(table1.id, {
        type: FieldType.Rollup,
        lookupOptions: {
          foreignTableId: table2.id,
          lookupFieldId: valueFieldId,
          linkFieldId: linkField.id,
        },
      });
    });

    afterEach(async () => {
      if (table1?.id) {
        await deleteTable(baseId, table1.id);
      }
      if (table2?.id) {
        await deleteTable(baseId, table2.id);
      }
    });

    it('should create formula referencing lookup field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Lookup Formula',
        options: {
          expression: `{${lookupField.id}}`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`{${lookupField.id}}`);
    });

    it('should create formula referencing rollup field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Rollup Formula',
        options: {
          expression: `{${rollupField.id}} * 2`,
        },
      });

      expect(formulaField.type).toBe(FieldType.Formula);
      expect((formulaField as FormulaFieldCore).options.expression).toBe(`{${rollupField.id}} * 2`);
    });

    it('should create formula referencing link field', async () => {
      const formulaField = await createField(table1.id, {
        type: FieldType.Formula,
        name: 'Link Formula',
        options: {
          expression: `IF({${linkField.id}}, "Has Link", "No Link")`,
        },
      });

      const { records } = await getRecords(table1.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Has Link');
      expect(records[1].fields[formulaField.id]).toBe('Has Link');
    });
  });

  describe('formula field error scenarios', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Error Test Table',
        fields: [
          {
            name: 'Text Field',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Number Field',
            type: FieldType.Number,
          },
        ],
        records: [{ fields: { 'Text Field': 'Test', 'Number Field': 42 } }],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should fail with invalid expression syntax', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Invalid Formula',
          options: {
            expression: 'INVALID_FUNCTION({field})',
          },
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should fail with non-existent field reference', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Invalid Field Reference',
          options: {
            expression: '{nonExistentFieldId}',
          },
        })
      );

      expect(error?.status).toBe(400);
    });

    it('should handle empty expression', async () => {
      const error = await getError(() =>
        createField(table.id, {
          type: FieldType.Formula,
          name: 'Empty Formula',
          options: {
            expression: '',
          },
        })
      );

      expect(error?.status).toBe(400);
    });
  });

  describe('complex formula scenarios', () => {
    let table: ITableFullVo;

    beforeEach(async () => {
      table = await createTable(baseId, {
        name: 'Complex Formula Table',
        fields: [
          {
            name: 'First Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Last Name',
            type: FieldType.SingleLineText,
          },
          {
            name: 'Age',
            type: FieldType.Number,
          },
          {
            name: 'Birth Date',
            type: FieldType.Date,
          },
          {
            name: 'Is Active',
            type: FieldType.Checkbox,
          },
          {
            name: 'Score',
            type: FieldType.Rating,
            options: { icon: 'star', max: 5, color: 'yellowBright' },
          },
        ],
        records: [
          {
            fields: {
              'First Name': 'John',
              'Last Name': 'Doe',
              Age: 30,
              'Birth Date': '1994-01-15',
              'Is Active': true,
              Score: 4,
            },
          },
          {
            fields: {
              'First Name': 'Jane',
              'Last Name': 'Smith',
              Age: 25,
              'Birth Date': '1999-06-20',
              'Is Active': false,
              Score: 5,
            },
          },
        ],
      });
    });

    afterEach(async () => {
      if (table?.id) {
        await deleteTable(baseId, table.id);
      }
    });

    it('should create formula with string concatenation', async () => {
      const firstNameId = table.fields.find((f) => f.name === 'First Name')!.id;
      const lastNameId = table.fields.find((f) => f.name === 'Last Name')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Full Name',
        options: {
          expression: `CONCATENATE({${firstNameId}}, " ", {${lastNameId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('John Doe');
      expect(records[1].fields[formulaField.id]).toBe('Jane Smith');
    });

    it('should create formula with conditional logic', async () => {
      const ageId = table.fields.find((f) => f.name === 'Age')!.id;
      const isActiveId = table.fields.find((f) => f.name === 'Is Active')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Status',
        options: {
          expression: `IF(AND({${ageId}} >= 18, {${isActiveId}}), "Adult Active", IF({${ageId}} >= 18, "Adult Inactive", "Minor"))`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe('Adult Active');
      expect(records[1].fields[formulaField.id]).toBe('Adult Inactive');
    });

    it('should create formula with mathematical operations', async () => {
      const ageId = table.fields.find((f) => f.name === 'Age')!.id;
      const scoreId = table.fields.find((f) => f.name === 'Score')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Weighted Score',
        options: {
          expression: `ROUND(({${scoreId}} * {${ageId}}) / 10, 2)`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(12); // (4 * 30) / 10 = 12
      expect(records[1].fields[formulaField.id]).toBe(12.5); // (5 * 25) / 10 = 12.5
    });

    it('should create formula with date functions', async () => {
      const birthDateId = table.fields.find((f) => f.name === 'Birth Date')!.id;

      const formulaField = await createField(table.id, {
        type: FieldType.Formula,
        name: 'Birth Year',
        options: {
          expression: `YEAR({${birthDateId}})`,
        },
      });

      const { records } = await getRecords(table.id, { fieldKeyType: FieldKeyType.Id });
      expect(records[0].fields[formulaField.id]).toBe(1994);
      expect(records[1].fields[formulaField.id]).toBe(1999);
    });
  });
});
