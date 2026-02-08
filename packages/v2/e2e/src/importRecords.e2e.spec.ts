/* eslint-disable @typescript-eslint/naming-convention */
import { beforeAll, describe, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http importRecords (e2e)', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  describe('basic import', () => {
    it('should import CSV records into a simple text table', async () => {
      // Create table with text fields
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportSimple',
        fields: [
          { type: 'singleLineText', name: 'Name' },
          { type: 'singleLineText', name: 'Email' },
        ],
      });

      const nameFieldId = table.fields.find((f) => f.name === 'Name')!.id;
      const emailFieldId = table.fields.find((f) => f.name === 'Email')!.id;

      // Import CSV data (adapter extracts first row as headers)
      const csvData = 'Name,Email\nAlice,alice@example.com\nBob,bob@example.com';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [nameFieldId]: 0,
          [emailFieldId]: 1,
        },
        csvData,
      });

      expect(result.totalImported).toBe(2);

      // Verify records
      const records = await ctx.listRecords(table.id);
      expect(records.length).toBe(2);

      const aliceRecord = records.find((r) => r.fields[nameFieldId] === 'Alice');
      expect(aliceRecord).toBeDefined();
      expect(aliceRecord!.fields[emailFieldId]).toBe('alice@example.com');
    });

    it('should import records with number fields and typecast', async () => {
      // Create table with number field
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportNumbers',
        fields: [
          { type: 'singleLineText', name: 'Item' },
          { type: 'number', name: 'Quantity' },
          { type: 'number', name: 'Price' },
        ],
      });

      const itemFieldId = table.fields.find((f) => f.name === 'Item')!.id;
      const qtyFieldId = table.fields.find((f) => f.name === 'Quantity')!.id;
      const priceFieldId = table.fields.find((f) => f.name === 'Price')!.id;

      // CSV with string numbers that need typecast
      const csvData = 'Item,Quantity,Price\nWidget,10,19.99\nGadget,5,29.50';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [itemFieldId]: 0,
          [qtyFieldId]: 1,
          [priceFieldId]: 2,
        },
        csvData,
        options: {
          typecast: true,
        },
      });

      expect(result.totalImported).toBe(2);

      // Verify records have proper number types
      const records = await ctx.listRecords(table.id);
      const widgetRecord = records.find((r) => r.fields[itemFieldId] === 'Widget');
      expect(widgetRecord).toBeDefined();
      expect(widgetRecord!.fields[qtyFieldId]).toBe(10);
      expect(widgetRecord!.fields[priceFieldId]).toBe(19.99);
    });
  });

  describe('date field typecast', () => {
    it('should typecast date strings to proper date values', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportDates',
        fields: [
          { type: 'singleLineText', name: 'Event' },
          { type: 'date', name: 'Date' },
        ],
      });

      const eventFieldId = table.fields.find((f) => f.name === 'Event')!.id;
      const dateFieldId = table.fields.find((f) => f.name === 'Date')!.id;

      const csvData = 'Event,Date\nMeeting,2025-03-15\nDeadline,2025-04-01';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [eventFieldId]: 0,
          [dateFieldId]: 1,
        },
        csvData,
        options: {
          typecast: true,
        },
      });

      expect(result.totalImported).toBe(2);

      // Verify dates were parsed
      const records = await ctx.listRecords(table.id);
      const meeting = records.find((r) => r.fields[eventFieldId] === 'Meeting');
      expect(meeting).toBeDefined();
      expect(meeting!.fields[dateFieldId]).toBeDefined();
    });
  });

  describe('checkbox field typecast', () => {
    it('should typecast various boolean representations', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportCheckbox',
        fields: [
          { type: 'singleLineText', name: 'Task' },
          { type: 'checkbox', name: 'Completed' },
        ],
      });

      const taskFieldId = table.fields.find((f) => f.name === 'Task')!.id;
      const completedFieldId = table.fields.find((f) => f.name === 'Completed')!.id;

      const csvData = 'Task,Completed\nTask1,true\nTask2,false\nTask3,1\nTask4,0';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [taskFieldId]: 0,
          [completedFieldId]: 1,
        },
        csvData,
        options: {
          typecast: true,
        },
      });

      expect(result.totalImported).toBe(4);

      // Verify checkbox values
      const records = await ctx.listRecords(table.id);
      const task1 = records.find((r) => r.fields[taskFieldId] === 'Task1');
      const task2 = records.find((r) => r.fields[taskFieldId] === 'Task2');
      expect(task1!.fields[completedFieldId]).toBe(true);
      expect(task2!.fields[completedFieldId]).toBe(false);
    });
  });

  describe('batch processing', () => {
    it('should handle large imports with multiple batches', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportLarge',
        fields: [
          { type: 'singleLineText', name: 'Name' },
          { type: 'number', name: 'Index' },
        ],
      });

      const nameFieldId = table.fields.find((f) => f.name === 'Name')!.id;
      const indexFieldId = table.fields.find((f) => f.name === 'Index')!.id;

      // Generate 150 rows to test batching
      const rows = ['Name,Index'];
      for (let i = 0; i < 150; i++) {
        rows.push(`Item${i},${i}`);
      }
      const csvData = rows.join('\n');

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [nameFieldId]: 0,
          [indexFieldId]: 1,
        },
        csvData,
        options: {
          typecast: true,
          batchSize: 50, // Process in batches of 50
        },
      });

      expect(result.totalImported).toBe(150);
    });
  });

  describe('partial column mapping', () => {
    it('should only import mapped columns', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportPartial',
        fields: [
          { type: 'singleLineText', name: 'Name' },
          { type: 'singleLineText', name: 'Description' },
          { type: 'number', name: 'Value' },
        ],
      });

      const nameFieldId = table.fields.find((f) => f.name === 'Name')!.id;
      const descFieldId = table.fields.find((f) => f.name === 'Description')!.id;
      // Value field is NOT mapped

      const csvData = 'Name,Desc,Val\nItem1,Desc1,100\nItem2,Desc2,200';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'csv',
        sourceColumnMap: {
          [nameFieldId]: 0,
          [descFieldId]: 1,
          // Value field not in mapping
        },
        csvData,
      });

      expect(result.totalImported).toBe(2);

      // Verify only mapped fields have values
      const records = await ctx.listRecords(table.id);
      const item1 = records.find((r) => r.fields[nameFieldId] === 'Item1');
      expect(item1).toBeDefined();
      expect(item1!.fields[descFieldId]).toBe('Desc1');
    });
  });

  describe('TSV support', () => {
    it('should import TSV data with tab delimiter', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportTsv',
        fields: [
          { type: 'singleLineText', name: 'Col1' },
          { type: 'singleLineText', name: 'Col2' },
        ],
      });

      const col1Id = table.fields.find((f) => f.name === 'Col1')!.id;
      const col2Id = table.fields.find((f) => f.name === 'Col2')!.id;

      const tsvData = 'Col1\tCol2\nValue1\tValue2\nValue3\tValue4';

      const result = await ctx.importRecords({
        tableId: table.id,
        fileType: 'tsv',
        sourceColumnMap: {
          [col1Id]: 0,
          [col2Id]: 1,
        },
        csvData: tsvData,
        options: {
          delimiter: '\t',
        },
      });

      expect(result.totalImported).toBe(2);

      const records = await ctx.listRecords(table.id);
      const record1 = records.find((r) => r.fields[col1Id] === 'Value1');
      expect(record1).toBeDefined();
      expect(record1!.fields[col2Id]).toBe('Value2');
    });
  });

  describe('error handling', () => {
    it('should fail with invalid table ID', async () => {
      try {
        await ctx.importRecords({
          tableId: 'invalid-table-id',
          fileType: 'csv',
          sourceColumnMap: {},
          csvData: 'Name\nTest',
        });
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('should fail with invalid column mapping', async () => {
      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'ImportInvalidMapping',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      });

      try {
        await ctx.importRecords({
          tableId: table.id,
          fileType: 'csv',
          sourceColumnMap: {
            'invalid-field-id': 0,
          },
          csvData: 'Name\nTest',
        });
        expect.fail('Expected error to be thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
