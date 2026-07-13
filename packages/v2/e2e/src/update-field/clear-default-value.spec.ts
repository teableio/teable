/**
 * T6107 — end-to-end: clear non-text field defaultValue via HTTP API.
 *
 * Flow for each type:
 * 1. createTable / createField with a default
 * 2. updateField options.defaultValue = null
 * 3. getTableById re-read and assert default is gone
 * 4. createRecord without the field and assert default is not applied
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

const Colors = {
  BlueBright: 'blueBright',
  GreenBright: 'greenBright',
} as const;

describe('e2e API: clear field defaultValue T6107', () => {
  let ctx: SharedTestContext;
  let tableId: string;
  let primaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const fieldOptions = (field: { options?: unknown } | undefined) =>
    (field?.options as Record<string, unknown> | undefined) ?? {};

  /** update → re-read table via GET and return the field dto */
  const clearDefaultAndReload = async (
    fieldId: string,
    updateFieldPayload: Record<string, unknown>
  ) => {
    await ctx.updateField({
      baseId: ctx.baseId,
      tableId,
      fieldId,
      field: updateFieldPayload,
    });

    const table = await ctx.getTableById(tableId);
    const field = table.fields.find((f) => f.id === fieldId);
    expect(field, `field ${fieldId} should exist after update`).toBeDefined();
    return field!;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();

    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: 'T6107 Clear DefaultValue E2E',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;
    const primary = table.fields.find((f) => f.isPrimary);
    if (!primary) throw new Error('expected primary field');
    primaryFieldId = primary.id;
  });

  afterAll(async () => {
    if (tableId) {
      await ctx.deleteTable(tableId).catch(() => undefined);
    }
  });

  test('number: clear defaultValue then new records omit it', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'number',
        id: fieldId,
        name: 'Amount',
        options: { defaultValue: 42 },
      },
    });

    // Sanity: default is applied before clear
    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'with-default' });
    expect(beforeClear.fields[fieldId]).toBe(42);

    const field = await clearDefaultAndReload(fieldId, { options: { defaultValue: null } });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'no-default' });
    expect(afterClear.fields[fieldId] == null).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });

  test('date: clear now auto-fill then new records omit it', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'date',
        id: fieldId,
        name: 'When',
        options: {
          formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
          defaultValue: 'now',
        },
      },
    });

    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'with-now' });
    expect(beforeClear.fields[fieldId]).toBeTruthy();

    const field = await clearDefaultAndReload(fieldId, {
      options: {
        formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
        defaultValue: null,
      },
    });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'no-now' });
    expect(afterClear.fields[fieldId] == null).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });

  test('checkbox: clear defaultValue then new records omit it', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'checkbox',
        id: fieldId,
        name: 'Done',
        options: { defaultValue: true },
      },
    });

    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'checked-by-default' });
    expect(beforeClear.fields[fieldId]).toBe(true);

    const field = await clearDefaultAndReload(fieldId, { options: { defaultValue: null } });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'unchecked' });
    expect(afterClear.fields[fieldId] == null || afterClear.fields[fieldId] === false).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });

  test('singleSelect: clear defaultValue then new records omit it', async () => {
    const fieldId = createFieldId();
    const choices = [
      { id: 'choA', name: 'A', color: Colors.BlueBright },
      { id: 'choB', name: 'B', color: Colors.GreenBright },
    ];
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'singleSelect',
        id: fieldId,
        name: 'Status',
        options: { choices, defaultValue: 'A' },
      },
    });

    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'with-status' });
    expect(beforeClear.fields[fieldId]).toBe('A');

    const field = await clearDefaultAndReload(fieldId, { options: { defaultValue: null } });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'no-status' });
    expect(afterClear.fields[fieldId] == null).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });

  test('multipleSelect: clear defaultValue then new records omit it', async () => {
    const fieldId = createFieldId();
    const choices = [
      { id: 'choA', name: 'A', color: Colors.BlueBright },
      { id: 'choB', name: 'B', color: Colors.GreenBright },
    ];
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'multipleSelect',
        id: fieldId,
        name: 'Tags',
        options: { choices, defaultValue: ['A', 'B'] },
      },
    });

    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'with-tags' });
    expect(beforeClear.fields[fieldId]).toEqual(['A', 'B']);

    const field = await clearDefaultAndReload(fieldId, { options: { defaultValue: null } });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'no-tags' });
    const value = afterClear.fields[fieldId];
    expect(value == null || (Array.isArray(value) && value.length === 0)).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });

  test('user: clear defaultValue then new records omit it', async () => {
    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        type: 'user',
        id: fieldId,
        name: 'Owner',
        options: { isMultiple: false, shouldNotify: false, defaultValue: 'me' },
      },
    });

    const beforeClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'with-owner' });
    expect(beforeClear.fields[fieldId]).toMatchObject({ id: ctx.testUser.id });

    const field = await clearDefaultAndReload(fieldId, {
      type: 'user',
      options: { isMultiple: false, shouldNotify: false, defaultValue: null },
    });
    expect(fieldOptions(field).defaultValue).toBeUndefined();

    const afterClear = await ctx.createRecord(tableId, { [primaryFieldId]: 'no-owner' });
    expect(afterClear.fields[fieldId] == null).toBe(true);

    await ctx.deleteField({ tableId, fieldId });
    await ctx.deleteRecords(tableId, [beforeClear.id, afterClear.id]);
  });
});
