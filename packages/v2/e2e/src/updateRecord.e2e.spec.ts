/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createRecordOkResponseSchema,
  createTableOkResponseSchema,
  listTableRecordsOkResponseSchema,
  updateRecordOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http updateRecord (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let tableId: string;
  let textFieldId: string;
  let numberFieldId: string;
  let testContainer: IV2NodeTestContainer;
  let fieldIdCounter = 0;
  let typecastTableId: string;
  let typecastPrimaryFieldId: string;
  let typecastNumberFieldId: string;
  let typecastCheckboxFieldId: string;
  let typecastDateFieldId: string;
  let typecastSingleSelectFieldId: string;
  let typecastMultiSelectFieldId: string;
  let typecastRatingFieldId: string;
  let typecastSingleSelectOpenOptionId: string;
  let typecastMultiSelectTagAId: string;
  let typecastMultiSelectTagCId: string;

  const typecastCaseKeys = [
    'number',
    'checkbox',
    'date',
    'singleSelect',
    'multipleSelect',
    'rating',
  ] as const;

  type TypecastCaseKey = (typeof typecastCaseKeys)[number];

  interface TypecastCase {
    name: TypecastCaseKey;
    fieldId: () => string;
    input: unknown;
    assert: (value: unknown) => void;
  }

  const createTypecastCases = () =>
    ({
      number: {
        name: 'number',
        fieldId: () => typecastNumberFieldId,
        input: '123.5',
        assert: (value) => {
          expect(value).toBe(123.5);
        },
      },
      checkbox: {
        name: 'checkbox',
        fieldId: () => typecastCheckboxFieldId,
        input: 'true',
        assert: (value) => {
          expect(value).toBe(true);
        },
      },
      date: {
        name: 'date',
        fieldId: () => typecastDateFieldId,
        input: '2024-01-02T03:04:05.000Z',
        assert: (value) => {
          expect(value).toBe('2024-01-02T03:04:05.000Z');
        },
      },
      singleSelect: {
        name: 'singleSelect',
        fieldId: () => typecastSingleSelectFieldId,
        input: 'Open',
        assert: (value) => {
          expect(value).toBe(typecastSingleSelectOpenOptionId);
        },
      },
      multipleSelect: {
        name: 'multipleSelect',
        fieldId: () => typecastMultiSelectFieldId,
        input: ['Tag A', 'Tag C'],
        assert: (value) => {
          expect(Array.isArray(value)).toBe(true);
          expect(value).toEqual([typecastMultiSelectTagAId, typecastMultiSelectTagCId]);
        },
      },
      rating: {
        name: 'rating',
        fieldId: () => typecastRatingFieldId,
        input: '4',
        assert: (value) => {
          expect(value).toBe(4);
        },
      },
    }) satisfies Record<TypecastCaseKey, TypecastCase>;
  const typecastCaseMap = createTypecastCases();
  const _exhaustiveCheck: Record<TypecastCaseKey, TypecastCase> = typecastCaseMap;
  void _exhaustiveCheck;
  const typecastCases = Object.values(typecastCaseMap);

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };

  const createTable = async (payload: ICreateTableCommandInput) => {
    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create table response');
    }
    return parsed.data.data.table;
  };

  const createRecord = async (tableIdParam: string, fields: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/tables/createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create record response');
    }
    return parsed.data.data.record;
  };

  const updateRecord = async (
    tableIdParam: string,
    recordId: string,
    fields: Record<string, unknown>
  ) => {
    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tableId: tableIdParam, recordId, fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update record: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse update record response');
    }
    return parsed.data.data.record;
  };

  const listRecords = async (tableIdParam: string) => {
    const params = new URLSearchParams({ tableId: tableIdParam });
    const response = await fetch(`${baseUrl}/tables/listRecords?${params.toString()}`, {
      method: 'GET',
      headers: { 'content-type': 'application/json' },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
  };

  const normalizeLookupArray = (value: unknown): unknown[] | undefined => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return undefined;
    if (!value.trim().startsWith('[')) return undefined;
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };

  const expectLookupValue = (value: unknown, expected: string) => {
    const normalized = normalizeLookupArray(value);
    if (normalized) {
      expect(normalized).toContain(expected);
      return;
    }
    expect(value).toBe(expected);
  };

  const processOutbox = async (times = 1) => {
    for (let i = 0; i < times; i += 1) {
      await testContainer.processOutbox();
    }
  };

  beforeAll(async () => {
    testContainer = await createV2NodeTestContainer();
    dispose = testContainer.dispose;
    baseId = testContainer.baseId.toString();

    const app = express();
    app.use(
      createV2ExpressRouter({
        createContainer: () => testContainer.container,
      })
    );

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const table = await createTable({
      baseId,
      name: 'Update Record Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Amount' },
      ],
      views: [{ type: 'grid' }],
    });
    tableId = table.id;
    const fields = table.fields;
    textFieldId = fields.find((f) => f.name === 'Title')?.id ?? '';
    numberFieldId = fields.find((f) => f.name === 'Amount')?.id ?? '';

    const typecastTable = await createTable({
      baseId,
      name: 'Typecast Update Table',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        { type: 'number', name: 'Number' },
        { type: 'checkbox', name: 'Checkbox' },
        { type: 'date', name: 'Date' },
        {
          type: 'singleSelect',
          name: 'Status',
          options: ['Open', 'Closed'],
        },
        {
          type: 'multipleSelect',
          name: 'Tags',
          options: ['Tag A', 'Tag B', 'Tag C'],
        },
        { type: 'rating', name: 'Score' },
      ],
      views: [{ type: 'grid' }],
    });
    typecastTableId = typecastTable.id;
    typecastPrimaryFieldId = typecastTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    typecastNumberFieldId = typecastTable.fields.find((f) => f.name === 'Number')?.id ?? '';
    typecastCheckboxFieldId = typecastTable.fields.find((f) => f.name === 'Checkbox')?.id ?? '';
    typecastDateFieldId = typecastTable.fields.find((f) => f.name === 'Date')?.id ?? '';
    typecastSingleSelectFieldId = typecastTable.fields.find((f) => f.name === 'Status')?.id ?? '';
    typecastMultiSelectFieldId = typecastTable.fields.find((f) => f.name === 'Tags')?.id ?? '';
    typecastRatingFieldId = typecastTable.fields.find((f) => f.name === 'Score')?.id ?? '';

    const singleSelectField = typecastTable.fields.find((f) => f.name === 'Status');
    const singleSelectChoices =
      (singleSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    typecastSingleSelectOpenOptionId =
      singleSelectChoices.find((choice) => choice.name === 'Open')?.id ?? '';
    if (!typecastSingleSelectOpenOptionId) {
      throw new Error('Missing single select option "Open"');
    }

    const multiSelectField = typecastTable.fields.find((f) => f.name === 'Tags');
    const multiSelectChoices =
      (multiSelectField?.options as { choices?: Array<{ id: string; name: string }> })?.choices ??
      [];
    typecastMultiSelectTagAId =
      multiSelectChoices.find((choice) => choice.name === 'Tag A')?.id ?? '';
    typecastMultiSelectTagCId =
      multiSelectChoices.find((choice) => choice.name === 'Tag C')?.id ?? '';
    if (!typecastMultiSelectTagAId || !typecastMultiSelectTagCId) {
      throw new Error('Missing multi select options');
    }
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('updates a record and persists changes', async () => {
    const record = await createRecord(tableId, {
      [textFieldId]: 'Original',
      [numberFieldId]: 10,
    });

    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId,
        recordId: record.id,
        fields: {
          [textFieldId]: 'Updated',
          [numberFieldId]: 99,
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.record.id).toBe(record.id);
    expect(body.data.record.fields[textFieldId]).toBe('Updated');
    expect(body.data.record.fields[numberFieldId]).toBe(99);

    const records = await listRecords(tableId);
    const updated = records.find((r) => r.id === record.id);
    expect(updated?.fields[textFieldId]).toBe('Updated');
    expect(updated?.fields[numberFieldId]).toBe(99);
  });

  it.each(typecastCases)('updates a record with typecast $name', async (testCase) => {
    const fieldId = testCase.fieldId();
    const record = await createRecord(typecastTableId, {
      [typecastPrimaryFieldId]: `Typecast ${testCase.name}`,
    });

    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: typecastTableId,
        recordId: record.id,
        typecast: true,
        fields: {
          [fieldId]: testCase.input,
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const value = body.data.record.fields[fieldId];
    testCase.assert(value);

    const records = await listRecords(typecastTableId);
    const updated = records.find((r) => r.id === record.id);
    expect(updated).toBeDefined();
    if (!updated) return;
    testCase.assert(updated.fields[fieldId]);
  });

  it('updates link fields by title when typecast is enabled', async () => {
    const foreignRecordTitle = 'Foreign A';
    const foreignTable = await createTable({
      baseId,
      name: 'Typecast Link Foreign',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      views: [{ type: 'grid' }],
    });
    const foreignTitleFieldId = foreignTable.fields.find((f) => f.name === 'Name')?.id ?? '';
    if (!foreignTitleFieldId) {
      throw new Error('Missing foreign title field');
    }
    const foreignRecord = await createRecord(foreignTable.id, {
      [foreignTitleFieldId]: foreignRecordTitle,
    });

    const linkFieldId = createFieldId();
    const mainTable = await createTable({
      baseId,
      name: 'Typecast Link Main',
      fields: [
        { type: 'singleLineText', name: 'Title', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Related',
          options: {
            relationship: 'manyMany',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignTitleFieldId,
            isOneWay: true,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });
    const mainTitleFieldId = mainTable.fields.find((f) => f.name === 'Title')?.id ?? '';
    if (!mainTitleFieldId) {
      throw new Error('Missing main title field');
    }

    const record = await createRecord(mainTable.id, {
      [mainTitleFieldId]: 'Main Row',
    });

    const response = await fetch(`${baseUrl}/tables/updateRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tableId: mainTable.id,
        recordId: record.id,
        typecast: true,
        fields: {
          [linkFieldId]: [foreignRecordTitle],
        },
      }),
    });

    expect(response.status).toBe(200);

    const rawBody = await response.json();
    const parsed = updateRecordOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    const records = await listRecords(mainTable.id);
    const updated = records.find((r) => r.id === record.id);
    expect(updated).toBeDefined();
    if (!updated) return;

    const linkValue = updated.fields[linkFieldId] as unknown;
    expect(Array.isArray(linkValue)).toBe(true);
    const linkArray = linkValue as Array<{ id: string; title?: string }>;
    expect(linkArray.some((link) => link.id === foreignRecord.id)).toBe(true);
  });

  it('updates formula chains in a real-world table', async () => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    const scoreLabelFieldId = createFieldId();

    const table = await createTable({
      baseId,
      name: 'Realworld Formula Chain',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreFieldId,
          name: 'Score',
          options: { expression: `{${amountFieldId}} * 2` },
        },
        {
          type: 'formula',
          id: scoreLabelFieldId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const nameFieldId = table.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!nameFieldId) throw new Error('Missing primary field for formula chain table');

    const record = await createRecord(table.id, {
      [nameFieldId]: 'Alpha',
      [amountFieldId]: 5,
    });

    await updateRecord(table.id, record.id, {
      [amountFieldId]: 7,
    });

    const records = await listRecords(table.id);
    const updated = records.find((r) => r.id === record.id);
    expect(updated?.fields[scoreFieldId]).toBe(14);
    expect(updated?.fields[scoreLabelFieldId]).toBe('Score: 14');
  });

  it('updates lookup values when source formulas change', async () => {
    const scoreFieldId = createFieldId();
    const scoreLabelFieldId = createFieldId();

    const contacts = await createTable({
      baseId,
      name: 'Contacts',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: scoreFieldId, name: 'Score' },
        {
          type: 'formula',
          id: scoreLabelFieldId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${scoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const contactNameFieldId = contacts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!contactNameFieldId) throw new Error('Missing primary field for contacts table');

    const contact = await createRecord(contacts.id, {
      [contactNameFieldId]: 'Alice',
      [scoreFieldId]: 2,
    });

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    const deals = await createTable({
      baseId,
      name: 'Deals',
      fields: [
        { type: 'singleLineText', name: 'Deal', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Contact',
          options: {
            relationship: 'manyOne',
            foreignTableId: contacts.id,
            lookupFieldId: contactNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Contact Score Label',
          options: {
            linkFieldId,
            foreignTableId: contacts.id,
            lookupFieldId: scoreLabelFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const dealNameFieldId = deals.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!dealNameFieldId) throw new Error('Missing primary field for deals table');

    const deal = await createRecord(deals.id, {
      [dealNameFieldId]: 'Deal A',
      [linkFieldId]: { id: contact.id },
    });
    await processOutbox();

    let records = await listRecords(deals.id);
    let stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 2.00');

    await updateRecord(contacts.id, contact.id, {
      [scoreFieldId]: 8,
    });
    await processOutbox();

    records = await listRecords(deals.id);
    stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 8.00');
  });

  it('updates rollups and link titles when linked records change', async () => {
    const hoursFieldId = createFieldId();

    const tasks = await createTable({
      baseId,
      name: 'Tasks',
      fields: [
        { type: 'singleLineText', name: 'Task', isPrimary: true },
        { type: 'number', id: hoursFieldId, name: 'Hours' },
      ],
      views: [{ type: 'grid' }],
    });

    const taskNameFieldId = tasks.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!taskNameFieldId) throw new Error('Missing primary field for tasks table');

    const taskA = await createRecord(tasks.id, {
      [taskNameFieldId]: 'Design',
      [hoursFieldId]: 2,
    });
    const taskB = await createRecord(tasks.id, {
      [taskNameFieldId]: 'Build',
      [hoursFieldId]: 3,
    });

    const linkFieldId = createFieldId();
    const rollupFieldId = createFieldId();

    const projects = await createTable({
      baseId,
      name: 'Projects',
      fields: [
        { type: 'singleLineText', name: 'Project', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Tasks',
          options: {
            relationship: 'manyMany',
            foreignTableId: tasks.id,
            lookupFieldId: taskNameFieldId,
            isOneWay: true,
          },
        },
        {
          type: 'rollup',
          id: rollupFieldId,
          name: 'Total Hours',
          options: { expression: 'sum({values})' },
          config: {
            linkFieldId,
            foreignTableId: tasks.id,
            lookupFieldId: hoursFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const projectNameFieldId = projects.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!projectNameFieldId) throw new Error('Missing primary field for projects table');

    const project = await createRecord(projects.id, {
      [projectNameFieldId]: 'Launch',
      [linkFieldId]: [{ id: taskA.id }, { id: taskB.id }],
    });
    await processOutbox();

    let records = await listRecords(projects.id);
    let stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(5);
    const beforeLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(beforeLinks?.map((link) => link.title)).toEqual(
      expect.arrayContaining(['Design', 'Build'])
    );

    await updateRecord(tasks.id, taskB.id, {
      [taskNameFieldId]: 'Build v2',
      [hoursFieldId]: 5,
    });
    await processOutbox();

    records = await listRecords(projects.id);
    stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(7);
    const updatedLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(updatedLinks?.map((link) => link.title)).toEqual(
      expect.arrayContaining(['Design', 'Build v2'])
    );

    await updateRecord(projects.id, project.id, {
      [linkFieldId]: [{ id: taskB.id }],
    });
    await processOutbox();

    records = await listRecords(projects.id);
    stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(5);
    const finalLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(finalLinks?.some((link) => link.id === taskA.id)).toBe(false);
    expect(finalLinks?.some((link) => link.id === taskB.id)).toBe(true);
  });

  it('cascades lookup values across multiple tables', async () => {
    const contactScoreFieldId = createFieldId();
    const contactScoreLabelId = createFieldId();
    const contactScoreLookupId = createFieldId();

    const contacts = await createTable({
      baseId,
      name: 'Cascade Contacts',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: contactScoreFieldId, name: 'Score' },
        {
          type: 'formula',
          id: contactScoreLabelId,
          name: 'Score Label',
          options: { expression: `CONCATENATE("Score: ", {${contactScoreFieldId}})` },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const contactNameFieldId = contacts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!contactNameFieldId) throw new Error('Missing primary field for contacts table');

    const linkToContactId = createFieldId();

    const deals = await createTable({
      baseId,
      name: 'Cascade Deals',
      fields: [
        { type: 'singleLineText', name: 'Deal', isPrimary: true },
        {
          type: 'link',
          id: linkToContactId,
          name: 'Contact',
          options: {
            relationship: 'manyOne',
            foreignTableId: contacts.id,
            lookupFieldId: contactNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: contactScoreLookupId,
          name: 'Contact Score',
          options: {
            linkFieldId: linkToContactId,
            foreignTableId: contacts.id,
            lookupFieldId: contactScoreLabelId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const dealNameFieldId = deals.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!dealNameFieldId) throw new Error('Missing primary field for deals table');

    const accountDealLinkId = createFieldId();
    const accountDealScoreLabelId = createFieldId();

    const accounts = await createTable({
      baseId,
      name: 'Cascade Accounts',
      fields: [
        { type: 'singleLineText', name: 'Account', isPrimary: true },
        {
          type: 'link',
          id: accountDealLinkId,
          name: 'Deal',
          options: {
            relationship: 'manyOne',
            foreignTableId: deals.id,
            lookupFieldId: dealNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: accountDealScoreLabelId,
          name: 'Deal Score Label',
          options: {
            linkFieldId: accountDealLinkId,
            foreignTableId: deals.id,
            lookupFieldId: contactScoreLookupId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const accountNameFieldId = accounts.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!accountNameFieldId) throw new Error('Missing primary field for accounts table');

    const contact = await createRecord(contacts.id, {
      [contactNameFieldId]: 'Sam',
      [contactScoreFieldId]: 2,
    });

    const deal = await createRecord(deals.id, {
      [dealNameFieldId]: 'Deal X',
      [linkToContactId]: { id: contact.id },
    });

    const account = await createRecord(accounts.id, {
      [accountNameFieldId]: 'Account 1',
      [accountDealLinkId]: { id: deal.id },
    });
    await processOutbox(2);

    let accountsRecords = await listRecords(accounts.id);
    let stored = accountsRecords.find((r) => r.id === account.id);
    expectLookupValue(stored?.fields[accountDealScoreLabelId], 'Score: 2.00');

    await updateRecord(contacts.id, contact.id, {
      [contactScoreFieldId]: 5,
    });
    await processOutbox(2);

    accountsRecords = await listRecords(accounts.id);
    stored = accountsRecords.find((r) => r.id === account.id);
    expectLookupValue(stored?.fields[accountDealScoreLabelId], 'Score: 5.00');
  });

  it('updates lookup values when link relations change', async () => {
    const levelFieldId = createFieldId();

    const people = await createTable({
      baseId,
      name: 'People',
      fields: [
        { type: 'singleLineText', name: 'Name', isPrimary: true },
        { type: 'number', id: levelFieldId, name: 'Level' },
      ],
      views: [{ type: 'grid' }],
    });

    const peopleNameFieldId = people.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!peopleNameFieldId) throw new Error('Missing primary field for people table');

    const linkFieldId = createFieldId();
    const lookupFieldId = createFieldId();

    const teams = await createTable({
      baseId,
      name: 'Teams',
      fields: [
        { type: 'singleLineText', name: 'Team', isPrimary: true },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Members',
          options: {
            relationship: 'manyMany',
            foreignTableId: people.id,
            lookupFieldId: peopleNameFieldId,
          },
        },
        {
          type: 'lookup',
          id: lookupFieldId,
          name: 'Member Levels',
          options: {
            linkFieldId,
            foreignTableId: people.id,
            lookupFieldId: levelFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const teamNameFieldId = teams.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!teamNameFieldId) throw new Error('Missing primary field for teams table');

    const alice = await createRecord(people.id, {
      [peopleNameFieldId]: 'Alice',
      [levelFieldId]: 1,
    });
    const bob = await createRecord(people.id, {
      [peopleNameFieldId]: 'Bob',
      [levelFieldId]: 2,
    });

    const team = await createRecord(teams.id, {
      [teamNameFieldId]: 'Alpha',
      [linkFieldId]: [{ id: alice.id }],
    });
    await processOutbox();

    let teamRecords = await listRecords(teams.id);
    let stored = teamRecords.find((r) => r.id === team.id);
    const initialLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as
      | number[]
      | undefined;
    expect(initialLevels?.sort()).toEqual([1]);

    await updateRecord(teams.id, team.id, {
      [linkFieldId]: [{ id: alice.id }, { id: bob.id }],
    });
    await processOutbox();

    teamRecords = await listRecords(teams.id);
    stored = teamRecords.find((r) => r.id === team.id);
    const bothLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as number[] | undefined;
    expect(bothLevels?.sort()).toEqual([1, 2]);

    await updateRecord(teams.id, team.id, {
      [linkFieldId]: [{ id: bob.id }],
    });
    await processOutbox();

    teamRecords = await listRecords(teams.id);
    stored = teamRecords.find((r) => r.id === team.id);
    const finalLevels = normalizeLookupArray(stored?.fields[lookupFieldId]) as number[] | undefined;
    expect(finalLevels?.sort()).toEqual([2]);
  });

  it('updates symmetric link values when relations change', async () => {
    const tasks = await createTable({
      baseId,
      name: 'Tasks B',
      fields: [{ type: 'singleLineText', name: 'Task', isPrimary: true }],
      views: [{ type: 'grid' }],
    });

    const taskNameFieldId = tasks.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!taskNameFieldId) {
      throw new Error('Missing primary field for symmetric link test');
    }

    const projectTaskLinkId = createFieldId();

    const projects = await createTable({
      baseId,
      name: 'Projects With Link',
      fields: [
        { type: 'singleLineText', name: 'Project', isPrimary: true },
        {
          type: 'link',
          id: projectTaskLinkId,
          name: 'Tasks',
          options: {
            relationship: 'manyMany',
            foreignTableId: tasks.id,
            lookupFieldId: taskNameFieldId,
          },
        },
      ],
      views: [{ type: 'grid' }],
    });

    const projectNameFieldId = projects.fields.find((f) => f.isPrimary)?.id ?? '';
    if (!projectNameFieldId) {
      throw new Error('Missing project primary field for symmetric link test');
    }

    const projectLinkField = projects.fields.find((f) => f.id === projectTaskLinkId);
    if (!projectLinkField || projectLinkField.type !== 'link') {
      throw new Error('Missing project link field');
    }
    const symmetricFieldId = projectLinkField.options.symmetricFieldId ?? '';
    if (!symmetricFieldId) throw new Error('Missing symmetric link field id');

    const task = await createRecord(tasks.id, {
      [taskNameFieldId]: 'Task 1',
    });

    const project = await createRecord(projects.id, {
      [projectNameFieldId]: 'Project 1',
      [projectTaskLinkId]: [{ id: task.id }],
    });
    await processOutbox(2);

    let taskRecords = await listRecords(tasks.id);
    let taskRow = taskRecords.find((r) => r.id === task.id);
    const symmetricLinks = normalizeLookupArray(taskRow?.fields[symmetricFieldId]) as
      | Array<{ id: string }>
      | undefined;
    expect(symmetricLinks?.some((link) => link.id === project.id)).toBe(true);

    await updateRecord(projects.id, project.id, {
      [projectTaskLinkId]: [],
    });
    await processOutbox(2);

    taskRecords = await listRecords(tasks.id);
    taskRow = taskRecords.find((r) => r.id === task.id);
    const updatedLinks = normalizeLookupArray(taskRow?.fields[symmetricFieldId]) as
      | Array<{ id: string }>
      | undefined;
    expect((updatedLinks ?? []).some((link) => link.id === project.id)).toBe(false);
  });
});
