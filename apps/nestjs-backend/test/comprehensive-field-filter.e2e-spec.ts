/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { IFilter, IOperator } from '@teable/core';
import {
  and,
  FieldKeyType,
  FieldType,
  Colors,
  DateFormattingPreset,
  TimeFormatting,
  NumberFormattingType,
  Relationship,
  // Filter operators
  is,
  isNot,
  contains,
  doesNotContain,
  isGreater,
  isGreaterEqual,
  isLess,
  isLessEqual,
  isEmpty,
  isNotEmpty,
  isAnyOf,
  isNoneOf,
  hasAnyOf,
  hasAllOf,
  hasNoneOf,
  isExactly,
  isNotExactly,
  isAfter,
  isBefore,
  isOnOrAfter,
  isOnOrBefore,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, createField, createRecords } from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('Comprehensive Field Filter Tests (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let mainTable: ITableFullVo;
  let relatedTable: ITableFullVo;
  let linkField: any;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  beforeEach(async () => {
    // Create fresh tables and data for each test to ensure isolation

    // Create related table first
    relatedTable = await createTable(baseId, {
      name: 'Related Table',
      fields: [
        {
          name: 'Related Text',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Related Number',
          type: FieldType.Number,
          options: {
            formatting: { type: NumberFormattingType.Decimal, precision: 2 },
          },
        },
        {
          name: 'Related Date',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        },
        {
          name: 'Related Checkbox',
          type: FieldType.Checkbox,
        },
      ],
      records: [
        {
          fields: {
            'Related Text': 'Related Item 1',
            'Related Number': 100,
            'Related Date': '2024-01-01',
            'Related Checkbox': true,
          },
        },
        {
          fields: {
            'Related Text': 'Related Item 2',
            'Related Number': 200,
            'Related Date': '2024-02-01',
            'Related Checkbox': false,
          },
        },
        {
          fields: {
            'Related Text': 'Related Item 3',
            'Related Number': 300,
            'Related Date': '2024-03-01',
            'Related Checkbox': null,
          },
        },
      ],
    });

    // Create main table with all field types
    mainTable = await createTable(baseId, {
      name: 'Main Table',
      records: [], // Prevent default records from being created
      fields: [
        {
          name: 'Text Field',
          type: FieldType.SingleLineText,
        },
        {
          name: 'Long Text Field',
          type: FieldType.LongText,
        },
        {
          name: 'Number Field',
          type: FieldType.Number,
          options: {
            formatting: { type: NumberFormattingType.Decimal, precision: 2 },
          },
        },
        {
          name: 'Date Field',
          type: FieldType.Date,
          options: {
            formatting: {
              date: DateFormattingPreset.ISO,
              time: TimeFormatting.None,
              timeZone: 'UTC',
            },
          },
        },
        {
          name: 'Checkbox Field',
          type: FieldType.Checkbox,
        },
        {
          name: 'Single Select Field',
          type: FieldType.SingleSelect,
          options: {
            choices: [
              { id: 'opt1', name: 'Option 1', color: Colors.Red },
              { id: 'opt2', name: 'Option 2', color: Colors.Blue },
              { id: 'opt3', name: 'Option 3', color: Colors.Green },
            ],
          },
        },
        {
          name: 'Multiple Select Field',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { id: 'tag1', name: 'Tag 1', color: Colors.Red },
              { id: 'tag2', name: 'Tag 2', color: Colors.Blue },
              { id: 'tag3', name: 'Tag 3', color: Colors.Green },
            ],
          },
        },
        {
          name: 'Rating Field',
          type: FieldType.Rating,
          options: {
            icon: 'star',
            color: 'yellowBright',
            max: 5,
          },
        },
      ],
    });

    // Create link field
    linkField = await createField(mainTable.id, {
      name: 'Link Field',
      type: FieldType.Link,
      options: {
        foreignTableId: relatedTable.id,
        relationship: Relationship.ManyOne,
      },
    });

    // Get field IDs for formula references
    const numberFieldId = mainTable.fields.find((f) => f.name === 'Number Field')!.id;

    // Create formula fields
    const generatedFormulaField = await createField(mainTable.id, {
      name: 'Generated Formula',
      type: FieldType.Formula,
      options: {
        expression: `{${numberFieldId}} * 2`,
      },
    });

    const selectFormulaField = await createField(mainTable.id, {
      name: 'Select Formula',
      type: FieldType.Formula,
      options: {
        expression: `IF({${numberFieldId}} > 20, "High", "Low")`,
      },
    });

    // Update mainTable.fields to include the new fields
    mainTable.fields.push(linkField.data);
    mainTable.fields.push(generatedFormulaField.data);
    mainTable.fields.push(selectFormulaField.data);

    // Add test records to main table
    const records = [
      {
        fields: {
          'Text Field': 'Test Text 1',
          'Long Text Field': 'This is a long text content for testing',
          'Number Field': 10.5,
          'Date Field': '2024-01-15',
          'Checkbox Field': true,
          'Single Select Field': 'Option 1',
          'Multiple Select Field': ['Tag 1', 'Tag 2'],
          'Rating Field': 4,
          'Link Field': { id: relatedTable.records[0].id },
        },
      },
      {
        fields: {
          'Text Field': 'Test Text 2',
          'Long Text Field': 'Another long text for testing purposes',
          'Number Field': 25.75,
          'Date Field': '2024-02-20',
          'Checkbox Field': false,
          'Single Select Field': 'Option 2',
          'Multiple Select Field': ['Tag 2', 'Tag 3'],
          'Rating Field': 3,
          'Link Field': { id: relatedTable.records[1].id },
        },
      },
      {
        fields: {
          'Text Field': null,
          'Long Text Field': null,
          'Number Field': null,
          'Date Field': null,
          'Checkbox Field': null,
          'Single Select Field': null,
          'Multiple Select Field': null,
          'Rating Field': null,
          'Link Field': null,
        },
      },
    ];

    for (const record of records) {
      await createRecords(mainTable.id, { fieldKeyType: FieldKeyType.Name, records: [record] });
    }

    // No need to refresh table data, fields are already available
  });

  afterEach(async () => {
    // Clean up tables after each test
    if (mainTable?.id) {
      await permanentDeleteTable(baseId, mainTable.id);
    }
    if (relatedTable?.id) {
      await permanentDeleteTable(baseId, relatedTable.id);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function getFilterRecord(tableId: string, filter: IFilter) {
    return (
      await apiGetRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        filter: filter,
      })
    ).data;
  }

  const doTest = async (
    fieldName: string,
    operator: IOperator,
    queryValue: any,
    expectedLength: number,
    expectedRecordMatchers?: Array<Record<string, any>>
  ) => {
    const field = mainTable.fields.find((f) => f.name === fieldName);
    if (!field) {
      throw new Error(`Field ${fieldName} not found`);
    }

    const filter: IFilter = {
      filterSet: [
        {
          fieldId: field.id,
          value: queryValue,
          operator,
        },
      ],
      conjunction: and.value,
    };

    const { records } = await getFilterRecord(mainTable.id, filter);
    expect(records.length).toBe(expectedLength);

    // If expectedRecordMatchers provided, verify the content of returned records
    if (expectedRecordMatchers && expectedRecordMatchers.length > 0) {
      expectedRecordMatchers.forEach((matcher, index) => {
        expect(records[index]).toMatchObject(matcher);
      });
    }
  };

  // Verify mainTable has exactly 3 records
  test('should have exactly 3 records in mainTable', async () => {
    const { records } = await getFilterRecord(mainTable.id, { filterSet: [], conjunction: 'and' });
    expect(records.length).toBe(3);
  });

  describe('Text Field Filters', () => {
    const fieldName = 'Text Field';

    test('should filter with is operator', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, is.value, 'Test Text 1', 1, [
        { fields: expect.objectContaining({ [field!.id]: 'Test Text 1' }) },
      ]);
    });

    test('should filter with isNot operator', async () => {
      await doTest(fieldName, isNot.value, 'Test Text 1', 2);
    });

    test('should filter with contains operator', async () => {
      await doTest(fieldName, contains.value, 'Test', 2);
    });

    test('should filter with doesNotContain operator', async () => {
      await doTest(fieldName, doesNotContain.value, 'Test', 1);
    });

    test('should filter with isEmpty operator', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, isEmpty.value, null, 1, [
        { fields: expect.not.objectContaining({ [field!.id]: expect.anything() }) },
      ]);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });

    // Text field doesn't support isAnyOf and isNoneOf operators
    // Removed unsupported operators: isAnyOf, isNoneOf
  });

  describe('Long Text Field Filters', () => {
    const fieldName = 'Long Text Field';

    test('should filter with contains operator', async () => {
      await doTest(fieldName, contains.value, 'long text', 2);
    });

    test('should filter with doesNotContain operator', async () => {
      await doTest(fieldName, doesNotContain.value, 'testing', 1);
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });
  });

  describe('Number Field Filters', () => {
    const fieldName = 'Number Field';

    test('should filter with is operator', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, is.value, 10.5, 1, [
        { fields: expect.objectContaining({ [field!.id]: 10.5 }) },
      ]);
    });

    test('should filter with isNot operator', async () => {
      await doTest(fieldName, isNot.value, 10.5, 2);
    });

    test('should filter with isGreater operator', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, isGreater.value, 20, 1, [
        { fields: expect.objectContaining({ [field!.id]: expect.any(Number) }) },
      ]);
    });

    test('should filter with isGreaterEqual operator', async () => {
      await doTest(fieldName, isGreaterEqual.value, 10.5, 2);
    });

    test('should filter with isLess operator', async () => {
      await doTest(fieldName, isLess.value, 20, 1);
    });

    test('should filter with isLessEqual operator', async () => {
      await doTest(fieldName, isLessEqual.value, 25.75, 2);
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });

    // Number field doesn't support isAnyOf and isNoneOf operators
    // Removed unsupported operators: isAnyOf, isNoneOf
  });

  describe('Date Field Filters', () => {
    const fieldName = 'Date Field';

    test('should filter with is operator', async () => {
      await doTest(
        fieldName,
        is.value,
        {
          mode: 'exactDate',
          exactDate: '2024-01-15T00:00:00.000Z',
          timeZone: 'UTC',
        },
        1
      );
    });

    test('should filter with isNot operator', async () => {
      await doTest(
        fieldName,
        isNot.value,
        {
          mode: 'exactDate',
          exactDate: '2024-01-15T00:00:00.000Z',
          timeZone: 'UTC',
        },
        2
      );
    });

    test('should filter with isAfter operator', async () => {
      await doTest(
        fieldName,
        isAfter.value,
        {
          mode: 'exactDate',
          exactDate: '2024-01-31T00:00:00.000Z',
          timeZone: 'UTC',
        },
        1
      );
    });

    test('should filter with isBefore operator', async () => {
      await doTest(
        fieldName,
        isBefore.value,
        {
          mode: 'exactDate',
          exactDate: '2024-02-01T00:00:00.000Z',
          timeZone: 'UTC',
        },
        1
      );
    });

    test('should filter with isOnOrAfter operator', async () => {
      await doTest(
        fieldName,
        isOnOrAfter.value,
        {
          mode: 'exactDate',
          exactDate: '2024-01-15T00:00:00.000Z',
          timeZone: 'UTC',
        },
        2
      );
    });

    test('should filter with isOnOrBefore operator', async () => {
      await doTest(
        fieldName,
        isOnOrBefore.value,
        {
          mode: 'exactDate',
          exactDate: '2024-02-20T00:00:00.000Z',
          timeZone: 'UTC',
        },
        2
      );
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });
  });

  describe('Checkbox Field Filters', () => {
    const fieldName = 'Checkbox Field';

    test('should filter with is operator for true', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, is.value, true, 1, [
        { fields: expect.objectContaining({ [field!.id]: true }) },
      ]);
    });

    test('should filter with is operator for false', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, is.value, false, 2, [
        // Record with false value (may not be present in fields object)
        { fields: expect.not.objectContaining({ [field!.id]: true }) },
        // Record with null value (definitely not present in fields object)
        { fields: expect.not.objectContaining({ [field!.id]: expect.anything() }) },
      ]);
    });

    test('should filter with is operator for null', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      await doTest(fieldName, is.value, null, 2, [
        // Record with false value (may not be present in fields object)
        { fields: expect.not.objectContaining({ [field!.id]: true }) },
        // Record with null value (definitely not present in fields object)
        { fields: expect.not.objectContaining({ [field!.id]: expect.anything() }) },
      ]);
    });

    // Checkbox field only supports 'is' operator
    // Removed unsupported operators: isNot, isEmpty, isNotEmpty
  });

  describe('Single Select Field Filters', () => {
    const fieldName = 'Single Select Field';

    test('should filter with is operator', async () => {
      await doTest(fieldName, is.value, 'Option 1', 1);
    });

    test('should filter with isNot operator', async () => {
      await doTest(fieldName, isNot.value, 'Option 1', 2);
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });

    test('should filter with isAnyOf operator', async () => {
      await doTest(fieldName, isAnyOf.value, ['Option 1', 'Option 2'], 2);
    });

    test('should filter with isNoneOf operator', async () => {
      await doTest(fieldName, isNoneOf.value, ['Option 1'], 2);
    });
  });

  describe('Multiple Select Field Filters', () => {
    const fieldName = 'Multiple Select Field';

    test('should filter with hasAnyOf operator', async () => {
      await doTest(fieldName, hasAnyOf.value, ['Tag 1'], 1);
    });

    test('should filter with hasAllOf operator', async () => {
      await doTest(fieldName, hasAllOf.value, ['Tag 1', 'Tag 2'], 1);
    });

    test('should filter with hasNoneOf operator', async () => {
      await doTest(fieldName, hasNoneOf.value, ['Tag 1'], 2);
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });

    test('should filter with isExactly operator', async () => {
      await doTest(fieldName, isExactly.value, ['Tag 1', 'Tag 2'], 1);
    });

    test('should filter with isNotExactly operator', async () => {
      await doTest(fieldName, isNotExactly.value, ['Tag 1', 'Tag 2'], 2);
    });
  });

  describe('Rating Field Filters', () => {
    const fieldName = 'Rating Field';

    test('should filter with is operator', async () => {
      await doTest(fieldName, is.value, 4, 1);
    });

    test('should filter with isNot operator', async () => {
      await doTest(fieldName, isNot.value, 4, 2);
    });

    test('should filter with isGreater operator', async () => {
      await doTest(fieldName, isGreater.value, 3, 1);
    });

    test('should filter with isGreaterEqual operator', async () => {
      await doTest(fieldName, isGreaterEqual.value, 3, 2);
    });

    test('should filter with isLess operator', async () => {
      await doTest(fieldName, isLess.value, 4, 1);
    });

    test('should filter with isLessEqual operator', async () => {
      await doTest(fieldName, isLessEqual.value, 4, 2);
    });

    test('should filter with isEmpty operator', async () => {
      await doTest(fieldName, isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest(fieldName, isNotEmpty.value, null, 2);
    });
  });

  describe('Formula Field Filters', () => {
    let generatedFormulaField: any;
    let selectFormulaField: any;

    beforeEach(async () => {
      // Create a generated column formula (simple expression)
      generatedFormulaField = await createField(mainTable.id, {
        name: 'Generated Formula',
        type: FieldType.Formula,
        options: {
          expression: `{${mainTable.fields.find((f) => f.name === 'Number Field')!.id}} * 2`,
        },
      });

      // Create a select query formula (complex expression with functions)
      selectFormulaField = await createField(mainTable.id, {
        name: 'Select Formula',
        type: FieldType.Formula,
        options: {
          expression: `YEAR({${mainTable.fields.find((f) => f.name === 'Date Field')!.id}})`,
        },
      });

      // Add the new fields to mainTable
      mainTable.fields.push(generatedFormulaField.data, selectFormulaField.data);
    });

    describe('Generated Column Formula', () => {
      test('should filter with is operator', async () => {
        await doTest('Generated Formula', is.value, 21, 1); // 10.5 * 2 = 21
      });

      test('should filter with isGreater operator', async () => {
        await doTest('Generated Formula', isGreater.value, 30, 1); // 25.75 * 2 = 51.5
      });

      test('should filter with isLess operator', async () => {
        await doTest('Generated Formula', isLess.value, 30, 1); // 10.5 * 2 = 21
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Generated Formula', isEmpty.value, null, 1);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Generated Formula', isNotEmpty.value, null, 2);
      });
    });

    describe('Select Query Formula', () => {
      test('should filter with is operator', async () => {
        await doTest('Select Formula', is.value, '2024', 0);
      });

      test('should filter with isNot operator', async () => {
        await doTest('Select Formula', isNot.value, '2024', 3);
      });

      test('should filter with contains operator', async () => {
        await doTest('Select Formula', contains.value, '202', 0);
      });

      test('should filter with doesNotContain operator', async () => {
        await doTest('Select Formula', doesNotContain.value, '2024', 3);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Select Formula', isEmpty.value, null, 0);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Select Formula', isNotEmpty.value, null, 3);
      });
    });
  });

  describe('Link Field Filters', () => {
    test('should filter with isEmpty operator', async () => {
      await doTest('Link Field', isEmpty.value, null, 1);
    });

    test('should filter with isNotEmpty operator', async () => {
      await doTest('Link Field', isNotEmpty.value, null, 2);
    });
  });

  describe('Lookup Field Filters', () => {
    let lookupTextField: any;
    let lookupNumberField: any;
    let lookupDateField: any;
    let lookupCheckboxField: any;

    beforeEach(async () => {
      // Create lookup fields for different types
      lookupTextField = await createField(mainTable.id, {
        name: 'Lookup Text',
        type: FieldType.SingleLineText,
        isLookup: true,
        lookupOptions: {
          foreignTableId: relatedTable.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Text')!.id,
          linkFieldId: linkField.data.id,
        },
      });

      lookupNumberField = await createField(mainTable.id, {
        name: 'Lookup Number',
        type: FieldType.Number,
        isLookup: true,
        lookupOptions: {
          foreignTableId: relatedTable.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Number')!.id,
          linkFieldId: linkField.data.id,
        },
      });

      lookupDateField = await createField(mainTable.id, {
        name: 'Lookup Date',
        type: FieldType.Date,
        isLookup: true,
        lookupOptions: {
          foreignTableId: relatedTable.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Date')!.id,
          linkFieldId: linkField.data.id,
        },
      });

      lookupCheckboxField = await createField(mainTable.id, {
        name: 'Lookup Checkbox',
        type: FieldType.Checkbox,
        isLookup: true,
        lookupOptions: {
          foreignTableId: relatedTable.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Checkbox')!.id,
          linkFieldId: linkField.data.id,
        },
      });

      // Add Lookup fields to mainTable.fields for testing
      mainTable.fields.push(lookupTextField.data);
      mainTable.fields.push(lookupNumberField.data);
      mainTable.fields.push(lookupDateField.data);
      mainTable.fields.push(lookupCheckboxField.data);
    });

    describe('Lookup Text Field', () => {
      test('should filter with is operator', async () => {
        await doTest('Lookup Text', is.value, 'Related Item 1', 1);
      });

      test('should filter with contains operator', async () => {
        await doTest('Lookup Text', contains.value, 'Related', 2);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Lookup Text', isEmpty.value, null, 1);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Lookup Text', isNotEmpty.value, null, 2);
      });
    });

    describe('Lookup Number Field', () => {
      test('should filter with is operator', async () => {
        await doTest('Lookup Number', is.value, 100, 1);
      });

      test('should filter with isGreater operator', async () => {
        await doTest('Lookup Number', isGreater.value, 150, 1);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Lookup Number', isEmpty.value, null, 1);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Lookup Number', isNotEmpty.value, null, 2);
      });
    });

    describe('Lookup Date Field', () => {
      test('should filter with is operator', async () => {
        await doTest(
          'Lookup Date',
          is.value,
          {
            mode: 'exactDate',
            exactDate: '2024-01-01T00:00:00.000Z',
            timeZone: 'UTC',
          },
          1
        );
      });

      test('should filter with isAfter operator', async () => {
        await doTest(
          'Lookup Date',
          isAfter.value,
          {
            mode: 'exactDate',
            exactDate: '2024-01-15T00:00:00.000Z',
            timeZone: 'UTC',
          },
          1
        );
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Lookup Date', isEmpty.value, null, 1);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Lookup Date', isNotEmpty.value, null, 2);
      });
    });

    describe('Lookup Checkbox Field', () => {
      test('should filter with is operator for true', async () => {
        await doTest('Lookup Checkbox', is.value, true, 1);
      });

      test('should filter with is operator for false', async () => {
        await doTest('Lookup Checkbox', is.value, false, 2);
      });

      test('should filter with is operator for null', async () => {
        await doTest('Lookup Checkbox', is.value, null, 2);
      });

      // Lookup Checkbox field only supports 'is' operator
      // Removed unsupported operators: isEmpty, isNotEmpty
    });
  });

  describe('Rollup Field Filters', () => {
    let rollupSumField: any;
    let rollupCountField: any;
    let rollupMaxField: any;

    beforeEach(async () => {
      // Create rollup fields for different aggregation functions
      rollupSumField = await createField(mainTable.id, {
        name: 'Rollup Sum',
        type: FieldType.Rollup,
        options: {
          expression: 'sum({values})',
        },
        lookupOptions: {
          foreignTableId: relatedTable.id,
          linkFieldId: linkField.data.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Number')!.id,
        },
      });

      rollupCountField = await createField(mainTable.id, {
        name: 'Rollup Count',
        type: FieldType.Rollup,
        options: {
          expression: 'count({values})',
        },
        lookupOptions: {
          foreignTableId: relatedTable.id,
          linkFieldId: linkField.data.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Number')!.id,
        },
      });

      rollupMaxField = await createField(mainTable.id, {
        name: 'Rollup Max',
        type: FieldType.Rollup,
        options: {
          expression: 'max({values})',
        },
        lookupOptions: {
          foreignTableId: relatedTable.id,
          linkFieldId: linkField.data.id,
          lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Number')!.id,
        },
      });

      // Add Rollup fields to mainTable.fields for testing
      mainTable.fields.push(rollupSumField.data);
      mainTable.fields.push(rollupCountField.data);
      mainTable.fields.push(rollupMaxField.data);
    });

    describe('Rollup Sum Field', () => {
      test('should filter with is operator', async () => {
        await doTest('Rollup Sum', is.value, 100, 1); // Single related record
      });

      test('should filter with isGreater operator', async () => {
        await doTest('Rollup Sum', isGreater.value, 150, 1);
      });

      test('should filter with isLess operator', async () => {
        await doTest('Rollup Sum', isLess.value, 150, 2);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Rollup Sum', isEmpty.value, null, 0);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Rollup Sum', isNotEmpty.value, null, 3);
      });
    });

    describe('Rollup Count Field', () => {
      test('should filter with is operator', async () => {
        await doTest('Rollup Count', is.value, 1, 2); // Each linked record has 1 related record
      });

      test('should filter with isGreater operator', async () => {
        await doTest('Rollup Count', isGreater.value, 0, 2);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Rollup Count', isEmpty.value, null, 0);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Rollup Count', isNotEmpty.value, null, 3);
      });
    });

    describe('Rollup Max Field', () => {
      test('should filter with is operator', async () => {
        await doTest('Rollup Max', is.value, 100, 1);
      });

      test('should filter with isGreater operator', async () => {
        await doTest('Rollup Max', isGreater.value, 150, 1);
      });

      test('should filter with isLess operator', async () => {
        await doTest('Rollup Max', isLess.value, 150, 1);
      });

      test('should filter with isEmpty operator', async () => {
        await doTest('Rollup Max', isEmpty.value, null, 1);
      });

      test('should filter with isNotEmpty operator', async () => {
        await doTest('Rollup Max', isNotEmpty.value, null, 2);
      });
    });
  });

  describe('Complex Filter Scenarios', () => {
    test('should handle multiple filters with AND conjunction', async () => {
      const textField = mainTable.fields.find((f) => f.name === 'Text Field');
      const numberField = mainTable.fields.find((f) => f.name === 'Number Field');

      const filter: IFilter = {
        filterSet: [
          {
            fieldId: textField!.id,
            value: 'Test Text 1',
            operator: is.value,
          },
          {
            fieldId: numberField!.id,
            value: 10.5,
            operator: is.value,
          },
        ],
        conjunction: and.value,
      };

      const { records } = await getFilterRecord(mainTable.id, filter);
      expect(records.length).toBe(1);
    });

    test('should handle nested filter groups', async () => {
      const textField = mainTable.fields.find((f) => f.name === 'Text Field');
      const numberField = mainTable.fields.find((f) => f.name === 'Number Field');

      const filter: IFilter = {
        filterSet: [
          {
            fieldId: textField!.id,
            value: null,
            operator: isEmpty.value,
          },
          {
            conjunction: and.value,
            filterSet: [
              {
                fieldId: numberField!.id,
                value: 20,
                operator: isGreater.value,
              },
            ],
          },
        ],
        conjunction: 'or' as any,
      };

      const { records } = await getFilterRecord(mainTable.id, filter);
      expect(records.length).toBe(2); // Empty text OR number > 20
    });
  });
});
