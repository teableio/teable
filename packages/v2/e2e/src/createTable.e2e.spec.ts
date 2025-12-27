/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2HttpClient } from '@teable/v2-contract-http-client';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import type { ICreateTableCommandInput } from '@teable/v2-core';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http createTable (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
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

  it('allows creating two tables with the same name', async () => {
    const first = await createTable(buildPayload('Same Name'));
    const second = await createTable(buildPayload('Same Name'));

    expect(first.name).toBe('Same Name');
    expect(second.name).toBe('Same Name');
    expect(first.id).not.toBe(second.id);
    expect(first.baseId).toBe(baseId);
    expect(second.baseId).toBe(baseId);
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
  });
});
