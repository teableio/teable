/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

let fieldIdCounter = 0;
let tableNameCounter = 0;

const createFieldId = () => {
  const suffix = fieldIdCounter.toString(36).padStart(16, '0');
  fieldIdCounter += 1;
  return `fld${suffix}`;
};

const createName = (prefix: string) => `${prefix}-${tableNameCounter++}`;

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

describe('update-field: ai dependency trigger guard', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('preserves record-driven dependency updates while guarding schema-driven refresh from setRecord', async () => {
    let tableId: string | undefined;

    try {
      const sourceFieldId = createFieldId();
      const directAiFieldId = createFieldId();
      const formulaAFieldId = createFieldId();
      const formulaAiFieldId = createFieldId();
      const formulaBAFieldId = createFieldId();
      const formulaBAAiFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: createName('ai-trigger-guard'),
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: sourceFieldId, name: 'A' },
          {
            type: 'singleLineText',
            id: directAiFieldId,
            name: '引用A',
            aiConfig: {
              modelKey: 'aiGateway@test@teable',
              isAutoFill: true,
              type: 'extraction',
              sourceFieldId,
            },
          },
          {
            type: 'formula',
            id: formulaAFieldId,
            name: '公式A',
            options: {
              expression: `{${sourceFieldId}}`,
            },
          },
          {
            type: 'singleLineText',
            id: formulaAiFieldId,
            name: '引用公式A',
            aiConfig: {
              modelKey: 'aiGateway@test@teable',
              isAutoFill: true,
              type: 'summary',
              sourceFieldId: formulaAFieldId,
            },
          },
          {
            type: 'formula',
            id: formulaBAFieldId,
            name: '公式B-A',
            options: {
              expression: `{${formulaAFieldId}}`,
            },
          },
          {
            type: 'singleLineText',
            id: formulaBAAiFieldId,
            name: '引用公式B-A',
            aiConfig: {
              modelKey: 'aiGateway@test@teable',
              isAutoFill: true,
              type: 'summary',
              sourceFieldId: formulaBAFieldId,
            },
          },
        ],
      });
      tableId = table.id;

      const record = await ctx.createRecord(table.id, {
        Name: 'Row 1',
        [sourceFieldId]: '100',
      });
      await ctx.drainOutbox();

      ctx.clearLogs();
      const recordUpdateEventCount = ctx.testContainer.eventBus.events().length;

      await ctx.updateRecord(table.id, record.id, {
        [sourceFieldId]: '200',
      });
      await ctx.drainOutbox();

      const recordUpdated = await ctx.listRecords(table.id);
      expect(recordUpdated[0]?.fields[formulaAFieldId]).toBe('200');
      expect(recordUpdated[0]?.fields[formulaBAFieldId]).toBe('200');

      const recordUpdateEvents = ctx.testContainer.eventBus.events().slice(recordUpdateEventCount);
      const recordUpdateEventNames = recordUpdateEvents
        .map((event) => getDomainEventName(event))
        .filter((eventName): eventName is string => Boolean(eventName));

      expect(recordUpdateEventNames).toContain('RecordUpdated');
      expect(recordUpdateEventNames).toContain('RecordsBatchUpdated');

      const schemaUpdateEventCount = ctx.testContainer.eventBus.events().length;

      const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId: table.id,
          fieldId: sourceFieldId,
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

      await ctx.drainOutbox();

      const schemaUpdated = await ctx.listRecords(table.id);
      expect(schemaUpdated[0]?.fields[sourceFieldId]).toBe(200);
      expect(schemaUpdated[0]?.fields[formulaAFieldId]).toBe(200);
      expect(schemaUpdated[0]?.fields[formulaBAFieldId]).toBe(200);

      const schemaUpdateEvents = ctx.testContainer.eventBus.events().slice(schemaUpdateEventCount);
      const schemaUpdateEventNames = schemaUpdateEvents
        .map((event) => getDomainEventName(event))
        .filter((eventName): eventName is string => Boolean(eventName));
      const schemaActionKeys = schemaUpdateEvents
        .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
        .map((event) => getActionKey(event))
        .filter((actionKey): actionKey is string => Boolean(actionKey));

      expect(schemaUpdateEventNames).not.toContain('RecordUpdated');
      expect(schemaUpdateEventNames).not.toContain('RecordsBatchUpdated');
      expect(schemaUpdateEventNames).toContain('TableActionTriggerRequested');
      expect(schemaActionKeys).toEqual(expect.arrayContaining(['setField']));
      expect(schemaActionKeys).not.toContain('setRecord');
    } finally {
      if (tableId) {
        await ctx.deleteTable(tableId).catch(() => undefined);
      }
    }
  });
});
