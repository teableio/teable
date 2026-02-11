import { describe, it, expect, beforeAll } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('duplicateRecord', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('duplicates a record with basic field values', async () => {
    // Create a table with a text field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Duplicate Test Table',
      fields: [
        {
          name: 'Title',
          type: 'singleLineText',
          isPrimary: true,
        },
        {
          name: 'Number',
          type: 'number',
        },
      ],
    });

    const tableId = table.id;
    const titleFieldId = table.fields.find((f) => f.name === 'Title')!.id;
    const numberFieldId = table.fields.find((f) => f.name === 'Number')!.id;

    // Create a source record
    const sourceRecord = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Original Title',
      [numberFieldId]: 42,
    });

    // Duplicate the record
    const duplicatedRecord = await ctx.duplicateRecord(tableId, sourceRecord.id);

    // Verify the duplicated record has a different ID
    expect(duplicatedRecord.id).not.toBe(sourceRecord.id);

    // Verify the field values are copied
    expect(duplicatedRecord.fields[titleFieldId]).toBe('Original Title');
    expect(duplicatedRecord.fields[numberFieldId]).toBe(42);

    // Clean up
    await ctx.deleteTable(tableId);
  });

  it('duplicates a record and creates a new record in the table', async () => {
    // Create a table with a text field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Duplicate Count Test',
      fields: [
        {
          name: 'Name',
          type: 'singleLineText',
          isPrimary: true,
        },
      ],
    });

    const tableId = table.id;
    const nameFieldId = table.fields.find((f) => f.name === 'Name')!.id;

    // Create a source record
    const sourceRecord = await ctx.createRecord(tableId, {
      [nameFieldId]: 'Test Record',
    });

    // Get initial record count
    const initialRecords = await ctx.listRecords(tableId);
    expect(initialRecords.length).toBe(1);

    // Duplicate the record
    await ctx.duplicateRecord(tableId, sourceRecord.id);

    // Verify record count increased
    const finalRecords = await ctx.listRecords(tableId);
    expect(finalRecords.length).toBe(2);

    // Clean up
    await ctx.deleteTable(tableId);
  });

  it('does not copy null/empty field values', async () => {
    // Create a table with multiple fields
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Duplicate Null Test',
      fields: [
        {
          name: 'Title',
          type: 'singleLineText',
          isPrimary: true,
        },
        {
          name: 'Description',
          type: 'singleLineText',
        },
      ],
    });

    const tableId = table.id;
    const titleFieldId = table.fields.find((f) => f.name === 'Title')!.id;
    const descriptionFieldId = table.fields.find((f) => f.name === 'Description')!.id;

    // Create a source record with only title set
    const sourceRecord = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Has Title Only',
    });

    // Verify source record has null description
    expect(sourceRecord.fields[descriptionFieldId]).toBeUndefined();

    // Duplicate the record
    const duplicatedRecord = await ctx.duplicateRecord(tableId, sourceRecord.id);

    // Verify the duplicated record has the title but not the description
    expect(duplicatedRecord.fields[titleFieldId]).toBe('Has Title Only');
    expect(duplicatedRecord.fields[descriptionFieldId]).toBeUndefined();

    // Clean up
    await ctx.deleteTable(tableId);
  });

  it('duplicates a record with various field types', async () => {
    // Create a table with various field types
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Duplicate Various Types',
      fields: [
        {
          name: 'Text',
          type: 'singleLineText',
          isPrimary: true,
        },
        {
          name: 'Number',
          type: 'number',
        },
        {
          name: 'Checkbox',
          type: 'checkbox',
        },
        {
          name: 'Select',
          type: 'singleSelect',
          options: {
            choices: [
              { name: 'Option A', color: 'blue' },
              { name: 'Option B', color: 'green' },
            ],
          },
        },
      ],
    });

    const tableId = table.id;
    const textFieldId = table.fields.find((f) => f.name === 'Text')!.id;
    const numberFieldId = table.fields.find((f) => f.name === 'Number')!.id;
    const checkboxFieldId = table.fields.find((f) => f.name === 'Checkbox')!.id;
    const selectFieldId = table.fields.find((f) => f.name === 'Select')!.id;

    // Create a source record with all fields
    const sourceRecord = await ctx.createRecord(tableId, {
      [textFieldId]: 'Test Value',
      [numberFieldId]: 123.45,
      [checkboxFieldId]: true,
      [selectFieldId]: 'Option A',
    });

    // Duplicate the record
    const duplicatedRecord = await ctx.duplicateRecord(tableId, sourceRecord.id);

    // Verify all field values are copied
    expect(duplicatedRecord.fields[textFieldId]).toBe('Test Value');
    expect(duplicatedRecord.fields[numberFieldId]).toBe(123.45);
    expect(duplicatedRecord.fields[checkboxFieldId]).toBe(true);
    expect(duplicatedRecord.fields[selectFieldId]).toBe('Option A');

    // Clean up
    await ctx.deleteTable(tableId);
  });

  it('duplicates a record with date field value', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'Duplicate Date Field',
      fields: [
        {
          name: 'Title',
          type: 'singleLineText',
          isPrimary: true,
        },
        {
          name: 'Date',
          type: 'date',
        },
      ],
    });

    const tableId = table.id;
    const titleFieldId = table.fields.find((f) => f.name === 'Title')!.id;
    const dateFieldId = table.fields.find((f) => f.name === 'Date')!.id;

    const sourceRecord = await ctx.createRecord(tableId, {
      [titleFieldId]: 'Date Source',
      [dateFieldId]: '2026-02-05T16:17:50.000Z',
    });

    const duplicatedRecord = await ctx.duplicateRecord(tableId, sourceRecord.id);

    expect(duplicatedRecord.id).not.toBe(sourceRecord.id);
    expect(duplicatedRecord.fields[titleFieldId]).toBe('Date Source');
    expect(duplicatedRecord.fields[dateFieldId]).toBe(sourceRecord.fields[dateFieldId]);

    await ctx.deleteTable(tableId);
  });
});
