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

const deleteTableSafe = async (ctx: SharedTestContext, tableId: string | undefined) => {
  if (!tableId) return;
  try {
    await ctx.deleteTable(tableId);
  } catch {}
};

describe('update-field: select option record action', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('emits record action trigger when removing a singleSelect option clears cells', async () => {
    let tableId: string | undefined;
    try {
      const statusFieldId = createFieldId();
      const optionOpen = { id: 'choOpen', name: 'Open', color: 'blueBright' as const };
      const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Select Option Record Action',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: statusFieldId,
            name: 'Status',
            options: { choices: [optionOpen, optionDone] },
          },
        ],
      });
      tableId = table.id;

      const clearedRecord = await ctx.createRecord(tableId, { [statusFieldId]: 'Open' });
      const retainedRecord = await ctx.createRecord(tableId, { [statusFieldId]: 'Done' });
      await ctx.drainOutbox();

      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fieldId: statusFieldId,
          field: {
            options: {
              choices: [optionDone],
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
      expect(responseEventNames).not.toContain('TableActionTriggerRequested');

      const records = await ctx.listRecords(tableId);
      expect(records.find((record) => record.id === clearedRecord.id)?.fields[statusFieldId]).toBe(
        null
      );
      expect(records.find((record) => record.id === retainedRecord.id)?.fields[statusFieldId]).toBe(
        'Done'
      );

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const actionKeys = newEvents
        .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
        .map((event) => getActionKey(event))
        .filter((actionKey): actionKey is string => Boolean(actionKey));

      expect(actionKeys).toEqual(expect.arrayContaining(['setRecord']));
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });
});
