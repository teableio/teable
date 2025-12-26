/* eslint-disable @typescript-eslint/naming-convention */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createV2NodeTestContainer } from '@teable/v2-container-node-test';
import {
  createFieldOkResponseSchema,
  createTableOkResponseSchema,
  getTableByIdOkResponseSchema,
} from '@teable/v2-contract-http';
import { createV2ExpressRouter } from '@teable/v2-contract-http-express';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('v2 http createField (e2e)', () => {
  let server: Server | undefined;
  let baseUrl: string;
  let dispose: (() => Promise<void>) | undefined;
  let baseId: string;
  let tableId: string;
  let tablePrimaryFieldId: string;
  let foreignTableId: string;
  let foreignPrimaryFieldId: string;
  let fieldIdCounter = 0;

  const createFieldId = () => {
    const suffix = fieldIdCounter.toString(36).padStart(16, '0');
    fieldIdCounter += 1;
    return `fld${suffix}`;
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

    const createTableResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'CreateField Table',
        fields: [{ type: 'singleLineText', name: 'Name' }],
      }),
    });

    const rawBody = await createTableResponse.json();
    const parsed = createTableOkResponseSchema.safeParse(rawBody);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.ok) {
      throw new Error('Failed to create seed table');
    }
    tableId = parsed.data.data.table.id;
    const primaryField = parsed.data.data.table.fields.find((field) => field.isPrimary);
    if (!primaryField) {
      throw new Error('Failed to resolve primary field');
    }
    tablePrimaryFieldId = primaryField.id;

    const foreignResponse = await fetch(`${baseUrl}/tables/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        name: 'Foreign Table',
        fields: [{ type: 'singleLineText', name: 'Name', isPrimary: true }],
      }),
    });
    const foreignRaw = await foreignResponse.json();
    const foreignParsed = createTableOkResponseSchema.safeParse(foreignRaw);
    expect(foreignParsed.success).toBe(true);
    if (!foreignParsed.success || !foreignParsed.data.ok) {
      throw new Error('Failed to create foreign table');
    }
    foreignTableId = foreignParsed.data.data.table.id;
    const foreignPrimary = foreignParsed.data.data.table.fields.find((field) => field.isPrimary);
    if (!foreignPrimary) {
      throw new Error('Failed to resolve foreign primary field');
    }
    foreignPrimaryFieldId = foreignPrimary.id;
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
    }
    if (dispose) await dispose();
  });

  it('creates all field types with configured options', async () => {
    const numberFieldId = createFieldId();
    const formulaFieldId = createFieldId();

    const cases = [
      {
        field: {
          type: 'singleLineText',
          id: createFieldId(),
          name: 'Title',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
        },
        expect: {
          type: 'singleLineText',
          options: { showAs: { type: 'email' }, defaultValue: 'Hello' },
        },
      },
      {
        field: {
          type: 'longText',
          id: createFieldId(),
          name: 'Notes',
          options: { defaultValue: 'Details' },
        },
        expect: {
          type: 'longText',
          options: { defaultValue: 'Details' },
        },
      },
      {
        field: {
          type: 'number',
          id: numberFieldId,
          name: 'Amount',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
        expect: {
          type: 'number',
          options: {
            formatting: { type: 'currency', precision: 2, symbol: '$' },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
            defaultValue: 42,
          },
        },
      },
      {
        field: {
          type: 'rating',
          id: createFieldId(),
          name: 'Priority',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
        expect: {
          type: 'rating',
          options: { max: 7, icon: 'star', color: 'yellowBright' },
        },
      },
      {
        field: {
          type: 'singleSelect',
          id: createFieldId(),
          name: 'Status',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
        expect: {
          type: 'singleSelect',
          options: {
            choices: [
              { id: 'opt1', name: 'Todo', color: 'blue' },
              { id: 'opt2', name: 'Done', color: 'green' },
            ],
            defaultValue: 'Todo',
            preventAutoNewOptions: true,
          },
        },
      },
      {
        field: {
          type: 'multipleSelect',
          id: createFieldId(),
          name: 'Tags',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
        expect: {
          type: 'multipleSelect',
          options: {
            choices: [
              { id: 'opt3', name: 'Alpha', color: 'purple' },
              { id: 'opt4', name: 'Beta', color: 'orange' },
            ],
            defaultValue: ['Alpha', 'Beta'],
          },
        },
      },
      {
        field: {
          type: 'checkbox',
          id: createFieldId(),
          name: 'Approved',
          options: { defaultValue: true },
        },
        expect: {
          type: 'checkbox',
          options: { defaultValue: true },
        },
      },
      {
        field: {
          type: 'attachment',
          id: createFieldId(),
          name: 'Files',
        },
        expect: {
          type: 'attachment',
          options: {},
        },
      },
      {
        field: {
          type: 'date',
          id: createFieldId(),
          name: 'Due',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
        expect: {
          type: 'date',
          options: {
            formatting: { date: 'YYYY-MM-DD', time: 'HH:mm', timeZone: 'utc' },
            defaultValue: 'now',
          },
        },
      },
      {
        field: {
          type: 'user',
          id: createFieldId(),
          name: 'Owner',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
        expect: {
          type: 'user',
          options: {
            isMultiple: true,
            shouldNotify: false,
            defaultValue: ['usr1', 'usr2'],
          },
        },
      },
      {
        field: {
          type: 'button',
          id: createFieldId(),
          name: 'Action',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
        expect: {
          type: 'button',
          options: {
            label: 'Run',
            color: 'teal',
            maxCount: 9,
            resetCount: true,
            workflow: { id: 'wfl123', name: 'Flow', isActive: true },
          },
        },
      },
      {
        field: {
          type: 'formula',
          id: formulaFieldId,
          name: 'Score',
          options: {
            expression: `{${numberFieldId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
        },
        expect: {
          type: 'formula',
          options: {
            expression: `{${numberFieldId}} * 2`,
            timeZone: 'utc',
            formatting: { type: 'decimal', precision: 1 },
            showAs: { type: 'bar', color: 'red', showValue: true, maxValue: 100 },
          },
          cellValueType: 'number',
          isMultipleCellValue: false,
        },
      },
    ];

    for (const entry of cases) {
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId,
          field: entry.field,
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`CreateField failed for ${entry.field.type}: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);
      const parsed = createFieldOkResponseSchema.safeParse(rawBody);
      expect(parsed.success).toBe(true);
      if (!parsed.success || !parsed.data.ok) return;

      const fields = parsed.data.data.table.fields;
      const created = fields.find((f) => f.id === entry.field.id);
      expect(created).toBeTruthy();
      if (!created) return;

      expect(created.type).toBe(entry.expect.type);
      if ('options' in entry.expect) {
        expect(created.options).toEqual(entry.expect.options);
      }
      if (created.type === 'formula') {
        expect(created.cellValueType).toBe(entry.expect.cellValueType);
        expect(created.isMultipleCellValue).toBe(entry.expect.isMultipleCellValue);
      }
    }
  });

  it('creates link fields for all relationships and self links', async () => {
    const relationships = [
      { relationship: 'oneOne', expected: 'oneOne' },
      { relationship: 'manyMany', expected: 'manyMany' },
      { relationship: 'oneMany', expected: 'manyOne' },
      { relationship: 'manyOne', expected: 'oneMany' },
    ] as const;

    for (const entry of relationships) {
      const linkFieldId = createFieldId();
      const response = await fetch(`${baseUrl}/tables/createField`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baseId,
          tableId,
          field: {
            type: 'link',
            id: linkFieldId,
            name: `Link ${entry.relationship}`,
            options: {
              relationship: entry.relationship,
              foreignTableId,
              lookupFieldId: foreignPrimaryFieldId,
            },
          },
        }),
      });

      const rawBody = await response.json();
      if (response.status !== 200) {
        throw new Error(`CreateField failed for link: ${JSON.stringify(rawBody)}`);
      }
      expect(response.status).toBe(200);

      const getResponse = await fetch(
        `${baseUrl}/tables/get?baseId=${baseId}&tableId=${foreignTableId}`,
        { method: 'GET' }
      );
      expect(getResponse.status).toBe(200);
      const getRaw = await getResponse.json();
      const getParsed = getTableByIdOkResponseSchema.safeParse(getRaw);
      expect(getParsed.success).toBe(true);
      if (!getParsed.success || !getParsed.data.ok) return;

      const foreignLinks = getParsed.data.data.table.fields.filter(
        (field) => field.type === 'link'
      ) as Array<{
        type: 'link';
        options: { relationship: string; symmetricFieldId?: string };
      }>;
      const matched = foreignLinks.filter(
        (field) => field.options.symmetricFieldId === linkFieldId
      );
      expect(matched).toHaveLength(1);
      if (matched.length === 0) return;
      expect(matched[0].options.relationship).toBe(entry.expected);
    }

    const selfLinkFieldId = createFieldId();
    const selfResponse = await fetch(`${baseUrl}/tables/createField`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseId,
        tableId,
        field: {
          type: 'link',
          id: selfLinkFieldId,
          name: 'Self',
          options: {
            relationship: 'manyMany',
            foreignTableId: tableId,
            lookupFieldId: tablePrimaryFieldId,
          },
        },
      }),
    });

    expect(selfResponse.status).toBe(200);
    const selfGetResponse = await fetch(
      `${baseUrl}/tables/get?baseId=${baseId}&tableId=${tableId}`,
      { method: 'GET' }
    );
    expect(selfGetResponse.status).toBe(200);
    const selfRaw = await selfGetResponse.json();
    const selfParsed = getTableByIdOkResponseSchema.safeParse(selfRaw);
    expect(selfParsed.success).toBe(true);
    if (!selfParsed.success || !selfParsed.data.ok) return;
    const selfLinks = selfParsed.data.data.table.fields.filter((field) => field.type === 'link');
    expect(selfLinks.length).toBeGreaterThan(1);
  });
});
