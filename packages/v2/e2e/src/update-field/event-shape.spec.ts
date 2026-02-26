/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

type UpdateFieldResponseData = {
  table: {
    id: string;
    fields: Array<{ id: string; name: string; type: string }>;
  };
  events: Array<{
    name: string;
    occurredAt: string;
    fieldId?: string;
    updatedProperties?: string[];
    changes?: Record<
      string,
      {
        oldValue: unknown;
        newValue: unknown;
      }
    >;
  }>;
};

describe('update-field: event shape', () => {
  let ctx: SharedTestContext;
  let tableId: string | undefined;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const assertBaseEventShape = (events: UpdateFieldResponseData['events']) => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(typeof event.name).toBe('string');
      expect(event.name.length).toBeGreaterThan(0);
      expect(typeof event.occurredAt).toBe('string');
      expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
    }
  };

  const updateFieldRaw = async (payload: {
    tableId: string;
    fieldId: string;
    field: Record<string, unknown>;
  }): Promise<UpdateFieldResponseData> => {
    const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`updateField failed: ${text}`);
    }

    const rawBody = await response.json();
    const parsed = updateFieldOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse updateField response');
    }

    return parsed.data.data as UpdateFieldResponseData;
  };

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  afterEach(async () => {
    if (!tableId) return;
    try {
      await ctx.drainOutbox();
      await ctx.deleteTable(tableId);
    } catch {}
    tableId = undefined;
  });

  test('returns fieldId and updatedProperties for name update event', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `update-field-event-name-${Date.now()}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;

    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { id: fieldId, type: 'number', name: 'Score' },
    });

    const result = await updateFieldRaw({
      tableId,
      fieldId,
      field: { name: 'Final Score' },
    });

    assertBaseEventShape(result.events);

    const fieldUpdated = result.events.find((event) => event.name === 'FieldUpdated');
    expect(fieldUpdated).toBeDefined();
    expect(fieldUpdated?.fieldId).toBe(fieldId);
    expect(fieldUpdated?.updatedProperties).toContain('name');
    expect(fieldUpdated?.changes?.name).toEqual({ oldValue: 'Score', newValue: 'Final Score' });
  });

  test('returns options update shape for singleSelect option changes', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `update-field-event-options-${Date.now()}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;

    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: {
        id: fieldId,
        type: 'singleSelect',
        name: 'Status',
        options: {
          choices: [
            { id: 'opt_todo', name: 'Todo', color: 'blue' },
            { id: 'opt_done', name: 'Done', color: 'green' },
          ],
        },
      },
    });

    const result = await updateFieldRaw({
      tableId,
      fieldId,
      field: {
        options: {
          choices: [
            { id: 'opt_todo', name: 'Todo Updated', color: 'blue' },
            { id: 'opt_done', name: 'Done', color: 'green' },
          ],
        },
      },
    });

    assertBaseEventShape(result.events);

    const fieldUpdated = result.events.find((event) => event.name === 'FieldUpdated');
    expect(fieldUpdated).toBeDefined();
    expect(fieldUpdated?.fieldId).toBe(fieldId);
    expect(fieldUpdated?.updatedProperties).toContain('options');
    expect(fieldUpdated?.changes?.options).toBeDefined();
    expect(Array.isArray(fieldUpdated?.changes?.options.oldValue)).toBe(true);
    expect(Array.isArray(fieldUpdated?.changes?.options.newValue)).toBe(true);
  });

  test('returns type conversion updateProperties and fieldId', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `update-field-event-type-${Date.now()}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;

    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { id: fieldId, type: 'singleLineText', name: 'Amount Text' },
    });

    await ctx.createRecords(tableId, [
      { fields: { [fieldId]: '123' } },
      { fields: { [fieldId]: '456' } },
    ]);

    const result = await updateFieldRaw({
      tableId,
      fieldId,
      field: { type: 'number' },
    });

    assertBaseEventShape(result.events);

    const fieldUpdated = result.events.find((event) => event.name === 'FieldUpdated');
    expect(fieldUpdated).toBeDefined();
    expect(fieldUpdated?.fieldId).toBe(fieldId);
    expect(fieldUpdated?.updatedProperties).toContain('type');
    expect(fieldUpdated?.changes?.type).toEqual({
      oldValue: 'singleLineText',
      newValue: 'number',
    });
  });

  test('keeps optional event fields shape for text to singleSelect conversion', async () => {
    const table = await ctx.createTable({
      baseId: ctx.baseId,
      name: `update-field-event-options-added-${Date.now()}`,
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });
    tableId = table.id;

    const fieldId = createFieldId();
    await ctx.createField({
      baseId: ctx.baseId,
      tableId,
      field: { id: fieldId, type: 'singleLineText', name: 'Tag Text' },
    });

    await ctx.createRecords(tableId, [
      { fields: { [fieldId]: 'Alpha' } },
      { fields: { [fieldId]: 'Beta' } },
    ]);

    const result = await updateFieldRaw({
      tableId,
      fieldId,
      field: { type: 'singleSelect' },
    });

    assertBaseEventShape(result.events);

    const fieldUpdated = result.events.find((event) => event.name === 'FieldUpdated');
    expect(fieldUpdated).toBeDefined();
    expect(fieldUpdated?.fieldId).toBe(fieldId);
    expect(fieldUpdated?.updatedProperties).toContain('type');
    expect(fieldUpdated?.updatedProperties).toContain('options');
    expect(fieldUpdated?.changes?.type).toEqual({
      oldValue: 'singleLineText',
      newValue: 'singleSelect',
    });

    for (const event of result.events) {
      if (event.name.startsWith('Field')) {
        expect(event.fieldId).toBeDefined();
      }
    }
  });
});
