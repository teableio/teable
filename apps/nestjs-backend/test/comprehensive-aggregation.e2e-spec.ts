/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable @typescript-eslint/naming-convention */
import type { INestApplication } from '@nestjs/common';
import type { IViewVo } from '@teable/core';
import {
  Colors,
  DateFormattingPreset,
  FieldType,
  NumberFormattingType,
  Relationship,
  StatisticsFunc,
  TimeFormatting,
} from '@teable/core';
import type { ITableFullVo } from '@teable/openapi';
import { getAggregation, createField, createRecords, getView } from '@teable/openapi';
import { createTable, permanentDeleteTable, initApp } from './utils/init-app';

describe('Comprehensive Aggregation Tests (e2e)', () => {
  let app: INestApplication;
  const baseId = globalThis.testConfig.baseId;
  let mainTable: ITableFullVo;
  let relatedTable: ITableFullVo;
  let linkField: any;

  beforeAll(async () => {
    const appCtx = await initApp();
    app = appCtx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
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
      ],
      records: [
        { fields: { 'Related Text': 'Related Item 1', 'Related Number': 100 } },
        { fields: { 'Related Text': 'Related Item 2', 'Related Number': 200 } },
        { fields: { 'Related Text': 'Related Item 3', 'Related Number': 300 } },
      ],
    });

    // Create main table with comprehensive field types
    mainTable = await createTable(baseId, {
      name: 'Comprehensive Aggregation Test Table',
      records: [], // 不创建默认记录，我们会手动创建
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
              timeZone: 'Asia/Singapore',
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
              { id: 'opt1', name: 'Option 1', color: Colors.Blue },
              { id: 'opt2', name: 'Option 2', color: Colors.Green },
              { id: 'opt3', name: 'Option 3', color: Colors.Red },
            ],
          },
        },
        {
          name: 'Multiple Select Field',
          type: FieldType.MultipleSelect,
          options: {
            choices: [
              { id: 'tag1', name: 'Tag 1', color: Colors.Cyan },
              { id: 'tag2', name: 'Tag 2', color: Colors.Yellow },
              { id: 'tag3', name: 'Tag 3', color: Colors.Purple },
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
        {
          name: 'User Field',
          type: FieldType.User,
        },
        {
          name: 'Multiple User Field',
          type: FieldType.User,
          options: {
            isMultiple: true,
            shouldNotify: false,
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

    // Add comprehensive test records to main table
    const testRecords = [
      // Record 1: Complete data
      {
        fields: {
          'Text Field': 'Sample Text A',
          'Long Text Field': 'This is a long text content for comprehensive testing',
          'Number Field': 100.5,
          'Date Field': '2024-01-15',
          'Checkbox Field': true,
          'Single Select Field': 'Option 1',
          'Multiple Select Field': ['Tag 1', 'Tag 2'],
          'Rating Field': 5,
          'User Field': { id: globalThis.testConfig.userId, title: 'Test User' },
          'Multiple User Field': [{ id: globalThis.testConfig.userId, title: 'Test User' }],
          'Link Field': { id: relatedTable.records[0].id },
        },
      },
      // Record 2: Partial data
      {
        fields: {
          'Text Field': 'Sample Text B',
          'Number Field': 250.75,
          'Date Field': '2024-02-20',
          'Checkbox Field': false,
          'Single Select Field': 'Option 2',
          'Multiple Select Field': ['Tag 2', 'Tag 3'],
          'Rating Field': 3,
          'Link Field': { id: relatedTable.records[1].id },
        },
      },
      // Record 3: Different values
      {
        fields: {
          'Text Field': 'Sample Text C',
          'Long Text Field': 'Another long text for testing purposes',
          'Number Field': 75.25,
          'Date Field': '2024-03-10',
          'Checkbox Field': true,
          'Single Select Field': 'Option 1',
          'Rating Field': 4,
          'User Field': { id: globalThis.testConfig.userId, title: 'Test User' },
          'Link Field': { id: relatedTable.records[2].id },
        },
      },
      // Record 4: Minimal data
      {
        fields: {
          'Text Field': 'Sample Text D',
          'Number Field': 0,
          'Checkbox Field': false,
          'Rating Field': 1,
        },
      },
      // Record 5: Empty/null values
      {
        fields: {
          'Number Field': 500,
          'Date Field': '2024-04-05',
          'Checkbox Field': true,
          'Rating Field': 2,
        },
      },
      // Record 6: Duplicate text for unique testing
      {
        fields: {
          'Text Field': 'Sample Text A', // Duplicate
          'Number Field': 150,
          'Single Select Field': 'Option 3',
          'Rating Field': 5,
        },
      },
    ];

    await createRecords(mainTable.id, { records: testRecords });

    // Refresh table data to get updated records
    const updatedTable = await createTable(baseId, { name: 'temp' });
    await permanentDeleteTable(baseId, updatedTable.id);
  });

  afterEach(async () => {
    if (mainTable?.id) {
      await permanentDeleteTable(baseId, mainTable.id);
    }
    if (relatedTable?.id) {
      await permanentDeleteTable(baseId, relatedTable.id);
    }
  });

  // Helper function to get aggregation results
  async function getAggregationResult(
    tableId: string,
    viewId: string,
    fieldId: string,
    statisticFunc: StatisticsFunc
  ) {
    const result = await getAggregation(tableId, {
      viewId,
      field: { [statisticFunc]: [fieldId] },
    });
    return result.data;
  }

  // Helper function to verify column meta
  async function verifyColumnMeta(tableId: string, viewId: string) {
    const view: IViewVo = (await getView(tableId, viewId)).data;
    expect(view.columnMeta).toBeDefined();
    return view;
  }

  describe('Column Meta Verification', () => {
    test('should have correct column metadata structure', async () => {
      const view = await verifyColumnMeta(mainTable.id, mainTable.views[0].id);

      // Verify that all fields have column metadata
      const fieldIds = mainTable.fields.map((f) => f.id);
      fieldIds.forEach((fieldId) => {
        expect(view.columnMeta[fieldId]).toBeDefined();
        expect(view.columnMeta[fieldId].order).toBeDefined();
      });
    });
  });

  describe('Text Field Aggregation', () => {
    let textFieldId: string;

    beforeEach(() => {
      textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.Count
      );

      expect(result.aggregations).toBeDefined();
      expect(result.aggregations!.length).toBe(1);

      const aggregation = result.aggregations![0];
      expect(aggregation.fieldId).toBe(textFieldId);
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6); // Total records
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(1); // One record with empty text field
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(5); // Five records with text field filled
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(4); // Four unique text values (one duplicate)
    });

    test('should calculate percentEmpty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.PercentEmpty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentEmpty);
      expect(aggregation.total?.value).toBeCloseTo(16.67, 1); // 1/6 * 100
    });

    test('should calculate percentFilled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.PercentFilled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentFilled);
      expect(aggregation.total?.value).toBeCloseTo(83.33, 1); // 5/6 * 100
    });

    test('should calculate percentUnique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.PercentUnique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentUnique);
      expect(aggregation.total?.value).toBeCloseTo(66.67, 1); // 4/6 * 100
    });
  });

  describe('Number Field Aggregation', () => {
    let numberFieldId: string;

    beforeEach(() => {
      numberFieldId = mainTable.fields.find((f) => f.name === 'Number Field')!.id;
    });

    test('should calculate sum correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Sum
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Sum);
      // Sum: 100.50 + 250.75 + 75.25 + 0 + 500 + 150 = 1076.50
      expect(aggregation.total?.value).toBeCloseTo(1076.5, 2);
    });

    test('should calculate average correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Average
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Average);
      // Average: 1076.50 / 6 = 179.42
      expect(aggregation.total?.value).toBeCloseTo(179.42, 2);
    });

    test('should calculate min correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Min
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Min);
      expect(aggregation.total?.value).toBe(0);
    });

    test('should calculate max correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Max
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Max);
      expect(aggregation.total?.value).toBe(500);
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(0); // All records have number values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        numberFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(6); // All number values are unique
    });
  });

  describe('Date Field Aggregation', () => {
    let dateFieldId: string;

    beforeEach(() => {
      dateFieldId = mainTable.fields.find((f) => f.name === 'Date Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(2); // Two records without dates
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(4); // Four records with dates
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(4); // All date values are unique
    });

    test('should calculate earliestDate correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.EarliestDate
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.EarliestDate);
      expect(aggregation.total?.value).toBe('2024-01-14T16:00:00.000Z'); // Adjusted for timezone
    });

    test('should calculate latestDate correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.LatestDate
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.LatestDate);
      expect(aggregation.total?.value).toBe('2024-04-04T16:00:00.000Z'); // Adjusted for timezone
    });

    test('should calculate dateRangeOfDays correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.DateRangeOfDays
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.DateRangeOfDays);
      // From 2024-01-15 to 2024-04-05 = 81 days
      expect(aggregation.total?.value).toBe(81);
    });

    test('should calculate dateRangeOfMonths correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        dateFieldId,
        StatisticsFunc.DateRangeOfMonths
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.DateRangeOfMonths);
      // From 2024-01-14 to 2024-04-04 = approximately 2 months (adjusted for timezone)
      expect(aggregation.total?.value).toBe(2);
    });
  });

  describe('Checkbox Field Aggregation', () => {
    let checkboxFieldId: string;

    beforeEach(() => {
      checkboxFieldId = mainTable.fields.find((f) => f.name === 'Checkbox Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        checkboxFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate checked correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        checkboxFieldId,
        StatisticsFunc.Checked
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Checked);
      expect(aggregation.total?.value).toBe(3); // Three records with checkbox checked
    });

    test('should calculate unChecked correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        checkboxFieldId,
        StatisticsFunc.UnChecked
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.UnChecked);
      expect(aggregation.total?.value).toBe(3); // Three records with checkbox unchecked
    });

    test('should calculate percentChecked correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        checkboxFieldId,
        StatisticsFunc.PercentChecked
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentChecked);
      expect(aggregation.total?.value).toBeCloseTo(50, 1); // 3/6 * 100
    });

    test('should calculate percentUnChecked correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        checkboxFieldId,
        StatisticsFunc.PercentUnChecked
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentUnChecked);
      expect(aggregation.total?.value).toBeCloseTo(50, 1); // 3/6 * 100
    });
  });

  describe('Single Select Field Aggregation', () => {
    let singleSelectFieldId: string;

    beforeEach(() => {
      singleSelectFieldId = mainTable.fields.find((f) => f.name === 'Single Select Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(2); // Two records without single select values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(4); // Four records with single select values
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(3); // Three unique select options
    });

    test('should calculate percentEmpty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.PercentEmpty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentEmpty);
      expect(aggregation.total?.value).toBeCloseTo(33.33, 1); // 2/6 * 100
    });

    test('should calculate percentFilled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.PercentFilled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentFilled);
      expect(aggregation.total?.value).toBeCloseTo(66.67, 1); // 4/6 * 100
    });

    test('should calculate percentUnique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        singleSelectFieldId,
        StatisticsFunc.PercentUnique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentUnique);
      expect(aggregation.total?.value).toBeCloseTo(50, 1); // 3/6 * 100
    });
  });

  describe('Multiple Select Field Aggregation', () => {
    let multipleSelectFieldId: string;

    beforeEach(() => {
      multipleSelectFieldId = mainTable.fields.find((f) => f.name === 'Multiple Select Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleSelectFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleSelectFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(4); // Four records without multiple select values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleSelectFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(2); // Two records with multiple select values
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleSelectFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(3); // Three unique tags: Tag 1, Tag 2, Tag 3
    });
  });

  describe('Rating Field Aggregation', () => {
    let ratingFieldId: string;

    beforeEach(() => {
      ratingFieldId = mainTable.fields.find((f) => f.name === 'Rating Field')!.id;
    });

    test('should calculate sum correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        ratingFieldId,
        StatisticsFunc.Sum
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Sum);
      // Sum: 5 + 3 + 4 + 1 + 2 + 5 = 20
      expect(aggregation.total?.value).toBe(20);
    });

    test('should calculate average correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        ratingFieldId,
        StatisticsFunc.Average
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Average);
      // Average: 20 / 6 = 3.33
      expect(aggregation.total?.value).toBeCloseTo(3.33, 2);
    });

    test('should calculate min correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        ratingFieldId,
        StatisticsFunc.Min
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Min);
      expect(aggregation.total?.value).toBe(1);
    });

    test('should calculate max correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        ratingFieldId,
        StatisticsFunc.Max
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Max);
      expect(aggregation.total?.value).toBe(5);
    });
  });

  describe('User Field Aggregation', () => {
    let userFieldId: string;

    beforeEach(() => {
      userFieldId = mainTable.fields.find((f) => f.name === 'User Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        userFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        userFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(4); // Four records without user values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        userFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(2); // Two records with user values
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        userFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(1); // One unique user (we only use globalThis.testConfig.userId)
    });
  });

  describe('Multiple User Field Aggregation', () => {
    let multipleUserFieldId: string;

    beforeEach(() => {
      multipleUserFieldId = mainTable.fields.find((f) => f.name === 'Multiple User Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleUserFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleUserFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(5); // Five records without multiple user values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        multipleUserFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(1); // One record with multiple user values
    });
  });

  describe('Link Field Aggregation', () => {
    let linkFieldId: string;

    beforeEach(() => {
      linkFieldId = linkField.data.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        linkFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        linkFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(3); // Three records without link values
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        linkFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(3); // Three records with link values
    });

    test('should calculate percentEmpty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        linkFieldId,
        StatisticsFunc.PercentEmpty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentEmpty);
      expect(aggregation.total?.value).toBeCloseTo(50, 1); // 3/6 * 100
    });

    test('should calculate percentFilled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        linkFieldId,
        StatisticsFunc.PercentFilled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.PercentFilled);
      expect(aggregation.total?.value).toBeCloseTo(50, 1); // 3/6 * 100
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid field ID', async () => {
      await expect(
        getAggregationResult(
          mainTable.id,
          mainTable.views[0].id,
          'invalid-field-id',
          StatisticsFunc.Count
        )
      ).rejects.toThrow();
    });

    test('should handle unsupported aggregation function for field type', async () => {
      const textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;

      // Text fields don't support Sum aggregation
      await expect(
        getAggregationResult(mainTable.id, mainTable.views[0].id, textFieldId, StatisticsFunc.Sum)
      ).rejects.toThrow();
    });

    test('should handle invalid table ID', async () => {
      const textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;

      await expect(
        getAggregationResult(
          'invalid-table-id',
          mainTable.views[0].id,
          textFieldId,
          StatisticsFunc.Count
        )
      ).rejects.toThrow();
    });

    test('should handle invalid view ID', async () => {
      const textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;

      await expect(
        getAggregationResult(mainTable.id, 'invalid-view-id', textFieldId, StatisticsFunc.Count)
      ).rejects.toThrow();
    });
  });

  describe('Complex Aggregation Scenarios', () => {
    test('should handle multiple field aggregations in single request', async () => {
      const textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;
      const numberFieldId = mainTable.fields.find((f) => f.name === 'Number Field')!.id;

      const result = await getAggregation(mainTable.id, {
        viewId: mainTable.views[0].id,
        field: {
          [StatisticsFunc.Count]: [textFieldId], // Text field uses count
          [StatisticsFunc.Sum]: [numberFieldId], // Number field uses sum
        },
      });

      expect(result.data.aggregations).toBeDefined();
      expect(result.data.aggregations!.length).toBe(2);

      // Find text field aggregation
      const textAggregation = result.data.aggregations!.find((a) => a.fieldId === textFieldId);
      expect(textAggregation?.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(textAggregation?.total?.value).toBe(6);

      // Find number field aggregation
      const numberAggregation = result.data.aggregations!.find((a) => a.fieldId === numberFieldId);
      expect(numberAggregation?.total?.aggFunc).toBe(StatisticsFunc.Sum);
      expect(numberAggregation?.total?.value).toBeCloseTo(1076.5, 2);
    });

    test('should verify API response format consistency', async () => {
      const textFieldId = mainTable.fields.find((f) => f.name === 'Text Field')!.id;

      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        textFieldId,
        StatisticsFunc.Count
      );

      // Verify response structure
      expect(result).toHaveProperty('aggregations');
      expect(Array.isArray(result.aggregations)).toBe(true);
      expect(result.aggregations!.length).toBeGreaterThan(0);

      const aggregation = result.aggregations![0];
      expect(aggregation).toHaveProperty('fieldId');
      expect(aggregation).toHaveProperty('total');
      expect(aggregation.total).toHaveProperty('aggFunc');
      expect(aggregation.total).toHaveProperty('value');

      // Verify field ID format
      expect(aggregation.fieldId).toMatch(/^fld/);
      expect(typeof aggregation.total?.value).toBe('number');
    });

    test('should handle empty table aggregations', async () => {
      // Create a new empty table for this test
      const emptyTable = await createTable(baseId, {
        name: 'Empty Table',
        fields: [
          {
            name: 'Empty Text Field',
            type: FieldType.SingleLineText,
          },
        ],
        records: [], // Explicitly specify empty records array
      });

      try {
        const textFieldId = emptyTable.fields.find((f) => f.name === 'Empty Text Field')!.id;

        const result = await getAggregationResult(
          emptyTable.id,
          emptyTable.views[0].id,
          textFieldId,
          StatisticsFunc.Count
        );

        const aggregation = result.aggregations![0];
        expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
        expect(aggregation.total?.value).toBe(0);
      } finally {
        await permanentDeleteTable(baseId, emptyTable.id);
      }
    });
  });

  describe('Long Text Field Aggregation', () => {
    let longTextFieldId: string;

    beforeEach(() => {
      longTextFieldId = mainTable.fields.find((f) => f.name === 'Long Text Field')!.id;
    });

    test('should calculate count correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        longTextFieldId,
        StatisticsFunc.Count
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Count);
      expect(aggregation.total?.value).toBe(6);
    });

    test('should calculate empty correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        longTextFieldId,
        StatisticsFunc.Empty
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Empty);
      expect(aggregation.total?.value).toBe(4); // Four records without long text
    });

    test('should calculate filled correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        longTextFieldId,
        StatisticsFunc.Filled
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Filled);
      expect(aggregation.total?.value).toBe(2); // Two records with long text
    });

    test('should calculate unique correctly', async () => {
      const result = await getAggregationResult(
        mainTable.id,
        mainTable.views[0].id,
        longTextFieldId,
        StatisticsFunc.Unique
      );

      const aggregation = result.aggregations![0];
      expect(aggregation.total?.aggFunc).toBe(StatisticsFunc.Unique);
      expect(aggregation.total?.value).toBe(2); // Two unique long text values
    });
  });
});
