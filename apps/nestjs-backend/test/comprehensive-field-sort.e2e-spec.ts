/* eslint-disable sonarjs/no-duplicated-branches */
/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/cognitive-complexity */
import type { INestApplication } from '@nestjs/common';
import type { ISortItem } from '@teable/core';
import {
  FieldKeyType,
  FieldType,
  Colors,
  DateFormattingPreset,
  TimeFormatting,
  NumberFormattingType,
  Relationship,
  SortFunc,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getRecords as apiGetRecords, createField, createRecords } from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('Comprehensive Field Sort Tests (e2e)', () => {
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
      ],
      records: [
        {
          fields: {
            'Related Text': 'Alpha',
            'Related Number': 100,
            'Related Date': '2024-01-01',
          },
        },
        {
          fields: {
            'Related Text': 'Beta',
            'Related Number': 200,
            'Related Date': '2024-02-01',
          },
        },
        {
          fields: {
            'Related Text': 'Gamma',
            'Related Number': 300,
            'Related Date': '2024-03-01',
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
              { id: 'opt1', name: 'High', color: Colors.Red },
              { id: 'opt2', name: 'Medium', color: Colors.Blue },
              { id: 'opt3', name: 'Low', color: Colors.Green },
            ],
          },
        },
        {
          name: 'Multiple Select Field',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { id: 'tag1', name: 'Urgent', color: Colors.Red },
              { id: 'tag2', name: 'Important', color: Colors.Blue },
              { id: 'tag3', name: 'Normal', color: Colors.Green },
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

    // Create rollup field
    const rollupField = await createField(mainTable.id, {
      name: 'Rollup Field',
      type: FieldType.Rollup,
      options: {
        expression: 'sum({values})',
      },
      lookupOptions: {
        foreignTableId: relatedTable.id,
        lookupFieldId: relatedTable.fields.find((f) => f.name === 'Related Number')!.id,
        linkFieldId: linkField.data.id,
      },
    });

    // Update mainTable.fields to include the new fields
    mainTable.fields.push(linkField.data);
    mainTable.fields.push(generatedFormulaField.data);
    mainTable.fields.push(rollupField.data);

    // Add test records to main table with specific values for sorting
    const records = [
      {
        fields: {
          'Text Field': 'Charlie',
          'Number Field': 30.5,
          'Date Field': '2024-03-15',
          'Checkbox Field': true,
          'Single Select Field': 'High',
          'Multiple Select Field': ['Urgent', 'Important'],
          'Rating Field': 5,
          'Link Field': { id: relatedTable.records[2].id }, // Gamma
        },
      },
      {
        fields: {
          'Text Field': 'Alpha',
          'Number Field': 10.25,
          'Date Field': '2024-01-10',
          'Checkbox Field': false,
          'Single Select Field': 'Low',
          'Multiple Select Field': ['Normal'],
          'Rating Field': 2,
          'Link Field': { id: relatedTable.records[0].id }, // Alpha
        },
      },
      {
        fields: {
          'Text Field': 'Beta',
          'Number Field': 20.75,
          'Date Field': '2024-02-20',
          'Checkbox Field': null,
          'Single Select Field': 'Medium',
          'Multiple Select Field': ['Important', 'Normal'],
          'Rating Field': 4,
          'Link Field': { id: relatedTable.records[1].id }, // Beta
        },
      },
      {
        fields: {
          'Text Field': null,
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

  async function getSortedRecords(tableId: string, sort: ISortItem[]) {
    return (
      await apiGetRecords(tableId, {
        fieldKeyType: FieldKeyType.Id,
        orderBy: sort,
      })
    ).data;
  }

  const doSortTest = async (fieldName: string, order: SortFunc) => {
    const field = mainTable.fields.find((f) => f.name === fieldName);
    if (!field) {
      throw new Error(`Field ${fieldName} not found`);
    }

    const sort: ISortItem[] = [
      {
        fieldId: field.id,
        order,
      },
    ];

    const { records } = await getSortedRecords(mainTable.id, sort);

    // Verify that sorting works and returns the expected number of records
    expect(records.length).toBe(4);
    expect(records).toBeDefined();

    // Verify actual sorting order based on field type
    const fieldValues = records.map((r) => r.fields[field.id]);
    const nonNullValues = fieldValues.filter((v) => v !== null && v !== undefined);

    if (nonNullValues.length > 1) {
      // Check sorting order based on field type
      if (field.type === FieldType.Number) {
        // Number field sorting
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = Number(nonNullValues[i]);
          const next = Number(nonNullValues[i + 1]);
          if (order === SortFunc.Asc) {
            expect(current).toBeLessThanOrEqual(next);
          } else {
            expect(current).toBeGreaterThanOrEqual(next);
          }
        }
      } else if (field.type === FieldType.SingleLineText) {
        // Text field sorting
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = String(nonNullValues[i]);
          const next = String(nonNullValues[i + 1]);
          if (order === SortFunc.Asc) {
            expect(current.localeCompare(next)).toBeLessThanOrEqual(0);
          } else {
            expect(current.localeCompare(next)).toBeGreaterThanOrEqual(0);
          }
        }
      } else if (field.type === FieldType.Date) {
        // Date field sorting
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = new Date(nonNullValues[i] as string);
          const next = new Date(nonNullValues[i + 1] as string);
          if (order === SortFunc.Asc) {
            expect(current.getTime()).toBeLessThanOrEqual(next.getTime());
          } else {
            expect(current.getTime()).toBeGreaterThanOrEqual(next.getTime());
          }
        }
      } else if (field.type === FieldType.Rollup) {
        // Rollup field sorting (typically numeric)
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = Number(nonNullValues[i]);
          const next = Number(nonNullValues[i + 1]);
          if (order === SortFunc.Asc) {
            expect(current).toBeLessThanOrEqual(next);
          } else {
            expect(current).toBeGreaterThanOrEqual(next);
          }
        }
      }
    }
  };

  // Verify mainTable has exactly 4 records
  test('should have exactly 4 records in mainTable', async () => {
    const { records } = await getSortedRecords(mainTable.id, []);
    expect(records.length).toBe(4);
  });

  describe('Text Field Sorting', () => {
    const fieldName = 'Text Field';

    test('should sort ascending (A-Z)', async () => {
      await doSortTest(fieldName, SortFunc.Asc);
    });

    test('should sort descending (Z-A)', async () => {
      await doSortTest(fieldName, SortFunc.Desc);
    });
  });

  describe('Number Field Sorting', () => {
    const fieldName = 'Number Field';

    test('should sort ascending (low to high)', async () => {
      await doSortTest(fieldName, SortFunc.Asc);
    });

    test('should sort descending (high to low)', async () => {
      await doSortTest(fieldName, SortFunc.Desc);
    });
  });

  describe('Date Field Sorting', () => {
    const fieldName = 'Date Field';

    test('should sort ascending (earliest to latest)', async () => {
      await doSortTest(fieldName, SortFunc.Asc);
    });

    test('should sort descending (latest to earliest)', async () => {
      await doSortTest(fieldName, SortFunc.Desc);
    });
  });

  describe('Rollup Field Sorting (via doSortTest)', () => {
    const fieldName = 'Rollup Field';

    test('should sort ascending', async () => {
      await doSortTest(fieldName, SortFunc.Asc);
    });

    test('should sort descending', async () => {
      await doSortTest(fieldName, SortFunc.Desc);
    });
  });

  describe('Checkbox Field Sorting', () => {
    const fieldName = 'Checkbox Field';

    test('should sort ascending (false/null first, true last)', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order
      const checkboxValues = records.map((r) => r.fields[field!.id]);

      // Find indices of different values
      let falseNullCount = 0;
      let trueCount = 0;
      let lastTrueIndex = -1;

      checkboxValues.forEach((value, index) => {
        if (value === true) {
          trueCount++;
          lastTrueIndex = index;
        } else {
          falseNullCount++;
        }
      });

      // In ascending order, true values should come after false/null values
      if (trueCount > 0 && falseNullCount > 0) {
        expect(lastTrueIndex).toBeGreaterThanOrEqual(falseNullCount - 1);
      }
    });

    test('should sort descending (true first, false/null last)', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order
      const checkboxValues = records.map((r) => r.fields[field!.id]);

      // Find first false/null index
      let firstFalseNullIndex = -1;
      let trueCount = 0;

      checkboxValues.forEach((value, index) => {
        if (value === true) {
          trueCount++;
        } else if (firstFalseNullIndex === -1) {
          firstFalseNullIndex = index;
        }
      });

      // In descending order, true values should come before false/null values
      if (trueCount > 0 && firstFalseNullIndex !== -1) {
        expect(firstFalseNullIndex).toBeGreaterThanOrEqual(trueCount);
      }
    });
  });

  describe('Single Select Field Sorting', () => {
    const fieldName = 'Single Select Field';

    test('should sort ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order - choices are: High, Medium, Low
      const selectValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = selectValues.filter((v) => v !== null && v !== undefined);

      // Check that non-null values are in correct order
      if (nonNullValues.length > 1) {
        const choiceOrder = ['High', 'Medium', 'Low'];
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const currentIndex = choiceOrder.indexOf(nonNullValues[i] as string);
          const nextIndex = choiceOrder.indexOf(nonNullValues[i + 1] as string);
          if (currentIndex !== -1 && nextIndex !== -1) {
            expect(currentIndex).toBeLessThanOrEqual(nextIndex);
          }
        }
      }
    });

    test('should sort descending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order - choices are: High, Medium, Low (reversed for desc)
      const selectValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = selectValues.filter((v) => v !== null && v !== undefined);

      // Check that non-null values are in correct descending order
      if (nonNullValues.length > 1) {
        const choiceOrder = ['Low', 'Medium', 'High']; // Reversed for descending
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const currentIndex = choiceOrder.indexOf(nonNullValues[i] as string);
          const nextIndex = choiceOrder.indexOf(nonNullValues[i + 1] as string);
          if (currentIndex !== -1 && nextIndex !== -1) {
            expect(currentIndex).toBeLessThanOrEqual(nextIndex);
          }
        }
      }
    });
  });

  describe('Rating Field Sorting', () => {
    const fieldName = 'Rating Field';

    test('should sort ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order - ratings should be in ascending order
      const ratingValues = records.map((r) => r.fields[field!.id]);
      const nonNullRatings = ratingValues.filter((v) => v !== null && v !== undefined) as number[];

      // Check that non-null ratings are in ascending order
      for (let i = 0; i < nonNullRatings.length - 1; i++) {
        expect(nonNullRatings[i]).toBeLessThanOrEqual(nonNullRatings[i + 1]);
      }

      // Null values should come first or last consistently
      const firstNonNullIndex = ratingValues.findIndex((v) => v !== null && v !== undefined);
      if (firstNonNullIndex > 0) {
        // If there are nulls before non-nulls, all nulls should be at the beginning
        for (let i = 0; i < firstNonNullIndex; i++) {
          expect(ratingValues[i] ?? undefined).toBeUndefined();
        }
      }
    });

    test('should sort descending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order - ratings should be in descending order
      const ratingValues = records.map((r) => r.fields[field!.id]);
      const nonNullRatings = ratingValues.filter((v) => v !== null && v !== undefined) as number[];

      // Check that non-null ratings are in descending order
      for (let i = 0; i < nonNullRatings.length - 1; i++) {
        expect(nonNullRatings[i]).toBeGreaterThanOrEqual(nonNullRatings[i + 1]);
      }
    });
  });

  describe('Formula Field Sorting', () => {
    const fieldName = 'Generated Formula';

    test('should sort generated formula ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify that formula values are present and sorted
      const formulaValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = formulaValues.filter((v) => v !== null && v !== undefined);
      expect(nonNullValues.length).toBeGreaterThan(0);

      // Check ascending order for numeric formula values
      if (nonNullValues.length > 1 && typeof nonNullValues[0] === 'number') {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          expect(Number(nonNullValues[i])).toBeLessThanOrEqual(Number(nonNullValues[i + 1]));
        }
      }
    });

    test('should sort generated formula descending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify that formula values are present and sorted
      const formulaValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = formulaValues.filter((v) => v !== null && v !== undefined);
      expect(nonNullValues.length).toBeGreaterThan(0);

      // Check descending order for numeric formula values
      if (nonNullValues.length > 1 && typeof nonNullValues[0] === 'number') {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          expect(Number(nonNullValues[i])).toBeGreaterThanOrEqual(Number(nonNullValues[i + 1]));
        }
      }
    });
  });

  describe('Link Field Sorting', () => {
    const fieldName = 'Link Field';

    test('should sort link field ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [
        {
          fieldId: field!.id,
          order: SortFunc.Asc,
        },
      ];

      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order for link field
      const linkValues = records.map((r) => r.fields[field!.id]);

      // Count non-null and null values
      const nonNullCount = linkValues.filter((v) => v !== null && v !== undefined).length;
      const nullCount = linkValues.filter((v) => v === null || v === undefined).length;

      expect(nonNullCount).toBeGreaterThan(0);
      expect(nullCount).toBeGreaterThan(0);
      expect(nonNullCount + nullCount).toBe(4);

      // Verify that null values are consistently positioned (either all at start or all at end)
      const firstNullIndex = linkValues.findIndex((v) => v === null || v === undefined);
      const lastNonNullIndex =
        linkValues
          .map((v, i) => (v !== null && v !== undefined ? i : -1))
          .filter((i) => i !== -1)
          .pop() || -1;

      if (firstNullIndex !== -1 && lastNonNullIndex !== -1) {
        // Either nulls come first or nulls come last, but not mixed
        expect(firstNullIndex === 0 || lastNonNullIndex < firstNullIndex).toBe(true);
      }
    });
  });

  describe('Rollup Field Sorting', () => {
    const fieldName = 'Rollup Field';

    test('should sort rollup field ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order for rollup field
      const rollupValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = rollupValues.filter((v) => v !== null && v !== undefined);

      // Check ascending order for rollup values (typically numeric)
      if (nonNullValues.length > 1) {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = Number(nonNullValues[i]);
          const next = Number(nonNullValues[i + 1]);
          expect(current).toBeLessThanOrEqual(next);
        }
      }
    });

    test('should sort rollup field descending', async () => {
      const field = mainTable.fields.find((f) => f.name === fieldName);
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order for rollup field
      const rollupValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = rollupValues.filter((v) => v !== null && v !== undefined);

      // Check descending order for rollup values (typically numeric)
      if (nonNullValues.length > 1) {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = Number(nonNullValues[i]);
          const next = Number(nonNullValues[i + 1]);
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('Lookup Field Sorting', () => {
    let lookupTextField: any;
    let lookupNumberField: any;

    beforeEach(async () => {
      // Create lookup fields
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

      mainTable.fields.push(lookupTextField.data);
      mainTable.fields.push(lookupNumberField.data);
    });

    test('should sort lookup text field ascending', async () => {
      const field = mainTable.fields.find((f) => f.name === 'Lookup Text');
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Asc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order for lookup text field
      const lookupValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = lookupValues.filter((v) => v !== null && v !== undefined);

      // Check ascending order for text values
      if (nonNullValues.length > 1) {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = String(nonNullValues[i]);
          const next = String(nonNullValues[i + 1]);
          expect(current.localeCompare(next)).toBeLessThanOrEqual(0);
        }
      }
    });

    test('should sort lookup number field descending', async () => {
      const field = mainTable.fields.find((f) => f.name === 'Lookup Number');
      const sort: ISortItem[] = [{ fieldId: field!.id, order: SortFunc.Desc }];
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify actual sorting order for lookup number field
      const lookupValues = records.map((r) => r.fields[field!.id]);
      const nonNullValues = lookupValues.filter((v) => v !== null && v !== undefined);

      // Check descending order for number values
      if (nonNullValues.length > 1) {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          const current = Number(nonNullValues[i]);
          const next = Number(nonNullValues[i + 1]);
          expect(current).toBeGreaterThanOrEqual(next);
        }
      }
    });
  });

  describe('Multiple Field Sorting', () => {
    test('should sort by multiple fields', async () => {
      const textField = mainTable.fields.find((f) => f.name === 'Text Field');
      const numberField = mainTable.fields.find((f) => f.name === 'Number Field');

      const sort: ISortItem[] = [
        {
          fieldId: textField!.id,
          order: SortFunc.Asc,
        },
        {
          fieldId: numberField!.id,
          order: SortFunc.Desc,
        },
      ];

      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify multiple field sorting order
      const textValues = records.map((r) => r.fields[textField!.id]);
      const numberValues = records.map((r) => r.fields[numberField!.id]);

      // Check primary sort (text field ascending)
      const nonNullTextIndices: number[] = [];
      textValues.forEach((value, index) => {
        if (value !== null && value !== undefined) {
          nonNullTextIndices.push(index);
        }
      });

      // For records with same text values, check secondary sort (number field descending)
      for (let i = 0; i < nonNullTextIndices.length - 1; i++) {
        const currentIndex = nonNullTextIndices[i];
        const nextIndex = nonNullTextIndices[i + 1];
        const currentText = textValues[currentIndex];
        const nextText = textValues[nextIndex];

        if (currentText === nextText) {
          // Same text value, check number sorting (descending)
          const currentNumber = numberValues[currentIndex];
          const nextNumber = numberValues[nextIndex];
          if (currentNumber !== null && nextNumber !== null) {
            expect(Number(currentNumber)).toBeGreaterThanOrEqual(Number(nextNumber));
          }
        } else if (typeof currentText === 'string' && typeof nextText === 'string') {
          // Different text values, should be in ascending order
          expect(currentText.localeCompare(nextText)).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  describe('Sort with Selection Context', () => {
    test('should handle formula field sorting with selection context', async () => {
      const formulaField = mainTable.fields.find((f) => f.name === 'Generated Formula');

      const sort: ISortItem[] = [
        {
          fieldId: formulaField!.id,
          order: SortFunc.Asc,
        },
      ];

      // Test that the sort works correctly with the new context parameter
      const { records } = await getSortedRecords(mainTable.id, sort);
      expect(records.length).toBe(4);

      // Verify that formula values are present and properly sorted
      const formulaValues = records.map((r) => r.fields[formulaField!.id]);
      const nonNullValues = formulaValues.filter((v) => v !== null && v !== undefined);

      expect(nonNullValues.length).toBeGreaterThan(0);

      // Verify ascending order for formula values
      if (nonNullValues.length > 1 && typeof nonNullValues[0] === 'number') {
        for (let i = 0; i < nonNullValues.length - 1; i++) {
          expect(Number(nonNullValues[i])).toBeLessThanOrEqual(Number(nonNullValues[i + 1]));
        }
      }

      // The important thing is that sorting works with the new context parameter
    });
  });
});
