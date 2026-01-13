/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createV2NodeTestContainer,
  type IV2NodeTestContainer,
} from '@teable/v2-container-node-test';
import {
  createTableOkResponseSchema,
  createTablesOkResponseSchema,
  getTableByIdOkResponseSchema,
  listTableRecordsOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import { tableTemplates } from '@teable/v2-table-templates';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http createTable (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let testContainer: IV2NodeTestContainer;
  let fieldIdCounter = 0;
  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
  };
  const buildPayload = (name: string) => {
    const amountFieldId = createFieldId();
    const scoreFieldId = createFieldId();
    return {
      baseId,
      name,
      fields: [
        { type: 'singleLineText', name: 'Name' },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        {
          type: 'formula',
          id: scoreFieldId,
          name: 'Score',
          options: { expression: `{${amountFieldId}} * 2` },
        },
        { type: 'rating', name: 'Priority', max: 5 },
        { type: 'singleSelect', name: 'Status', options: ['Todo', 'Doing', 'Done'] },
      ],
    } as ICreateTableCommandInput;
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

  const createTables = async (payload: unknown) => {
    const response = await fetch(`${baseUrl}/tables/createTables`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create tables: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = createTablesOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse create tables response');
    }
    return parsed.data.data.tables;
  };

  const getTableById = async (baseIdValue: string, tableIdValue: string) => {
    const response = await fetch(
      `${baseUrl}/tables/get?baseId=${baseIdValue}&tableId=${tableIdValue}`,
      { method: 'GET' }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch table: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = getTableByIdOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse get table response');
    }
    return parsed.data.data.table;
  };

  const listTableRecords = async (tableIdValue: string) => {
    const response = await fetch(
      `${baseUrl}/tables/listRecords?tableId=${tableIdValue}&limit=1000&offset=0`,
      { method: 'GET' }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch records: ${errorText}`);
    }
    const rawBody = await response.json();
    const parsed = listTableRecordsOkResponseSchema.safeParse(rawBody);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to parse list records response');
    }
    return parsed.data.data.records;
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
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('returns 201 ok and includes TableCreated (fetch)', async () => {
    const payload = buildPayload('Projects');

    const response = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(201);

    const rawBody = await response.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const body = parsed.data;

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Projects');
    expect(body.data.table.baseId).toBe(baseId);
    expect(body.data.table.fields).toHaveLength(5);
    expect(body.data.table.fields.filter((f) => f.isPrimary).length).toBe(1);
    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('returns ok response via orpc client', async () => {
    const client = createV2HttpClient({ baseUrl });

    const body = await client.tables.create({
      ...buildPayload('Projects (client)'),
    });

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.table.name).toBe('Projects (client)');
    expect(body.data.table.baseId).toBe(baseId);
    expect(body.data.table.fields).toHaveLength(5);
    expect(body.data.table.fields.filter((f) => f.isPrimary).length).toBe(1);
    expect(body.data.table.views.length).toBeGreaterThan(0);
    expect(body.data.events.some((e) => e.name === 'TableCreated')).toBe(true);
  });

  it('creates records when included in the payload', async () => {
    const nameFieldId = createFieldId();
    const payload: ICreateTableCommandInput = {
      baseId,
      name: 'Seeded',
      fields: [{ type: 'singleLineText', id: nameFieldId, name: 'Name', isPrimary: true }],
      records: [{ fields: { [nameFieldId]: 'Alpha' } }, { fields: { [nameFieldId]: 'Beta' } }],
    };

    const created = await createTable(payload);
    const records = await listTableRecords(created.id);

    expect(records).toHaveLength(2);
    const values = records.map((record) => record.fields[nameFieldId]);
    expect(values).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
  });

  it('allows creating two tables with the same name', async () => {
    const first = await createTable(buildPayload('Same Name'));
    const second = await createTable(buildPayload('Same Name'));

    expect(first.name).toBe('Same Name');
    expect(second.name).toBe('Same Name');
    expect(first.id).not.toBe(second.id);
    expect(first.baseId).toBe(baseId);
    expect(second.baseId).toBe(baseId);
  });

  it('creates tables for every template with seeded records', async () => {
    let index = 0;
    for (const template of tableTemplates) {
      const name = `Template ${template.key} ${index + 1}`;
      const created = await createTables(
        template.createInput(baseId, { namePrefix: name, includeRecords: true })
      );

      if (template.key === 'bug-triage') {
        await testContainer.processOutbox();
      }

      expect(created.length).toBe(template.tables.length);
      for (let tableIndex = 0; tableIndex < created.length; tableIndex += 1) {
        const table = created[tableIndex]!;
        const templateTable = template.tables[tableIndex]!;
        const expectedName = template.tables.length > 1 ? `${name} - ${templateTable.name}` : name;

        expect(table.name).toBe(expectedName);
        expect(table.baseId).toBe(baseId);
        expect(table.fields.length).toBeGreaterThan(0);

        const records = await listTableRecords(table.id);
        expect(records).toHaveLength(templateTable.defaultRecordCount);
        if (templateTable.defaultRecordCount > 0) {
          expect(Object.keys(records[0]!.fields)).not.toHaveLength(0);
        }

        if (template.key === 'bug-triage' && templateTable.key === 'bugs') {
          const uiComponentsField = table.fields.find((f) => f.name === 'UI Components');
          const uiComponentCountField = table.fields.find((f) => f.name === 'UI Component Count');
          expect(uiComponentsField).toBeTruthy();
          expect(uiComponentCountField).toBeTruthy();
          if (!uiComponentsField || !uiComponentCountField) return;

          const first = records[0]!;
          const uiValue = first.fields[uiComponentsField.id];
          const countValue = first.fields[uiComponentCountField.id];

          const uiComponents = (() => {
            if (Array.isArray(uiValue)) {
              return uiValue.filter((value): value is string => typeof value === 'string');
            }
            if (typeof uiValue === 'string') {
              try {
                const parsed: unknown = JSON.parse(uiValue);
                if (Array.isArray(parsed)) {
                  return parsed.filter((value): value is string => typeof value === 'string');
                }
              } catch {
                // fall back to treating the raw string as a single value
              }
              return [uiValue];
            }
            return [];
          })();

          expect(uiComponents).toContain('UI');
          expect(Number(countValue)).toBe(1);
        }
      }
      index += 1;
    }
  });

  it('keeps seeded records aligned with input table order', async () => {
    const tableAId = `tbl${'a'.repeat(16)}`;
    const tableBId = `tbl${'b'.repeat(16)}`;
    const tableAPrimaryId = createFieldId();
    const tableBPrimaryId = createFieldId();
    const tableALinkId = createFieldId();

    const tables = await createTables({
      baseId,
      tables: [
        {
          tableId: tableAId,
          name: 'Order A',
          fields: [
            { type: 'singleLineText', id: tableAPrimaryId, name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: tableALinkId,
              name: 'Link to B',
              options: {
                relationship: 'manyMany',
                foreignTableId: tableBId,
                lookupFieldId: tableBPrimaryId,
              },
            },
          ],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableAPrimaryId]: 'A1' } }],
        },
        {
          tableId: tableBId,
          name: 'Order B',
          fields: [{ type: 'singleLineText', id: tableBPrimaryId, name: 'Name', isPrimary: true }],
          views: [{ type: 'grid' }],
          records: [{ fields: { [tableBPrimaryId]: 'B1' } }],
        },
      ],
    });

    expect(tables.map((table) => table.id)).toEqual([tableAId, tableBId]);

    const recordsA = await listTableRecords(tableAId);
    const recordsB = await listTableRecords(tableBId);

    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);
    expect(recordsA[0]?.fields[tableAPrimaryId]).toBe('A1');
    expect(recordsB[0]?.fields[tableBPrimaryId]).toBe('B1');
  });

  it('creates tables when rollup and formula fields are declared before dependencies', async () => {
    const foreignTable = await createTable({
      baseId,
      name: 'Companies',
      fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
    });

    const foreignPrimaryField = foreignTable.fields.find((field) => field.isPrimary);
    expect(foreignPrimaryField).toBeDefined();
    if (!foreignPrimaryField) return;

    const linkFieldId = createFieldId();
    const amountFieldId = createFieldId();

    const payload: ICreateTableCommandInput = {
      baseId,
      name: 'Out Of Order',
      fields: [
        {
          type: 'rollup',
          name: 'Rollup Total',
          options: { expression: 'counta({values})' },
          config: {
            linkFieldId,
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
        {
          type: 'formula',
          name: 'Score',
          options: { expression: `{${amountFieldId}} + 1` },
        },
        {
          type: 'link',
          id: linkFieldId,
          name: 'Company',
          options: {
            relationship: 'manyOne',
            foreignTableId: foreignTable.id,
            lookupFieldId: foreignPrimaryField.id,
          },
        },
        { type: 'number', id: amountFieldId, name: 'Amount' },
        { type: 'singleLineText', name: 'Name', isPrimary: true },
      ],
    };

    const created = await createTable(payload);
    const types = created.fields.map((field) => field.type);
    expect(types).toContain('rollup');
    expect(types).toContain('formula');
    expect(types).toContain('link');
  });

  describe('link fields', () => {
    it('creates symmetric link fields for all relationships', async () => {
      const foreignTable = await createTable({
        baseId,
        name: 'Companies',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      });

      const foreignPrimaryField = foreignTable.fields.find((f) => f.isPrimary);
      expect(foreignPrimaryField).toBeDefined();
      if (!foreignPrimaryField) return;

      const cases = [
        { relationship: 'oneOne', expected: 'oneOne' },
        { relationship: 'manyMany', expected: 'manyMany' },
        { relationship: 'oneMany', expected: 'manyOne' },
        { relationship: 'manyOne', expected: 'oneMany' },
      ] as const;

      for (const entry of cases) {
        const linkFieldId = createFieldId();
        const linkPayload: ICreateTableCommandInput = {
          baseId,
          name: `Projects (${entry.relationship})`,
          fields: [
            { type: 'singleLineText', name: 'Name', isPrimary: true },
            {
              type: 'link',
              id: linkFieldId,
              name: `Company ${entry.relationship}`,
              options: {
                relationship: entry.relationship,
                foreignTableId: foreignTable.id,
                lookupFieldId: foreignPrimaryField.id,
              },
            },
          ],
        };

        const linkTable = await createTable(linkPayload);
        const updatedForeignTable = await getTableById(baseId, foreignTable.id);
        const foreignLinkField = updatedForeignTable.fields.find(
          (field) =>
            field.type === 'link' &&
            field.options.symmetricFieldId === linkFieldId &&
            field.options.foreignTableId === linkTable.id
        );
        expect(foreignLinkField).toBeDefined();
        if (!foreignLinkField || foreignLinkField.type !== 'link') return;

        expect(foreignLinkField.options.relationship).toBe(entry.expected);
      }
    });

    it('supports self-referencing links', async () => {
      const selfTableId = `tbl${'s'.repeat(16)}`;
      const primaryFieldId = createFieldId();
      const linkFieldId = createFieldId();

      await createTable({
        baseId,
        tableId: selfTableId,
        name: 'Self Links',
        fields: [
          { type: 'singleLineText', id: primaryFieldId, name: 'Name', isPrimary: true },
          {
            type: 'link',
            id: linkFieldId,
            name: 'Self',
            options: {
              relationship: 'manyMany',
              foreignTableId: selfTableId,
              lookupFieldId: primaryFieldId,
            },
          },
        ],
      });

      const selfTable = await getTableById(baseId, selfTableId);
      const linkFields = selfTable.fields.filter((field) => field.type === 'link');
      expect(linkFields.length).toBe(2);
      const symmetric = linkFields.find(
        (field) => field.type === 'link' && field.options.symmetricFieldId === linkFieldId
      );
      expect(symmetric).toBeDefined();
    });

    it('createTables with internal manyMany link and records updates symmetric link correctly', async () => {
      // Test scenario:
      // 1. Use createTables to create two tables with internal manyMany link
      // 2. Table B has records: B1, B2
      // 3. Table A has records: A1 with link to [B1, B2]
      // 4. After processOutbox, verify:
      //    - A1's link field shows [B1, B2]
      //    - B1's symmetric link shows [A1]
      //    - B2's symmetric link shows [A1]

      const tableAId = `tbl${'c'.repeat(16)}`;
      const tableBId = `tbl${'d'.repeat(16)}`;
      const aPrimaryFieldId = createFieldId();
      const bPrimaryFieldId = createFieldId();
      const aLinkFieldId = createFieldId();
      const recordB1Id = `rec${'1'.repeat(16)}`;
      const recordB2Id = `rec${'2'.repeat(16)}`;
      const recordA1Id = `rec${'3'.repeat(16)}`;

      const tables = await createTables({
        baseId,
        tables: [
          {
            tableId: tableBId,
            name: 'LinkTestB',
            fields: [
              { type: 'singleLineText', id: bPrimaryFieldId, name: 'Name', isPrimary: true },
            ],
            views: [{ type: 'grid' }],
            records: [
              { id: recordB1Id, fields: { [bPrimaryFieldId]: 'B1' } },
              { id: recordB2Id, fields: { [bPrimaryFieldId]: 'B2' } },
            ],
          },
          {
            tableId: tableAId,
            name: 'LinkTestA',
            fields: [
              { type: 'singleLineText', id: aPrimaryFieldId, name: 'Name', isPrimary: true },
              {
                type: 'link',
                id: aLinkFieldId,
                name: 'LinkToB',
                options: {
                  relationship: 'manyMany',
                  foreignTableId: tableBId,
                  lookupFieldId: bPrimaryFieldId,
                },
              },
            ],
            views: [{ type: 'grid' }],
            records: [
              {
                id: recordA1Id,
                fields: {
                  [aPrimaryFieldId]: 'A1',
                  [aLinkFieldId]: [
                    { id: recordB1Id, title: 'B1' },
                    { id: recordB2Id, title: 'B2' },
                  ],
                },
              },
            ],
          },
        ],
      });

      expect(tables).toHaveLength(2);

      // Process outbox multiple times to ensure all computed updates complete
      await testContainer.processOutbox();
      await testContainer.processOutbox();
      await testContainer.processOutbox();

      // Verify Table A records
      const recordsA = await listTableRecords(tableAId);
      expect(recordsA).toHaveLength(1);

      const linkValueA = recordsA[0]?.fields[aLinkFieldId] as Array<{ id: string; title?: string }>;
      expect(linkValueA).toBeDefined();
      expect(Array.isArray(linkValueA)).toBe(true);
      expect(linkValueA.length).toBe(2);
      expect(linkValueA.map((l) => l.id).sort()).toEqual([recordB1Id, recordB2Id].sort());

      // Verify Table B records have symmetric link
      const recordsB = await listTableRecords(tableBId);
      expect(recordsB).toHaveLength(2);

      // Find the symmetric link field in table B
      const tableB = await getTableById(baseId, tableBId);
      const symmetricLinkField = tableB.fields.find(
        (f) => f.type === 'link' && f.options.symmetricFieldId === aLinkFieldId
      );
      expect(symmetricLinkField).toBeDefined();
      if (!symmetricLinkField) return;

      const symFieldId = symmetricLinkField.id;

      // Both B1 and B2 should have A1 in their symmetric link
      for (const recordB of recordsB) {
        const symLinkValue = recordB.fields[symFieldId] as Array<{ id: string; title?: string }>;
        expect(symLinkValue).toBeDefined();
        expect(Array.isArray(symLinkValue)).toBe(true);
        expect(symLinkValue.length).toBe(1);
        expect(symLinkValue[0]?.id).toBe(recordA1Id);
      }
    });
  });
});
