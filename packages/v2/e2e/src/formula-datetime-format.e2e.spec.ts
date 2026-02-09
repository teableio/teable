/* eslint-disable @typescript-eslint/naming-convention */
/**
 * V2 Formula DATETIME_FORMAT E2E Tests
 *
 * Tests for DATETIME_FORMAT formula function with proper format token normalization.
 * These tests verify that format tokens like HH, mm, ss, A are correctly converted
 * to PostgreSQL TO_CHAR tokens (HH24, MI, SS, AM).
 *
 * Coverage:
 * 1. HH:mm:ss - 24-hour format with minutes and seconds
 * 2. Default format when format parameter is omitted
 * 3. hh:mm A - 12-hour format with AM/PM
 * 4. Month-Day - PostgreSQL textual tokens with FM prefix
 * 5. Error handling for invalid input
 */
import { describe, beforeAll, expect, it } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from './shared/globalTestContext';

describe('v2 http formula DATETIME_FORMAT (e2e)', () => {
  let ctx: SharedTestContext;
  const uniqueName = (prefix: string) =>
    `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  it('treats HH as 24-hour clock and mm as minutes', async () => {
    // Step 1: Create table with date field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-datetime-format-24h'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'event_time' },
      ],
      views: [{ type: 'grid' }],
    });

    const dateFieldId = table.fields.find((f) => f.name === 'event_time')?.id ?? '';

    // Step 2: Create formula field
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'formatted_24h',
        options: {
          expression: `DATETIME_FORMAT({${dateFieldId}}, 'YYYY-MM-DD HH:mm:ss')`,
        },
      },
    });

    const formulaFieldId = updatedTable.fields.find((f) => f.name === 'formatted_24h')?.id ?? '';

    // Step 3: Create record with date value
    const input = '2024-12-03T09:07:11.000Z';
    await ctx.createRecord(table.id, {
      [dateFieldId]: input,
    });

    // Step 4: Process outbox to compute formula
    await ctx.drainOutbox();

    // Step 5: Get record and check formula result
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(1);
    expect(records[0].fields[formulaFieldId]).toBe('2024-12-03 09:07:11');
  });

  it('defaults DATETIME_FORMAT to an ISO-like pattern when the format is omitted', async () => {
    // Step 1: Create table with date field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-datetime-format-default'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'handover_time' },
      ],
      views: [{ type: 'grid' }],
    });

    const dateFieldId = table.fields.find((f) => f.name === 'handover_time')?.id ?? '';

    // Step 2: Create formula field
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'handover_year',
        options: {
          expression: `LEFT(DATETIME_FORMAT({${dateFieldId}}), 4)`,
        },
      },
    });

    const formulaFieldId = updatedTable.fields.find((f) => f.name === 'handover_year')?.id ?? '';

    // Step 3: Create record with date value
    const input = '2024-10-10T16:00:00.000Z';
    await ctx.createRecord(table.id, {
      [dateFieldId]: input,
    });

    // Step 4: Process outbox to compute formula
    await ctx.drainOutbox();

    // Step 5: Get record and check formula result
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(1);
    expect(records[0].fields[formulaFieldId]).toBe('2024');
  });

  it('keeps hh with A as a 12-hour clock while mm stays minutes', async () => {
    // Step 1: Create table with date field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-datetime-format-12h'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'planned_time' },
      ],
      views: [{ type: 'grid' }],
    });

    const dateFieldId = table.fields.find((f) => f.name === 'planned_time')?.id ?? '';

    // Step 2: Create formula field
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'formatted_12h',
        options: {
          expression: `DATETIME_FORMAT({${dateFieldId}}, 'YYYY-MM-DD hh:mm A')`,
        },
      },
    });

    const formulaFieldId = updatedTable.fields.find((f) => f.name === 'formatted_12h')?.id ?? '';

    // Step 3: Create record with date value
    const input = '2024-05-06T15:04:05.000Z';
    await ctx.createRecord(table.id, {
      [dateFieldId]: input,
    });

    // Step 4: Process outbox to compute formula
    await ctx.drainOutbox();

    // Step 5: Get record and check formula result
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(1);
    expect(records[0].fields[formulaFieldId]).toBe('2024-05-06 03:04 PM');
  });

  it('supports Postgres month/day name specifiers without corrupting them', async () => {
    // Step 1: Create table with date field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-datetime-format-names'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'date', name: 'event_date' },
      ],
      views: [{ type: 'grid' }],
    });

    const dateFieldId = table.fields.find((f) => f.name === 'event_date')?.id ?? '';

    // Step 2: Create formula field
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'formatted_names',
        options: {
          expression: `DATETIME_FORMAT({${dateFieldId}}, 'YY-Month-Day')`,
        },
      },
    });

    const formulaFieldId = updatedTable.fields.find((f) => f.name === 'formatted_names')?.id ?? '';

    // Step 3: Create record with date value
    const input = '2025-11-27T00:00:00.000Z';
    await ctx.createRecord(table.id, {
      [dateFieldId]: input,
    });

    // Step 4: Process outbox to compute formula
    await ctx.drainOutbox();

    // Step 5: Get record and check formula result
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(1);
    expect(records[0].fields[formulaFieldId]).toBe('25-November-Thursday');
  });

  it('returns null instead of throwing when formatting non-datetime text', async () => {
    // Step 1: Create table with text field
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: uniqueName('formula-datetime-format-invalid'),
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'singleLineText', name: 'raw_text' },
      ],
      views: [{ type: 'grid' }],
    });

    const textFieldId = table.fields.find((f) => f.name === 'raw_text')?.id ?? '';

    // Step 2: Create formula field
    const updatedTable = await ctx.createField({
      baseId: ctx.baseId,
      tableId: table.id,
      field: {
        type: 'formula',
        name: 'formatted_invalid',
        options: {
          expression: `DATETIME_FORMAT({${textFieldId}}, 'YYYY-MM-DD HH:mm')`,
        },
      },
    });

    const formulaFieldId =
      updatedTable.fields.find((f) => f.name === 'formatted_invalid')?.id ?? '';

    // Step 3: Create record with text value
    await ctx.createRecord(table.id, {
      [textFieldId]: '2',
    });

    // Step 4: Process outbox to compute formula
    await ctx.drainOutbox();

    // Step 5: Get record and check formula result
    const records = await ctx.listRecords(table.id);
    expect(records).toHaveLength(1);
    expect(records[0].fields[formulaFieldId] ?? null).toBeNull();
  });
});
