/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

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

const getEventTableId = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const tableId = event['tableId'];
  if (!isObjectRecord(tableId) || typeof tableId.toString !== 'function') {
    return undefined;
  }

  return tableId.toString();
};

const getActionKey = (event: unknown): string | undefined => {
  if (!isObjectRecord(event)) {
    return undefined;
  }

  const actionKey = event['actionKey'];
  return typeof actionKey === 'string' ? actionKey : undefined;
};

const deleteTablesSafe = async (ctx: SharedTestContext, tableIds: ReadonlyArray<string>) => {
  for (const tableId of [...tableIds].reverse()) {
    try {
      await ctx.deleteTable(tableId);
    } catch {}
  }
};

type SchemaRefreshCaseContext = {
  sourceTableId: string;
  sourceFieldId: string;
  observedTableId: string;
  observedFieldId: string;
  expectedValue: unknown;
  expectedRefreshTableIds: ReadonlyArray<string>;
  updateFieldPayload: Record<string, unknown>;
};

type SchemaRefreshCase = {
  label: string;
  setup: (
    ctx: SharedTestContext,
    registerTable: (tableId: string) => void
  ) => Promise<SchemaRefreshCaseContext>;
};

describe('update-field: schema refresh without record events for computed values', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  const cases: SchemaRefreshCase[] = [
    {
      label: 'formula',
      setup: async (ctx, registerTable) => {
        const selectFieldId = createFieldId();
        const formulaFieldId = createFieldId();
        const optionOpen = { id: 'choOpen', name: 'Open', color: 'blueBright' as const };
        const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };

        const table = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Formula ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: selectFieldId,
              name: 'Status',
              options: { choices: [optionOpen, optionDone] },
            },
            {
              type: 'formula',
              id: formulaFieldId,
              name: 'Summary',
              options: {
                expression: `{${selectFieldId}} & "!"`,
              },
            },
          ],
        });
        registerTable(table.id);

        await ctx.createRecord(table.id, { [selectFieldId]: 'Open' });
        await ctx.drainOutbox();

        return {
          sourceTableId: table.id,
          sourceFieldId: selectFieldId,
          observedTableId: table.id,
          observedFieldId: formulaFieldId,
          expectedValue: 'Closed!',
          expectedRefreshTableIds: [table.id],
          updateFieldPayload: {
            options: {
              choices: [{ ...optionOpen, name: 'Closed' }, optionDone],
            },
          },
        };
      },
    },
    {
      label: 'lookup',
      setup: async (ctx, registerTable) => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const optionOpen = { id: 'choOpen', name: 'Open', color: 'blueBright' as const };
        const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Lookup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: foreignStatusFieldId,
              name: 'Status',
              options: { choices: [optionOpen, optionDone] },
            },
          ],
        });
        registerTable(foreignTable.id);

        const hostPrimaryFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const lookupFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Lookup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'lookup',
              id: lookupFieldId,
              name: 'Lookup Status',
              options: {
                linkFieldId,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignStatusFieldId,
              },
            },
          ],
        });
        registerTable(hostTable.id);

        const foreignRecord = await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Source 1',
          [foreignStatusFieldId]: 'Open',
        });
        await ctx.createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
          [linkFieldId]: { id: foreignRecord.id },
        });
        await ctx.drainOutbox();

        return {
          sourceTableId: foreignTable.id,
          sourceFieldId: foreignStatusFieldId,
          observedTableId: hostTable.id,
          observedFieldId: lookupFieldId,
          expectedValue: ['Closed'],
          expectedRefreshTableIds: [foreignTable.id, hostTable.id],
          updateFieldPayload: {
            options: {
              choices: [{ ...optionOpen, name: 'Closed' }, optionDone],
            },
          },
        };
      },
    },
    {
      label: 'rollup',
      setup: async (ctx, registerTable) => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const optionOpen = { id: 'choOpen', name: 'Open', color: 'blueBright' as const };
        const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Rollup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: foreignStatusFieldId,
              name: 'Status',
              options: { choices: [optionOpen, optionDone] },
            },
          ],
        });
        registerTable(foreignTable.id);

        const hostPrimaryFieldId = createFieldId();
        const linkFieldId = createFieldId();
        const rollupFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Rollup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: 'Link',
              options: {
                relationship: 'manyOne',
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryFieldId,
                isOneWay: true,
              },
            },
            {
              type: 'rollup',
              id: rollupFieldId,
              name: 'Rollup Status',
              options: {
                expression: 'concatenate({values})',
              },
              config: {
                linkFieldId,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignStatusFieldId,
              },
            },
          ],
        });
        registerTable(hostTable.id);

        const foreignRecord = await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Source 1',
          [foreignStatusFieldId]: 'Open',
        });
        await ctx.createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
          [linkFieldId]: { id: foreignRecord.id },
        });
        await ctx.drainOutbox();

        return {
          sourceTableId: foreignTable.id,
          sourceFieldId: foreignStatusFieldId,
          observedTableId: hostTable.id,
          observedFieldId: rollupFieldId,
          expectedValue: 'Closed',
          expectedRefreshTableIds: [foreignTable.id, hostTable.id],
          updateFieldPayload: {
            options: {
              choices: [{ ...optionOpen, name: 'Closed' }, optionDone],
            },
          },
        };
      },
    },
    {
      label: 'conditionalLookup',
      setup: async (ctx, registerTable) => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const optionActive = { id: 'choActive', name: 'Active', color: 'greenBright' as const };
        const optionInactive = {
          id: 'choInactive',
          name: 'Inactive',
          color: 'gray' as const,
        };
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Conditional Lookup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: foreignStatusFieldId,
              name: 'Status',
              options: { choices: [optionActive, optionInactive] },
            },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
        });
        registerTable(foreignTable.id);

        const hostPrimaryFieldId = createFieldId();
        const conditionalLookupFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Conditional Lookup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalLookup',
              id: conditionalLookupFieldId,
              name: 'Active Values',
              options: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignStatusFieldId,
                        operator: 'is',
                        value: 'Active',
                      },
                    ],
                  },
                },
              },
            },
          ],
        });
        registerTable(hostTable.id);

        await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Active',
          [foreignStatusFieldId]: 'Active',
          [foreignValueFieldId]: 1,
        });
        await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Inactive',
          [foreignStatusFieldId]: 'Inactive',
          [foreignValueFieldId]: 100,
        });
        await ctx.createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
        });
        await ctx.drainOutbox();

        return {
          sourceTableId: foreignTable.id,
          sourceFieldId: foreignStatusFieldId,
          observedTableId: hostTable.id,
          observedFieldId: conditionalLookupFieldId,
          expectedValue: [1],
          expectedRefreshTableIds: [foreignTable.id, hostTable.id],
          updateFieldPayload: {
            options: {
              choices: [{ ...optionActive, name: 'Ready' }, optionInactive],
            },
          },
        };
      },
    },
    {
      label: 'conditionalRollup',
      setup: async (ctx, registerTable) => {
        const foreignPrimaryFieldId = createFieldId();
        const foreignStatusFieldId = createFieldId();
        const foreignValueFieldId = createFieldId();
        const optionActive = { id: 'choActive', name: 'Active', color: 'greenBright' as const };
        const optionInactive = {
          id: 'choInactive',
          name: 'Inactive',
          color: 'gray' as const,
        };
        const foreignTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Conditional Rollup Foreign ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: foreignPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'singleSelect',
              id: foreignStatusFieldId,
              name: 'Status',
              options: { choices: [optionActive, optionInactive] },
            },
            { type: 'number', id: foreignValueFieldId, name: 'Value' },
          ],
        });
        registerTable(foreignTable.id);

        const hostPrimaryFieldId = createFieldId();
        const conditionalRollupFieldId = createFieldId();
        const hostTable = await ctx.createTable({
          baseId: ctx.baseId,
          name: `Schema Refresh Conditional Rollup Host ${fieldIdCounter}`,
          fields: [
            { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
            {
              type: 'conditionalRollup',
              id: conditionalRollupFieldId,
              name: 'Active Sum',
              options: {
                expression: 'sum({values})',
              },
              config: {
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignValueFieldId,
                condition: {
                  filter: {
                    conjunction: 'and',
                    filterSet: [
                      {
                        fieldId: foreignStatusFieldId,
                        operator: 'is',
                        value: 'Active',
                      },
                    ],
                  },
                },
              },
            },
          ],
        });
        registerTable(hostTable.id);

        await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Active',
          [foreignStatusFieldId]: 'Active',
          [foreignValueFieldId]: 1,
        });
        await ctx.createRecord(foreignTable.id, {
          [foreignPrimaryFieldId]: 'Inactive',
          [foreignStatusFieldId]: 'Inactive',
          [foreignValueFieldId]: 100,
        });
        await ctx.createRecord(hostTable.id, {
          [hostPrimaryFieldId]: 'Host 1',
        });
        await ctx.drainOutbox();

        return {
          sourceTableId: foreignTable.id,
          sourceFieldId: foreignStatusFieldId,
          observedTableId: hostTable.id,
          observedFieldId: conditionalRollupFieldId,
          expectedValue: 1,
          expectedRefreshTableIds: [foreignTable.id, hostTable.id],
          updateFieldPayload: {
            options: {
              choices: [{ ...optionActive, name: 'Ready' }, optionInactive],
            },
          },
        };
      },
    },
  ];

  for (const testCase of cases) {
    test(`does not emit record events for ${testCase.label} schema refresh`, async () => {
      const tableIds: string[] = [];
      try {
        const context = await testCase.setup(ctx, (tableId) => tableIds.push(tableId));
        const beforeEventCount = ctx.testContainer.eventBus.events().length;

        const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tableId: context.sourceTableId,
            fieldId: context.sourceFieldId,
            field: context.updateFieldPayload,
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

        const records = await ctx.listRecords(context.observedTableId);
        expect(records[0]?.fields[context.observedFieldId]).toEqual(context.expectedValue);

        const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
        const newEventNames = newEvents
          .map((event) => getDomainEventName(event))
          .filter((eventName): eventName is string => Boolean(eventName));
        const actionTriggerTableIds = newEvents
          .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
          .map((event) => getEventTableId(event))
          .filter((tableId): tableId is string => Boolean(tableId));
        const actionTriggerKeys = newEvents
          .filter((event) => getDomainEventName(event) === 'TableActionTriggerRequested')
          .map((event) => getActionKey(event))
          .filter((actionKey): actionKey is string => Boolean(actionKey));

        expect(newEventNames).not.toContain('RecordUpdated');
        expect(newEventNames).not.toContain('RecordsBatchUpdated');
        expect(actionTriggerTableIds).toEqual(
          expect.arrayContaining([...context.expectedRefreshTableIds])
        );
        expect(actionTriggerKeys).toEqual(expect.arrayContaining(['setField']));
        expect(actionTriggerKeys).not.toContain('setRecord');
      } finally {
        await deleteTablesSafe(ctx, tableIds);
      }
    });
  }
});
