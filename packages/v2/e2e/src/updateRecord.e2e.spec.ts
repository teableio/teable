/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
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
  let fieldIdCounter = 0;

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

  const expectLookupValue = (value: unknown, expected: string) => {
    if (Array.isArray(value)) {
      expect(value).toContain(expected);
      return;
    }
    expect(value).toBe(expected);
  };

  beforeAll(async () => {
    const testContainer = await createV2NodeTestContainer();
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
      [linkFieldId]: [{ id: contact.id }],
    });

    let records = await listRecords(deals.id);
    let stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 2');

    await updateRecord(contacts.id, contact.id, {
      [scoreFieldId]: 8,
    });

    records = await listRecords(deals.id);
    stored = records.find((r) => r.id === deal.id);
    expectLookupValue(stored?.fields[lookupFieldId], 'Score: 8');
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

    records = await listRecords(projects.id);
    stored = records.find((r) => r.id === project.id);
    expect(stored?.fields[rollupFieldId]).toBe(5);
    const finalLinks = stored?.fields[linkFieldId] as Array<{ id: string; title?: string }>;
    expect(finalLinks?.some((link) => link.id === taskA.id)).toBe(false);
    expect(finalLinks?.some((link) => link.id === taskB.id)).toBe(true);
  });
});
