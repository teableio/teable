/* eslint-disable @typescript-eslint/naming-convention */
import { updateFieldOkResponseSchema } from '@teable/v2-contract-http';
import { NumberFormattingType } from '@teable/v2-core';
import { beforeAll, describe, expect, test } from 'vitest';
import { getSharedTestContext, type SharedTestContext } from '../../shared/globalTestContext';

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

const getChangedFieldIdsFromDomainEvent = (event: unknown): string[] => {
  const eventName = getDomainEventName(event);
  if (eventName === 'RecordUpdated') {
    if (!isObjectRecord(event)) return [];
    const changes = event['changes'];
    if (!Array.isArray(changes)) return [];
    return changes.flatMap((change) => {
      if (!isObjectRecord(change)) return [];
      return typeof change['fieldId'] === 'string' ? [change['fieldId']] : [];
    });
  }

  if (eventName === 'RecordsBatchUpdated') {
    if (!isObjectRecord(event)) return [];
    const updates = event['updates'];
    if (!Array.isArray(updates)) return [];
    return updates.flatMap((update) => {
      if (!isObjectRecord(update)) return [];
      const changes = update['changes'];
      if (!Array.isArray(changes)) return [];
      return changes.flatMap((change) => {
        if (!isObjectRecord(change)) return [];
        return typeof change['fieldId'] === 'string' ? [change['fieldId']] : [];
      });
    });
  }

  return [];
};

describe('update-field: record value seeding after property changes', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('should update formula record values after select option rename (formula references select field)', async () => {
    let tableId: string | undefined;
    try {
      const selectFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const optionRed = { id: 'choRed', name: 'Red', color: 'redBright' as const };
      const optionGreen = { id: 'choGreen', name: 'Green', color: 'greenBright' as const };

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Select Rename',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: selectFieldId,
            name: 'Color',
            options: { choices: [optionRed, optionGreen] },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Color Formula',
            options: { expression: `{${selectFieldId}} & " is my color"` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [selectFieldId]: 'Red' });
      const r2 = await ctx.createRecord(tableId, { [selectFieldId]: 'Green' });

      await ctx.updateField({
        tableId,
        fieldId: selectFieldId,
        field: { options: { choices: [optionRed, { ...optionGreen, name: 'Emerald' }] } },
      });

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((record) => record.id === r1.id);
      const rec2 = records.find((record) => record.id === r2.id);

      expect(rec1?.fields[selectFieldId]).toBe('Red');
      expect(rec1?.fields[formulaFieldId]).toBe('Red is my color');
      expect(rec2?.fields[selectFieldId]).toBe('Emerald');
      expect(rec2?.fields[formulaFieldId]).toBe('Emerald is my color');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should not emit user field record changes when select option rename recomputes CONCATENATE(singleSelect, user)', async () => {
    let tableId: string | undefined;
    try {
      const selectFieldId = createFieldId();
      const userFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const optionTodo = { id: 'choTodo', name: 'Todo', color: 'blueBright' as const };
      const optionDone = { id: 'choDone', name: 'Done', color: 'greenBright' as const };

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Select User Event Guard',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: selectFieldId,
            name: 'Status',
            options: { choices: [optionTodo, optionDone] },
          },
          {
            type: 'user',
            id: userFieldId,
            name: 'Assignee',
            options: {
              isMultiple: false,
              shouldNotify: false,
            },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Summary',
            options: {
              expression: `CONCATENATE({${selectFieldId}}, " - ", {${userFieldId}})`,
            },
          },
        ],
      });
      tableId = table.id;

      const record = await ctx.createRecord(tableId, {
        [selectFieldId]: 'Todo',
        [userFieldId]: {
          id: ctx.testUser.id,
          title: ctx.testUser.name,
        },
      });
      await ctx.drainOutbox();

      const beforeEventCount = ctx.testContainer.eventBus.events().length;

      const response = await fetch(`${ctx.baseUrl}/tables/updateField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableId,
          fieldId: selectFieldId,
          field: {
            options: {
              choices: [{ ...optionTodo, name: 'Ready' }, optionDone],
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

      await ctx.drainOutbox();

      const records = await ctx.listRecords(tableId);
      const updated = records.find((current) => current.id === record.id);
      expect(updated?.fields[selectFieldId]).toBe('Ready');
      expect(updated?.fields[userFieldId]).toMatchObject({
        id: ctx.testUser.id,
        title: ctx.testUser.name,
      });
      expect(updated?.fields[formulaFieldId]).toBe(`Ready - ${ctx.testUser.name}`);

      const newEvents = ctx.testContainer.eventBus.events().slice(beforeEventCount);
      const newEventNames = newEvents
        .map((event) => getDomainEventName(event))
        .filter((eventName): eventName is string => Boolean(eventName));
      const changedFieldIds = newEvents.flatMap((event) =>
        getChangedFieldIdsFromDomainEvent(event)
      );

      expect(newEventNames).not.toContain('RecordUpdated');
      expect(newEventNames).not.toContain('RecordsBatchUpdated');
      expect(changedFieldIds).not.toContain(userFieldId);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should update formula record values to null after select option delete', async () => {
    let tableId: string | undefined;
    try {
      const selectFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const optionA = { id: 'choA', name: 'A', color: 'blueBright' as const };
      const optionB = { id: 'choB', name: 'B', color: 'greenBright' as const };
      const optionC = { id: 'choC', name: 'C', color: 'yellowBright' as const };

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Select Delete',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: selectFieldId,
            name: 'Status',
            options: { choices: [optionA, optionB, optionC] },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Status Formula',
            options: { expression: `IF({${selectFieldId}}, {${selectFieldId}} & "!", "none")` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [selectFieldId]: 'A' });
      const r2 = await ctx.createRecord(tableId, { [selectFieldId]: 'B' });
      const r3 = await ctx.createRecord(tableId, { [selectFieldId]: 'C' });

      await ctx.updateField({
        tableId,
        fieldId: selectFieldId,
        field: { options: { choices: [optionA, optionC] } },
      });

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((record) => record.id === r1.id);
      const rec2 = records.find((record) => record.id === r2.id);
      const rec3 = records.find((record) => record.id === r3.id);

      expect(rec1?.fields[selectFieldId]).toBe('A');
      expect(rec1?.fields[formulaFieldId]).toBe('A!');
      expect(rec2?.fields[selectFieldId]).toBeNull();
      expect(rec2?.fields[formulaFieldId]).toBe('none');
      expect(rec3?.fields[selectFieldId]).toBe('C');
      expect(rec3?.fields[formulaFieldId]).toBe('C!');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should update lookup record values after foreign select option rename', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;
    try {
      const sourcePrimaryFieldId = createFieldId();
      const sourceStatusFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      const optionActive = { id: 'choActive', name: 'Active', color: 'greenBright' as const };
      const optionInactive = { id: 'choInactive', name: 'Inactive', color: 'gray' as const };

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Lookup Source',
        fields: [
          { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: sourceStatusFieldId,
            name: 'Status',
            options: { choices: [optionActive, optionInactive] },
          },
        ],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Lookup Host',
        fields: [
          { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Link To Source',
            options: {
              relationship: 'manyOne',
              foreignTableId: sourceTableId,
              lookupFieldId: sourcePrimaryFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'Status Lookup',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTableId,
              lookupFieldId: sourceStatusFieldId,
            },
          },
        ],
      });
      hostTableId = hostTable.id;

      const sourceRecord = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'Foreign Row',
        [sourceStatusFieldId]: 'Active',
      });
      const hostRecord = await ctx.createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Host Row',
        [hostLinkFieldId]: { id: sourceRecord.id },
      });

      await ctx.drainOutbox();

      await ctx.updateField({
        tableId: sourceTableId,
        fieldId: sourceStatusFieldId,
        field: {
          options: {
            choices: [{ ...optionActive, name: 'Enabled' }, optionInactive],
          },
        },
      });

      await ctx.drainOutbox();

      const sourceRecords = await ctx.listRecords(sourceTableId);
      const updatedSourceRecord = sourceRecords.find((record) => record.id === sourceRecord.id);
      expect(updatedSourceRecord?.fields[sourceStatusFieldId]).toBe('Enabled');

      const hostRecords = await ctx.listRecords(hostTableId);
      const updatedHostRecord = hostRecords.find((record) => record.id === hostRecord.id);
      expect(updatedHostRecord?.fields[hostLookupFieldId]).toEqual(['Enabled']);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });

  test('should reject creating SUM rollup over text before foreign field conversion', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;
    try {
      const sourcePrimaryFieldId = createFieldId();
      const sourceAmountFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostRollupFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Rollup Source',
        fields: [
          { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: sourceAmountFieldId, name: 'Amount' },
        ],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Rollup Host',
        fields: [
          { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Source Links',
            options: {
              relationship: 'oneMany',
              foreignTableId: sourceTableId,
              lookupFieldId: sourcePrimaryFieldId,
              isOneWay: true,
            },
          },
        ],
      });
      hostTableId = hostTable.id;

      const rec1 = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'A1',
        [sourceAmountFieldId]: '10',
      });
      const rec2 = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'A2',
        [sourceAmountFieldId]: '20',
      });
      const rec3 = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'A3',
        [sourceAmountFieldId]: '30',
      });
      await ctx.createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Rollup Host',
        [hostLinkFieldId]: [{ id: rec1.id }, { id: rec2.id }, { id: rec3.id }],
      });

      const createdTable = await ctx.createField({
        baseId: ctx.baseId,
        tableId: hostTableId,
        field: {
          type: 'rollup',
          id: hostRollupFieldId,
          name: 'Amount Sum',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId: hostLinkFieldId,
            foreignTableId: sourceTableId,
            lookupFieldId: sourceAmountFieldId,
          },
        },
      });

      const createdRollupField = createdTable.fields.find(
        (field) => field.id === hostRollupFieldId
      );
      expect(createdRollupField?.hasError).toBe(true);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });

  test('should clamp formula-over-rating values after rating max reduction', async () => {
    let tableId: string | undefined;
    try {
      const ratingFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Rating Clamp',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'rating',
            id: ratingFieldId,
            name: 'Rating',
            options: { max: 5, icon: 'star', color: 'yellowBright' },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Rating Percent',
            options: { expression: `{${ratingFieldId}} * 20` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [ratingFieldId]: 2 });
      const r2 = await ctx.createRecord(tableId, { [ratingFieldId]: 5 });
      const r3 = await ctx.createRecord(tableId, { [ratingFieldId]: 4 });

      await ctx.updateField({
        tableId,
        fieldId: ratingFieldId,
        field: { options: { max: 3 } },
      });

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((record) => record.id === r1.id);
      const rec2 = records.find((record) => record.id === r2.id);
      const rec3 = records.find((record) => record.id === r3.id);

      expect(rec1?.fields[ratingFieldId]).toBe(2);
      expect(rec1?.fields[formulaFieldId]).toBe(40);
      expect(rec2?.fields[ratingFieldId]).toBe(3);
      expect(rec2?.fields[formulaFieldId]).toBe(60);
      expect(rec3?.fields[ratingFieldId]).toBe(3);
      expect(rec3?.fields[formulaFieldId]).toBe(60);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should recompute all formula values after text → number conversion (v2 null-as-zero)', async () => {
    let tableId: string | undefined;
    try {
      const textFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Text Number',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: textFieldId, name: 'Text' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Text Plus 100',
            options: { expression: `{${textFieldId}} + 100` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [textFieldId]: '10' });
      const r2 = await ctx.createRecord(tableId, { [textFieldId]: 'abc' });
      const r3 = await ctx.createRecord(tableId, { [textFieldId]: '3.5' });
      const r4 = await ctx.createRecord(tableId, {});

      await ctx.updateField({
        tableId,
        fieldId: textFieldId,
        field: { type: 'number' },
      });

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((record) => record.id === r1.id);
      const rec2 = records.find((record) => record.id === r2.id);
      const rec3 = records.find((record) => record.id === r3.id);
      const rec4 = records.find((record) => record.id === r4.id);

      expect(rec1?.fields[textFieldId]).toBe(10);
      expect(rec1?.fields[formulaFieldId]).toBe(110);
      expect(rec2?.fields[textFieldId]).toBeNull();
      expect(rec2?.fields[formulaFieldId]).toBe(100);
      expect(rec3?.fields[textFieldId]).toBe(3.5);
      expect(rec3?.fields[formulaFieldId]).toBe(103.5);
      expect(rec4?.fields[textFieldId]).toBeNull();
      expect(rec4?.fields[formulaFieldId]).toBe(100);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should recompute lookup values after foreign text → number conversion', async () => {
    let sourceTableId: string | undefined;
    let hostTableId: string | undefined;
    try {
      const sourcePrimaryFieldId = createFieldId();
      const sourceScoreFieldId = createFieldId();
      const hostPrimaryFieldId = createFieldId();
      const hostLinkFieldId = createFieldId();
      const hostLookupFieldId = createFieldId();

      const sourceTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Lookup Number Source',
        fields: [
          { type: 'singleLineText', id: sourcePrimaryFieldId, name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: sourceScoreFieldId, name: 'Score' },
        ],
      });
      sourceTableId = sourceTable.id;

      const hostTable = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Lookup Number Host',
        fields: [
          { type: 'singleLineText', id: hostPrimaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: hostLinkFieldId,
            name: 'Source Link',
            options: {
              relationship: 'manyOne',
              foreignTableId: sourceTableId,
              lookupFieldId: sourcePrimaryFieldId,
            },
          },
          {
            type: 'lookup',
            id: hostLookupFieldId,
            name: 'Score Lookup',
            options: {
              linkFieldId: hostLinkFieldId,
              foreignTableId: sourceTableId,
              lookupFieldId: sourceScoreFieldId,
            },
          },
        ],
      });
      hostTableId = hostTable.id;

      const sourceR1 = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'Score 85',
        [sourceScoreFieldId]: '85',
      });
      const sourceR2 = await ctx.createRecord(sourceTableId, {
        [sourcePrimaryFieldId]: 'Score 92',
        [sourceScoreFieldId]: '92',
      });
      const hostR1 = await ctx.createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Host 1',
        [hostLinkFieldId]: { id: sourceR1.id },
      });
      const hostR2 = await ctx.createRecord(hostTableId, {
        [hostPrimaryFieldId]: 'Host 2',
        [hostLinkFieldId]: { id: sourceR2.id },
      });

      await ctx.drainOutbox();

      await ctx.updateField({
        tableId: sourceTableId,
        fieldId: sourceScoreFieldId,
        field: { type: 'number' },
      });

      await ctx.drainOutbox();

      const hostRecords = await ctx.listRecords(hostTableId);
      const rec1 = hostRecords.find((record) => record.id === hostR1.id);
      const rec2 = hostRecords.find((record) => record.id === hostR2.id);

      expect(rec1?.fields[hostLookupFieldId]).toEqual([85]);
      expect(rec2?.fields[hostLookupFieldId]).toEqual([92]);
    } finally {
      await deleteTableSafe(ctx, hostTableId);
      await deleteTableSafe(ctx, sourceTableId);
    }
  });

  test("should recompute null text concat formulas to '!' after text → number conversion", async () => {
    let tableId: string | undefined;
    try {
      const textFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Null Preservation',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: textFieldId, name: 'Text' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Text Suffix',
            options: { expression: `{${textFieldId}} & "!"` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [textFieldId]: 'hello' });
      const r2 = await ctx.createRecord(tableId, {});
      const r3 = await ctx.createRecord(tableId, { [textFieldId]: 'world' });

      await ctx.updateField({
        tableId,
        fieldId: textFieldId,
        field: { type: 'number' },
      });

      const records = await ctx.listRecords(tableId);
      const rec1 = records.find((record) => record.id === r1.id);
      const rec2 = records.find((record) => record.id === r2.id);
      const rec3 = records.find((record) => record.id === r3.id);

      expect(rec1?.fields[textFieldId]).toBeNull();
      expect(rec2?.fields[textFieldId]).toBeNull();
      expect(rec3?.fields[textFieldId]).toBeNull();

      expect(rec1?.fields[formulaFieldId]).toBe('!');
      expect(rec2?.fields[formulaFieldId]).toBe('!');
      expect(rec3?.fields[formulaFieldId]).toBe('!');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });
});

describe('update-field: seeding optimization - only affected records', () => {
  let ctx: SharedTestContext;

  beforeAll(async () => {
    ctx = await getSharedTestContext();
  });

  test('should only change records that had deleted select option values', async () => {
    let tableId: string | undefined;
    try {
      const selectFieldId = createFieldId();
      const formulaFieldId = createFieldId();
      const optionX = { id: 'choX', name: 'X', color: 'blueBright' as const };
      const optionY = { id: 'choY', name: 'Y', color: 'greenBright' as const };
      const optionZ = { id: 'choZ', name: 'Z', color: 'yellowBright' as const };

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Optimization Select Delete',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'singleSelect',
            id: selectFieldId,
            name: 'Select',
            options: { choices: [optionX, optionY, optionZ] },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Select Formula',
            options: { expression: `{${selectFieldId}}` },
          },
        ],
      });
      tableId = table.id;

      const rx = await ctx.createRecord(tableId, { [selectFieldId]: 'X' });
      const ry = await ctx.createRecord(tableId, { [selectFieldId]: 'Y' });
      const rz = await ctx.createRecord(tableId, { [selectFieldId]: 'Z' });

      await ctx.updateField({
        tableId,
        fieldId: selectFieldId,
        field: { options: { choices: [optionX, optionZ] } },
      });

      const records = await ctx.listRecords(tableId);
      const recX = records.find((record) => record.id === rx.id);
      const recY = records.find((record) => record.id === ry.id);
      const recZ = records.find((record) => record.id === rz.id);

      expect(recX?.fields[selectFieldId]).toBe('X');
      expect(recX?.fields[formulaFieldId]).toBe('X');
      expect(recY?.fields[selectFieldId]).toBeNull();
      expect(recY?.fields[formulaFieldId]).toBeNull();
      expect(recZ?.fields[selectFieldId]).toBe('Z');
      expect(recZ?.fields[formulaFieldId]).toBe('Z');
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should clamp only records with rating values greater than new max', async () => {
    let tableId: string | undefined;
    try {
      const ratingFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Optimization Rating Clamp',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'rating',
            id: ratingFieldId,
            name: 'Rating',
            options: { max: 10, icon: 'star', color: 'yellowBright' },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Rating Formula',
            options: { expression: `{${ratingFieldId}}` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [ratingFieldId]: 1 });
      const r2 = await ctx.createRecord(tableId, { [ratingFieldId]: 3 });
      const r3 = await ctx.createRecord(tableId, { [ratingFieldId]: 5 });
      const r4 = await ctx.createRecord(tableId, { [ratingFieldId]: 7 });
      const r5 = await ctx.createRecord(tableId, { [ratingFieldId]: 10 });

      await ctx.updateField({
        tableId,
        fieldId: ratingFieldId,
        field: { options: { max: 6 } },
      });

      const records = await ctx.listRecords(tableId);
      expect(records.find((record) => record.id === r1.id)?.fields[ratingFieldId]).toBe(1);
      expect(records.find((record) => record.id === r2.id)?.fields[ratingFieldId]).toBe(3);
      expect(records.find((record) => record.id === r3.id)?.fields[ratingFieldId]).toBe(5);
      expect(records.find((record) => record.id === r4.id)?.fields[ratingFieldId]).toBe(6);
      expect(records.find((record) => record.id === r5.id)?.fields[ratingFieldId]).toBe(6);

      expect(records.find((record) => record.id === r1.id)?.fields[formulaFieldId]).toBe(1);
      expect(records.find((record) => record.id === r2.id)?.fields[formulaFieldId]).toBe(3);
      expect(records.find((record) => record.id === r3.id)?.fields[formulaFieldId]).toBe(5);
      expect(records.find((record) => record.id === r4.id)?.fields[formulaFieldId]).toBe(6);
      expect(records.find((record) => record.id === r5.id)?.fields[formulaFieldId]).toBe(6);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should recompute all formula records when type conversion changes all values', async () => {
    let tableId: string | undefined;
    try {
      const textFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Optimization Type Conversion',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          { type: 'singleLineText', id: textFieldId, name: 'Text' },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Text Formula',
            options: { expression: `{${textFieldId}}` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [textFieldId]: 'a' });
      const r2 = await ctx.createRecord(tableId, { [textFieldId]: 'b' });
      const r3 = await ctx.createRecord(tableId, { [textFieldId]: 'c' });

      await ctx.updateField({
        tableId,
        fieldId: textFieldId,
        field: { type: 'checkbox' },
      });

      const records = await ctx.listRecords(tableId);
      expect(records.find((record) => record.id === r1.id)?.fields[textFieldId]).toBe(true);
      expect(records.find((record) => record.id === r2.id)?.fields[textFieldId]).toBe(true);
      expect(records.find((record) => record.id === r3.id)?.fields[textFieldId]).toBe(true);

      expect(records.find((record) => record.id === r1.id)?.fields[formulaFieldId]).toBe(true);
      expect(records.find((record) => record.id === r2.id)?.fields[formulaFieldId]).toBe(true);
      expect(records.find((record) => record.id === r3.id)?.fields[formulaFieldId]).toBe(true);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });

  test('should keep formula values unchanged when only number formatting changes', async () => {
    let tableId: string | undefined;
    try {
      const numberFieldId = createFieldId();
      const formulaFieldId = createFieldId();

      const table = await ctx.createTable({
        baseId: ctx.baseId,
        name: 'Record Value Seeding Optimization Cosmetic Change',
        fields: [
          { type: 'singleLineText', name: 'Name', isPrimary: true },
          {
            type: 'number',
            id: numberFieldId,
            name: 'Number',
            options: {
              formatting: { type: NumberFormattingType.Decimal, precision: 0 },
            },
          },
          {
            type: 'formula',
            id: formulaFieldId,
            name: 'Number x10',
            options: { expression: `{${numberFieldId}} * 10` },
          },
        ],
      });
      tableId = table.id;

      const r1 = await ctx.createRecord(tableId, { [numberFieldId]: 1 });
      const r2 = await ctx.createRecord(tableId, { [numberFieldId]: 2 });
      const r3 = await ctx.createRecord(tableId, { [numberFieldId]: 3 });

      await ctx.updateField({
        tableId,
        fieldId: numberFieldId,
        field: {
          options: {
            formatting: { type: NumberFormattingType.Currency, precision: 2, symbol: 'USD' },
          },
        },
      });

      const records = await ctx.listRecords(tableId);
      expect(records.find((record) => record.id === r1.id)?.fields[formulaFieldId]).toBe(10);
      expect(records.find((record) => record.id === r2.id)?.fields[formulaFieldId]).toBe(20);
      expect(records.find((record) => record.id === r3.id)?.fields[formulaFieldId]).toBe(30);
    } finally {
      await deleteTableSafe(ctx, tableId);
    }
  });
});
