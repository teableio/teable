/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../shared/globalTestContext';

let fieldIdCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {}
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getDomainEventName = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const name = event['name'];
  if (!isObjectRecord(name) || typeof name.toString !== 'function') {
    return undefined;
  }

  return name.toString();
};

const getActionKey = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const actionKey = event['actionKey'];
  return typeof actionKey === 'string' ? actionKey : undefined;
};

describe('update-field: type conversion record event guard', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('does not emit record update events when type conversion changes stored cell values', async () => {
    let tableId: string | undefined;
    try {
      const textFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Type Conversion Record Event Guard',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: textFieldId, name: 'Amount Text' },
        ],
      });
      tableId = table.id;

      const recordA = await ctx.createRecord(tableId, { [textFieldId]: '100' });
      const recordB = await ctx.createRecord(tableId, { [textFieldId]: '' });
      await ctx.drainOutbox();

      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fieldId: textFieldId,
          field: {
            type: 'number',
          },
        }),
      });

      expect(response.ok).toBe(true);
      const rawBody = await response.json();
      const parsed = updateFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) {
        throw new Error('Failed to parse updateField response');
      }

      const responseEventNames = parsed.data.data.events.map((event) => event.name);
      expect(responseEventNames).toContain('FieldUpdated');
      expect(responseEventNames).not.toContain('RecordUpdated');
      expect(responseEventNames).not.toContain('RecordsBatchUpdated');
      expect(responseEventNames).not.toContain('TableActionTriggerRequested');

      const records = await ctx.listRecords(tableId);
      const convertedA = records.find((record) => record.id === recordA.id);
      const convertedB = records.find((record) => record.id === recordB.id);

      expect(convertedA?.fields[textFieldId]).toBe(100);
      expect(convertedB?.fields[textFieldId]).toBeNull();

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const newEventNames = newEvents
        .map((event) => getDomainEventName(event))
        .filter((eventName): eventName is string => Boolean(eventName));
      const actionKeys = newEvents
        .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
        .map((event) => getActionKey(event))
        .filter((actionKey): actionKey is string => Boolean(actionKey));

      expect(newEventNames).not.toContain('RecordUpdated');
      expect(newEventNames).not.toContain('RecordsBatchUpdated');
      expect(newEventNames).toContain('TableActionTriggerRequested');
      expect(actionKeys).toEqual(expect.arrayContaining(['setField']));
      expect(actionKeys).not.toContain('setRecord');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('emits schema refresh action triggers when type conversion changes a field to formula', async () => {
    let tableId: string | undefined;
    try {
      const textFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Type Conversion Formula Event Guard',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: textFieldId, name: 'Amount Text' },
        ],
      });
      tableId = table.id;

      const recordA = await ctx.createRecord(tableId, { [textFieldId]: '100' });
      const recordB = await ctx.createRecord(tableId, { [textFieldId]: '' });
      await ctx.drainOutbox();

      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fieldId: textFieldId,
          field: {
            type: 'formula',
            options: {
              expression: '1 + 1',
            },
          },
        }),
      });

      expect(response.ok).toBe(true);
      const rawBody = await response.json();
      const parsed = updateFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) {
        throw new Error('Failed to parse updateField response');
      }

      const responseEventNames = parsed.data.data.events.map((event) => event.name);
      expect(responseEventNames).toContain('FieldUpdated');
      expect(responseEventNames).not.toContain('RecordUpdated');
      expect(responseEventNames).not.toContain('RecordsBatchUpdated');
      expect(responseEventNames).not.toContain('TableActionTriggerRequested');

      const records = await ctx.listRecords(tableId);
      const convertedA = records.find((record) => record.id === recordA.id);
      const convertedB = records.find((record) => record.id === recordB.id);

      expect(convertedA?.fields[textFieldId]).toBe(2);
      expect(convertedB?.fields[textFieldId]).toBe(2);

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const newEventNames = newEvents
        .map((event) => getDomainEventName(event))
        .filter((eventName): eventName is string => Boolean(eventName));
      const actionKeys = newEvents
        .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
        .map((event) => getActionKey(event))
        .filter((actionKey): actionKey is string => Boolean(actionKey));

      expect(newEventNames).not.toContain('RecordUpdated');
      expect(newEventNames).not.toContain('RecordsBatchUpdated');
      expect(newEventNames).toContain('TableActionTriggerRequested');
      expect(actionKeys).toEqual(expect.arrayContaining(['setField']));
      expect(actionKeys).not.toContain('setRecord');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });
});
